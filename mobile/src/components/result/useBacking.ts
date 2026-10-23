import { useCallback, useEffect, useRef } from "react";
import { useAudioPlayer, type AudioPlayer } from "expo-audio";
import { usePlayerStatus } from "../../lib/playerStatus";
import {
  BACKING_RATE_MAX,
  BACKING_RATE_MIN,
  NEW_DRIFT_WATCH,
  SYNC_TICK_MS,
  needsResync,
  rateKeepsBacking,
  solfaAtBackingRead,
  watchDrift,
} from "../../lib/backingSync";

/** A seek's own time, before it has been measured: what the backing is moved ahead by so it lands in step. */
const FIRST_SEEK_GUESS_SEC = 0.03;
/** The most a slow seek is allowed to lead by. */
const MAX_SEEK_LEAD_SEC = 0.15;
/** iOS seeks to within this (ms) of the time asked; Android's ExoPlayer seeks exactly. */
const SEEK_TOLERANCE_MS = 5;

/**
 * A native player's clock or state, read now. A player being replaced (a new file, a new render of the solfa) may
 * already be released when a timer fires: it then reads as stopped at 0.
 */
function read<T>(get: () => T, fallback: T): T {
  try {
    return get();
  } catch {
    return fallback;
  }
}

/**
 * The song's backing as a second player kept in step with the solfa's (boards o-backing O1b, O2b). One clock: the
 * solfa's player leads, and the backing goes where the solfa says it should be (`positionOf`, from lib/backingClock).
 *
 * - Play, pause and every seek of the solfa (a tap on the scrubber, the A–B loop going back, Back to the start) move
 *   the backing in the same tick: usePractice calls `followPlay`, `followPause` and `followSeek`.
 * - Every 250 ms while they play the backing is read between two reads of the solfa, and compared only when those two
 *   land close together (lib/backingSync `solfaAtBackingRead`: each read waits on the main thread, and a busy one made
 *   drifts the music did not have). A move while playing is a skip the ear hears,
 *   so the backing is moved back into step (a little ahead, by what a seek takes, so it lands where the solfa is by
 *   then) only past 80 ms held for 400 ms, and a small drift no sooner than 3 s after the last move (lib/backingSync
 *   `watchDrift`); at 40 ms every jitter of the two clocks was a skip, several a second.
 * - A backing still downloading when Play is pressed joins in step when it arrives; before its start (a pickup) or
 *   after its end it waits, silent.
 * - Its rate follows the solfa's speed with the pitch kept (expo-audio's pitch correction: ExoPlayer on Android, the
 *   spectral time-pitch on iOS), so half speed is still in the song's key; outside 0.5–2 it sits out.
 */
