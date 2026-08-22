import { useCallback, useEffect, useRef, useState } from "react";
import { File, Paths } from "expo-file-system";
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
} from "expo-audio";
import type { NoteEvent } from "../api/types";
import { beatSecOf } from "./synth";

/**
 * useNotePlayer — plays the server-synthesised WAV audio preview
 * (`TranscriptionResult.audioPreviewBase64`) and tracks which transcribed note
 * is currently sounding, so the UI can highlight the matching solfa syllable
 * in sync with playback.
 *
 * Why a cache file is required
 * ─────────────────────────────
 * expo-audio's `useAudioPlayer` needs a file URI for local playback.
 * The hook writes the base64 payload to `FileSystem.cacheDirectory` once per
 * result and deletes it again on unmount or when a new preview replaces it,
 * so the cache never accumulates stale audio clips.
 *
 * Note-highlight tracking
 * ────────────────────────
 * Each `NoteEvent` carries `startBeat` / `durBeats`, which — combined with the
 * transcription's tempo (BPM) — gives an exact [startSec, endSec) window per
 * note. On every playback progress tick the hook finds which window contains
 * the current position and exposes it as `currentNoteIndex`.
 */

export interface NotePlayerState {
  /** True once the sound has finished loading and is ready to play. */
  ready: boolean;
  /** True while the audio file is being written / player is loading. */
  isLoading: boolean;
  /** True while audio is actively playing (not paused/stopped). */
  isPlaying: boolean;
  /** Current playback position, in seconds. */
  position: number;
  /** Total clip duration, in seconds (0 until the player reports it). */
  duration: number;
  /**
   * Index into the `notes` array of the note currently sounding, or -1 when
   * playback is stopped, between notes, or no preview is loaded.
   */
  currentNoteIndex: number;
  /** Playback speed, 1 being the transcribed tempo. */
  rate: number;
  /** True when the clip restarts on reaching the end. */
  loop: boolean;
  /** Human-readable error message from load/playback failures, or null. */
  error: string | null;
}

export interface UseNotePlayerResult extends NotePlayerState {
  play: () => void;
  pause: () => void;
  stop: () => void;
  /** Seek to an absolute position, in seconds. */
  seekTo: (seconds: number) => Promise<void>;
  /** Convenience: pause if playing, otherwise play. */
  toggle: () => void;
  /**
   * Change playback speed without changing pitch. Clamped to
   * [`MIN_RATE`, `MAX_RATE`].
   */
  setRate: (rate: number) => void;
  setLoop: (loop: boolean) => void;
  /** Back to the beginning, still playing if it was. */
  skipToStart: () => void;
}

/**
 * 2 is the platform ceiling on both iOS and Android. The floor is ours: pitch
 * correction below half speed starts to warble badly enough that the melody is
 * harder to follow than it was at full speed, which defeats the point.
 */
export const MIN_RATE = 0.5;
export const MAX_RATE = 2;

interface NoteWindow {
  start: number;
  end: number;
}

/**
 * @param audioPreviewBase64  Base64 WAV payload from the transcription result
 *                            (`TranscriptionResult.audioPreviewBase64`). Pass
 *                            `undefined`/`null`/`""` to render "no preview".
 * @param notes               The transcription's note list — used only for
 *                            computing playback highlight windows, never
 *                            mutated.
 * @param tempoBpm            The transcription's tempo, used to convert each
 *                            note's beat position into seconds.
 * @param leadInSec           Audio in front of the first beat — a count-in.
 *                            Every highlight window shifts by it, which is what
 *                            keeps `currentNoteIndex` (and so the stave cursor)
 *                            honest while the count-in is still clicking. See
 *                            `lib/synth.ts`'s `leadInSec`, which computes it.
 */
