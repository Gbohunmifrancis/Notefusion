import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, type PanResponderInstance } from "react-native";
import { useNotePlayer } from "../../lib/useNotePlayer";
import type { VoicesSource } from "../../lib/melodySource";
import { logAppEvent } from "../../lib/appEvents";
import { beatSecOf } from "../../lib/synth";
import { backingTarget, beatOfClipSec, clipSecOfBeat, onSongClock, type BeatClock } from "../../lib/backingClock";
import { balanceVolumes } from "../../lib/backingSync";
import type { NoteEvent } from "../../api/types";
import type { BackingFollow, BackingSyncProps } from "./useBacking";

/**
 * Speeds the −/+ buttons step through. 1 must be one of them, and the ends must
 * stay inside the hook's [MIN_RATE, MAX_RATE] or a step would silently clamp
 * back to where it already was.
 */
export const RATE_STEPS: number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function beatsPerBarOf(timeSignature: string): number {
  const [num, den] = timeSignature.split("/").map(Number);
  return num && den ? (num * 4) / den : 4;
}

/** Formats a duration given in seconds as "m:ss". */
export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * The song's backing under the solfa (boards o-backing O1–O2), as the screen hands it over.
 */
export interface SongBacking {
  /**
   * The song's clock: the tempo the backing was heard at, its beat 0 and its beat times. With beat times the clip the
   * screen renders is on the song's clock (lib/backingClock `onSongClock`), and so is everything here that turns
   * beats into the clip's seconds — the highlight, the loop's bars.
   */
  clock: BeatClock;
  /** The backing's file; null while it is not on the phone (not fetched yet, or none). */
  uri: string | null;
  /** It should sound: the switch on, and the sheet in the song's key. */
  active: boolean;
  /** The Solfa · Backing balance, 0–1 toward Backing. */
  balance: number;
  /** Every press of Play: on Data saver the first one fetches the backing, and a failed fetch is tried again. */
  onPlay?: () => void;
}

/**
 * The sheet's one player and its practice settings. The dock and the rehearsal view
 * both drive it, so there is exactly one `useNotePlayer` (one native player) per
 * screen — opening Rehearse never starts a second copy of the tune.
 *
 * With the song's backing (`song`) a second player plays the band under it, kept in step (`BackingSync`, rendered by
 * the screen from `backingSync`): play, pause, every seek, the loop and the speed move both. Without it nothing here
 * differs from a sheet that never had one.
 */
