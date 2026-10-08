import { useCallback, useEffect, useRef, useState } from "react";
import { PanResponder, type PanResponderInstance } from "react-native";
import { useNotePlayer } from "../../lib/useNotePlayer";
import { beatSecOf } from "../../lib/synth";
import type { NoteEvent } from "../../api/types";

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
 * The sheet's one player and its practice settings. The dock and the rehearsal view
 * both drive it, so there is exactly one `useNotePlayer` (one native player) per
 * screen — opening Rehearse never starts a second copy of the tune.
 */
export function usePractice(
  audioPreviewBase64: string | null | undefined,
  notes: NoteEvent[],
  tempoBpm: number,
  timeSignature: string,
  barCount: number,
) {
  const player = useNotePlayer(audioPreviewBase64, notes, tempoBpm, 0);
  const { isPlaying, position, duration, rate, play, pause, seekTo, setRate, setLoopRange } = player;

  // ── Passage loop (A–B, in bars) ───────────────────────────────────────────
  // Bars are what a choir leader says ("again from bar 5"), so the control counts
  // bars and the hook gets seconds.
  const [loopOn, setLoopOn] = useState(false);
  const [loopFrom, setLoopFrom] = useState(1);
  const [loopTo, setLoopTo] = useState(Math.max(1, Math.min(4, barCount)));
  const barSec = beatsPerBarOf(timeSignature) * beatSecOf(tempoBpm);
  useEffect(() => {
    if (!loopOn || barCount <= 0) {
      setLoopRange(null);
      return;
    }
    setLoopRange({ start: (loopFrom - 1) * barSec, end: loopTo * barSec });
    // setLoopRange reads the current position only to decide whether to jump; it is
    // deliberately not a dependency, or every tick would re-arm the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopOn, loopFrom, loopTo, barCount, barSec]);
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

  /** Toggles play/pause, restarting from the beginning if the clip already finished. */
  const togglePlay = useCallback(async () => {
    if (isPlaying) {
      pause();
      return;
    }
    if (duration > 0 && position >= duration - 0.05) {
      await seekTo(0);
    }
    play();
  }, [isPlaying, position, duration, pause, seekTo, play]);

  return {
    ...player,
    barSec,
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