export function useBacking({
  uri,
  active,
  volume,
  rate,
  main,
  mainPlaying,
  positionOf,
}: {
  /** The backing's file; null until it is on the phone. */
  uri: string | null;
  /** It should sound: the switch on and the sheet in the song's key. */
  active: boolean;
  /** Its share of the Solfa · Backing balance, 0–1. */
  volume: number;
  /** Its playback rate: the solfa's speed (and any slower render of it). */
  rate: number;
  /** The solfa's native player, read at the same instant as the backing's. */
  main: AudioPlayer;
  /** The solfa's player is playing. */
  mainPlaying: boolean;
  /** Where the backing should be, in seconds of the recording, when the solfa's clip is at `clipSec`. */
  positionOf: (clipSec: number) => number;
}) {
  const player = useAudioPlayer(uri ? { uri } : undefined, { updateInterval: SYNC_TICK_MS });
  const status = usePlayerStatus(player);
  const loaded = !!uri && status.isLoaded;
  const usable = active && loaded && rateKeepsBacking(rate);

  const live = useRef({ usable, rate, positionOf });
  live.current = { usable, rate, positionOf };
  const sync = useRef({ seeking: false, quietUntil: 0, seekSec: FIRST_SEEK_GUESS_SEC });
  /** The drift while both play: how long it has been past the limit, and when it last moved the backing. */
  const drift = useRef(NEW_DRIFT_WATCH);
  /**
   * The solfa was asked to play and has not stopped since. Its status says so only a tick later, and a seek that
   * finishes in between must know whether to start the backing.
   */
  const intent = useRef(mainPlaying);
  const lastMainPlaying = useRef(mainPlaying);

  // The rate, its pitch kept (set first: Android reads it inside setPlaybackRate), and the balance's volume. A new
  // native player (a new file) starts at 1× and full volume, so both follow `player`.
  useEffect(() => {
    if (!uri) return;
    const r = Math.min(BACKING_RATE_MAX, Math.max(BACKING_RATE_MIN, rate));
    player.shouldCorrectPitch = r !== 1;
    player.setPlaybackRate(r, "high");
  }, [player, uri, rate]);
  useEffect(() => {
    if (!uri) return;
    player.volume = active ? Math.min(1, Math.max(0, volume)) : 0;
  }, [player, uri, active, volume]);

  /** The backing's own end, or 0 while it is not known. */
  const end = () => read(() => player.duration || 0, 0);
  const backingPlaying = () => read(() => player.playing, false);

  /** Moves the backing, then (if asked) plays it; the time a seek takes is measured for the next one's lead. */
  const seek = useCallback(
    (to: number, thenPlay: boolean) => {
      const s = sync.current;
      s.seeking = true;
      const started = Date.now();
      void player
        .seekTo(Math.max(0, to), SEEK_TOLERANCE_MS, SEEK_TOLERANCE_MS)
        .catch(() => undefined)
        .finally(() => {
          s.seeking = false;
          s.quietUntil = Date.now() + SYNC_TICK_MS;
          s.seekSec = Math.min(MAX_SEEK_LEAD_SEC, Math.max(0, (Date.now() - started) / 1000));
          if (thenPlay && live.current.usable && intent.current) player.play();
        });
    },
    [player],
  );

  /**
   * Puts the backing where the solfa's clip at `clipSec` says, playing or not as the solfa is. Returns false when the
   * backing has nothing to play there (before its start or past its end): it then waits, silent.
   */
  const place = useCallback(
    (clipSec: number, playing: boolean, lead: boolean) => {
      const { positionOf: at, rate: r } = live.current;
      const to = at(clipSec) + (lead ? sync.current.seekSec * r : 0);
      const length = end();
      if (to < 0 || (length > 0 && to >= length - 0.05)) {
        if (backingPlaying()) player.pause();
        // Before its start (a pickup): ready at 0 for the moment the solfa reaches it.
        if (to < 0 && read(() => player.currentTime, 0) > 0.01) void player.seekTo(0).catch(() => undefined);
        return false;
      }
      seek(to, playing && !backingPlaying());
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player, seek],
  );

  /** The solfa was moved (a seek, the loop going back): the backing goes with it at once. */
  const followSeek = useCallback(
    (clipSec: number) => {
      if (!live.current.usable) return;
      place(clipSec, intent.current, false);
    },
    [place],
  );

  /** The solfa starts: the backing starts with it, from where it stood if that is still in step. */
  const followPlay = useCallback(() => {
    intent.current = true;
    if (!live.current.usable) return;
    const to = live.current.positionOf(read(() => main.currentTime, 0));
    const length = end();
    if (to < 0 || (length > 0 && to >= length - 0.05)) return;
    if (needsResync(read(() => player.currentTime, -1), to)) seek(to, true);
    else player.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [main, player, seek]);

  const followPause = useCallback(() => {
    intent.current = false;
    if (backingPlaying()) player.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  // The solfa stopped by itself (its end, a call coming in) or could not play: the backing stops too. Started by a
  // way that did not go through `followPlay`, or the backing became usable while the solfa plays: it joins.
  useEffect(() => {
    if (lastMainPlaying.current !== mainPlaying) {
      lastMainPlaying.current = mainPlaying;
      intent.current = mainPlaying;
    }
    if (!mainPlaying || !usable) {
      if (backingPlaying()) player.pause();
      return;
    }
    if (!backingPlaying() && !sync.current.seeking) place(read(() => main.currentTime, 0), true, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainPlaying, usable, player, main]);

  // Kept in step while they play: both clocks read back to back, the backing moved only for a drift that holds.
  useEffect(() => {
    if (!mainPlaying || !usable) return;
    drift.current = NEW_DRIFT_WATCH;
    const timer = setInterval(() => {
      const s = sync.current;
      if (s.seeking || Date.now() < s.quietUntil) return;
      const before = read(() => main.currentTime, 0);
      const at = read(() => player.currentTime, 0);
      const after = read(() => main.currentTime, 0);
      if (!backingPlaying()) {
        // Joining: loaded late, or the solfa has reached the backing's start.
        place(after, true, true);
        return;
      }
      const length = end();
      if (length > 0 && live.current.positionOf(after) >= length - 0.05) {
        player.pause();
        return;
      }
      // The main thread was busy between the reads: they cannot be compared, and the next tick reads again.
      const clip = solfaAtBackingRead(before, after);
      if (clip === null) return;
      const step = watchDrift(drift.current, at - live.current.positionOf(clip), Date.now());
      drift.current = step.watch;
      if (step.pull) place(after, true, true);
    }, SYNC_TICK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainPlaying, usable, player, main, place]);

  return { ready: loaded, playing: status.playing, followSeek, followPlay, followPause };
}

export type BackingFollow = Pick<ReturnType<typeof useBacking>, "followSeek" | "followPlay" | "followPause" | "ready">;

export type BackingSyncProps = Parameters<typeof useBacking>[0] & {
  /** Where the solfa's player finds the backing's follow calls (usePractice's play, pause and seeks). */
  link: { current: BackingFollow | null };
  /** The backing's file loaded (or not), for the balance: the solfa stays audible until the band is here. */
  onReady: (ready: boolean) => void;
};

/**
 * The backing's player, mounted only on a sheet that has a backing file: a sheet without one creates no second native
 * player at all, and its dock and playback are exactly as before. Renders nothing.
 */
export function BackingSync({ link, onReady, ...props }: BackingSyncProps): null {
  const backing = useBacking(props);
  const { followSeek, followPlay, followPause, ready } = backing;
  useEffect(() => {
    link.current = { followSeek, followPlay, followPause, ready };
  }, [link, followSeek, followPlay, followPause, ready]);
  useEffect(() => () => {
    link.current = null;
  }, [link]);
  useEffect(() => {
    onReady(ready);
  }, [onReady, ready]);
  useEffect(() => () => onReady(false), [onReady]);
  return null;
}