export function usePractice(
  audioPreviewBase64: string | VoicesSource | null | undefined,
  notes: NoteEvent[],
  tempoBpm: number,
  timeSignature: string,
  barCount: number,
  song: SongBacking | null = null,
) {
  const clock = song?.clock ?? null;
  /** The clip's seconds per beat, as lib/synth rendered it (slower in Learn my part). */
  const beatSec = beatSecOf(tempoBpm);
  /** The notes as the clip sounds them: on the song's clock when the song has beat times, else as written. */
  const timing = useMemo(() => onSongClock(notes, clock), [notes, clock]);

  // The backing's follow calls, once its player is mounted; every move of the solfa's player is passed on.
  const backingLink = useRef<BackingFollow | null>(null);
  const [backingReady, setBackingReady] = useState(false);
  const followSeek = useCallback((sec: number) => backingLink.current?.followSeek(sec), []);
  /** The solfa stays at full volume until the band is actually there to balance against. */
  const volumes = song?.active && backingReady ? balanceVolumes(song.balance) : { solfa: 1, backing: 0 };

  const player = useNotePlayer(audioPreviewBase64, timing, tempoBpm, 0, { volume: volumes.solfa, onSeek: followSeek });
  const { isPlaying, position, duration, rate, setRate, setLoopRange } = player;

  const songRef = useRef(song);
  songRef.current = song;
  const play = useCallback(() => {
    player.play();
    backingLink.current?.followPlay();
    songRef.current?.onPlay?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.play]);
  const pause = useCallback(() => {
    player.pause();
    backingLink.current?.followPause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.pause]);
  const stop = useCallback(() => {
    player.stop();
    backingLink.current?.followPause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.stop]);
  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);
  const seekTo = player.seekTo;

  // ── Beats and bars in the clip's seconds ─────────────────────────────────
  // Linear (a bar is barSec) unless the song's own beat times bend the clip; Rehearse and Learn my part ask here.
  const beatsPerBar = beatsPerBarOf(timeSignature);
  const secOfBeat = useCallback((beat: number) => clipSecOfBeat(beat, clock, beatSec), [clock, beatSec]);
  /** Where bar `bar` (1-based) starts in the clip. */
  const secOfBar = useCallback((bar: number) => secOfBeat((bar - 1) * beatsPerBar), [secOfBeat, beatsPerBar]);
  /** How many bars into the clip `sec` is, fractional (0 at the first bar line). */
  const barsAt = useCallback(
    (sec: number) => (beatsPerBar > 0 ? beatOfClipSec(sec, clock, beatSec) / beatsPerBar : 0),
    [clock, beatSec, beatsPerBar],
  );
  /** The bar (1-based) sounding at `sec`. */
  const barAt = useCallback((sec: number) => Math.floor(barsAt(sec) + 1e-6) + 1, [barsAt]);

  // ── The backing's player ─────────────────────────────────────────────────
  const backingRate = clock ? backingTarget(0, clock, beatSec, rate).rate : rate;
  const positionOf = useCallback(
    (clipSec: number) => (clock ? backingTarget(clipSec, clock, beatSec, 1).sec : clipSec),
    [clock, beatSec],
  );
  const backingSync: BackingSyncProps | null =
    song && clock && song.uri
      ? {
          uri: song.uri,
          active: song.active,
          volume: volumes.backing,
          rate: backingRate,
          main: player.audio,
          mainPlaying: isPlaying,
          positionOf,
          link: backingLink,
          onReady: setBackingReady,
        }
      : null;

  // ── Passage loop (A–B, in bars) ───────────────────────────────────────────
  // Bars are what a choir leader says ("again from bar 5"), so the control counts
  // bars and the hook gets seconds.
  const [loopOn, setLoopOn] = useState(false);
  const [loopFrom, setLoopFrom] = useState(1);
  const [loopTo, setLoopTo] = useState(Math.max(1, Math.min(4, barCount)));
  const barSec = beatsPerBar * beatSec;
  useEffect(() => {
    if (!loopOn || barCount <= 0) {
      setLoopRange(null);
      return;
    }
    setLoopRange({ start: secOfBar(loopFrom), end: secOfBar(loopTo + 1) });
    // setLoopRange reads the current position only to decide whether to jump; it is
    // deliberately not a dependency, or every tick would re-arm the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopOn, loopFrom, loopTo, barCount, secOfBar]);
  useEffect(() => {
    if (loopTo > barCount && barCount > 0) setLoopTo(barCount);
  }, [barCount, loopTo]);

  const stepLoop = (which: "from" | "to", delta: number) => {
    if (which === "from") {
      const next = clamp(loopFrom + delta, 1, barCount);
      setLoopFrom(next);
      if (next > loopTo) setLoopTo(next);
    } else {
      const next = clamp(loopTo + delta, 1, barCount);
      setLoopTo(next);
      if (next < loopFrom) setLoopFrom(next);
    }
  };

  const stepRate = useCallback(
    (delta: number) => {
      const at = RATE_STEPS.indexOf(rate);
      setRate(RATE_STEPS[clamp(at + delta, 0, RATE_STEPS.length - 1)]!);
    },
    [rate, setRate],
  );

  /**
   * Toggles play/pause, restarting from the beginning if the clip already finished. `from` names the control for the
   * console's activity feed (`result_play`, once per press of play; a scrub's resume is not one).
   */
  const togglePlay = useCallback(async (from: "dock" | "rehearse" | "learn_part" = "dock") => {
    if (isPlaying) {
      pause();
      return;
    }
    if (duration > 0 && position >= duration - 0.05) {
      await seekTo(0);
    }
    play();
    logAppEvent("result_play", { from, backing: Boolean(songRef.current?.active), rate });
  }, [isPlaying, position, duration, pause, seekTo, play, rate]);

  return {
    ...player,
    play,
    pause,
    stop,
    toggle,
    seekTo,
    barSec,
    secOfBar,
    barsAt,
    barAt,
    backingSync,
    loopOn,
    setLoopOn,
    loopFrom,
    loopTo,
    setLoopFrom,
    setLoopTo,
    stepLoop,
    stepRate,
    togglePlay,
  };
}

export type Practice = ReturnType<typeof usePractice>;

/**
 * Tap-to-seek and drag-to-scrub over a track of measured width. Playback pauses for
 * the drag and resumes after it; live seeks are throttled so a drag does not flood
 * the audio engine with seek calls on every move event.
 *
 * `onGrant` may claim the gesture for something else (the loop handles in Rehearse)
 * by returning false, in which case `onOther` receives the moves instead.
 */
export function useSeekDrag(
  practice: Practice,
  hooks?: {
    onGrant?: (x: number, width: number) => boolean;
    onOther?: (x: number, width: number, done: boolean) => void;
  },
): { panResponder: PanResponderInstance; dragFraction: number | null; onTrackWidth: (w: number) => void } {
  const state = useRef({ practice, hooks });
  state.current = { practice, hooks };

  const widthRef = useRef(0);
  const lastSeekRef = useRef(0);
  const wasPlayingRef = useRef(false);
  const scrubbingRef = useRef(true);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  const fractionAt = (x: number) => (widthRef.current > 0 ? clamp(x / widthRef.current, 0, 1) : 0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => state.current.practice.ready,
      onMoveShouldSetPanResponder: () => state.current.practice.ready,
      // The sheet scrolls vertically around the track; a scrub that has started
      // keeps the finger even when it wanders up or down.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        const { practice: p, hooks: h } = state.current;
        scrubbingRef.current = h?.onGrant ? h.onGrant(x, widthRef.current) : true;
        if (!scrubbingRef.current) return;
        wasPlayingRef.current = p.isPlaying;
        if (p.isPlaying) p.pause();
        setDragFraction(fractionAt(x));
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const { practice: p, hooks: h } = state.current;
        if (!scrubbingRef.current) {
          h?.onOther?.(x, widthRef.current, false);
          return;
        }
        const f = fractionAt(x);
        setDragFraction(f);
        const now = Date.now();
        if (now - lastSeekRef.current > 120 && p.duration > 0) {
          lastSeekRef.current = now;
          void p.seekTo(f * p.duration);
        }
      },
      onPanResponderRelease: (evt) => {
        const x = evt.nativeEvent.locationX;
        const { practice: p, hooks: h } = state.current;
        if (!scrubbingRef.current) {
          h?.onOther?.(x, widthRef.current, true);
          return;
        }
        setDragFraction(null);
        if (p.duration > 0) {
          void p.seekTo(fractionAt(x) * p.duration).then(() => {
            if (wasPlayingRef.current) state.current.practice.play();
          });
        }
      },
      // Taken away mid-drag (a system gesture): leave the position where it is and
      // put the thumb back on it rather than strand it at the finger.
      onPanResponderTerminate: () => {
        setDragFraction(null);
        if (scrubbingRef.current && wasPlayingRef.current) state.current.practice.play();
      },
    }),
  ).current;

  const onTrackWidth = useCallback((w: number) => {
    widthRef.current = w;
  }, []);

  return { panResponder, dragFraction, onTrackWidth };
}