export function useNotePlayer(
  audioPreviewBase64: string | null | undefined,
  notes: NoteEvent[],
  tempoBpm: number,
  leadInSec = 0,
): UseNotePlayerResult {
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRateState] = useState(1);
  const [loop, setLoopState] = useState(false);

  const noteWindowsRef = useRef<NoteWindow[]>([]);
  const mountedRef = useRef(true);
  // Tracks the currently-written cache file so the write effect can delete the
  // previous clip without depending on `fileUri` (which it also sets — that
  // would re-run the effect and delete the file it just created).
  const fileRef = useRef<File | null>(null);

  // Best-effort deletion of a cache file; a leftover temp file is not fatal.
  const deleteQuietly = (file: File | null) => {
    if (!file) return;
    try {
      if (file.exists) file.delete();
    } catch {
      // Already gone or locked — ignore.
    }
  };

  // Recompute note highlight windows whenever the notes, tempo or count-in change.
  useEffect(() => {
    const beatSec = beatSecOf(tempoBpm);
    noteWindowsRef.current = notes.map((n) => ({
      start: leadInSec + n.startBeat * beatSec,
      end: leadInSec + (n.startBeat + n.durBeats) * beatSec,
    }));
  }, [notes, tempoBpm, leadInSec]);

  // Track mount state for async cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Write base64 to cache file whenever the payload changes
  useEffect(() => {
    let cancelled = false;

    async function prepareFile() {
      // Clean up the previously-written clip, if any.
      const previous = fileRef.current;
      fileRef.current = null;
      deleteQuietly(previous);

      if (!audioPreviewBase64 || audioPreviewBase64.length === 0) {
        setFileUri(null);
        setIsLoading(false);
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // A unique filename per load avoids reading a stale cached clip if the
        // same job somehow resolves twice.
        const file = new File(
          Paths.cache,
          `notefusion-preview-${Date.now()}.wav`
        );
        file.write(audioPreviewBase64, { encoding: "base64" });

        if (cancelled || !mountedRef.current) {
          deleteQuietly(file);
          return;
        }

        // Ensure playback works even if the device's silent switch is on (iOS)
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: false,
        });

        fileRef.current = file;
        setFileUri(file.uri);
        setIsLoading(false);
      } catch (e) {
        if (!cancelled && mountedRef.current) {
          setError(
            e instanceof Error ? e.message : "Could not load the audio preview."
          );
          setIsLoading(false);
        }
      }
    }

    void prepareFile();

    return () => {
      cancelled = true;
    };
  }, [audioPreviewBase64]);

  // Clean up the last cache file on unmount.
  useEffect(() => {
    return () => {
      const last = fileRef.current;
      fileRef.current = null;
      deleteQuietly(last);
    };
  }, []);

  // Create the audio player with the file URI
  const player = useAudioPlayer(fileUri ? { uri: fileUri } : undefined);
  const status = useAudioPlayerStatus(player);

  /**
   * Re-apply the practice settings to the player.
   *
   * This has to react to `player`, not just to the settings: `useAudioPlayer`
   * builds a *new* native player whenever the source changes, and a new one
   * starts at 1× and un-looped. Turning the metronome on rewrites the clip, so
   * without this a chosen speed would silently snap back to normal at the very
   * moment the user was trying to practise slowly.
   */
  useEffect(() => {
    // Pitch correction is not optional here: at 0.5× without it the melody drops
    // an octave, and a solfa exercise sung an octave low is the wrong exercise.
    // It must also be set *first* — Android reads it inside `setPlaybackRate` to
    // decide the pitch factor, so setting it afterwards would apply to the next
    // rate change rather than this one.
    player.shouldCorrectPitch = true;
    player.setPlaybackRate(rate, "high");
    player.loop = loop;
  }, [player, rate, loop]);

  // Compute the current note index from playback position
  const currentNoteIndex = status.playing
    ? findNoteIndexAt(noteWindowsRef.current, status.currentTime)
    : -1;

  // Control methods
  const play = useCallback(() => {
    player.play();
  }, [player]);

  const pause = useCallback(() => {
    player.pause();
  }, [player]);

  const stop = useCallback(() => {
    player.pause();
    void player.seekTo(0);
  }, [player]);

  const seekTo = useCallback(
    async (seconds: number) => {
      await player.seekTo(Math.max(0, seconds));
    },
    [player]
  );

  const toggle = useCallback(() => {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  }, [status.playing, player]);

  const setRate = useCallback((next: number) => {
    setRateState(Math.min(Math.max(next, MIN_RATE), MAX_RATE));
  }, []);

  const setLoop = useCallback((next: boolean) => {
    setLoopState(next);
  }, []);

  // Seeks without pausing: mid-run, "start again" means start again, and having
  // to press play afterwards breaks the rhythm of practising a passage.
  const skipToStart = useCallback(() => {
    void player.seekTo(0);
  }, [player]);

  return {
    ready: status.isLoaded && !isLoading,
    isLoading,
    isPlaying: status.playing,
    position: status.currentTime,
    duration: status.duration,
    currentNoteIndex,
    rate,
    loop,
    error: error || status.error,
    play,
    pause,
    stop,
    seekTo,
    toggle,
    setRate,
    setLoop,
    skipToStart,
  };
}

/**
 * Linear scan for the note window containing `positionSec`.
 */
function findNoteIndexAt(windows: NoteWindow[], positionSec: number): number {
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    if (positionSec >= w.start && positionSec < w.end) {
      return i;
    }
  }
  return -1;
}
