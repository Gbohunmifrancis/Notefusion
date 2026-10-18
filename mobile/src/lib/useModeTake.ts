/**
 * The practice modes' sound and microphone on the phone (boards c-practice/6b–6d): play a clip the synth wrote
 * ("Hear it", a warm-up guide, a rhythm), and record a take while its own clip plays (the count-in, then pitch
 * match's tones or harmony's tune), then send it to be marked or measured. One clip and one recording at a time,
 * timed on the wall clock the way the daily drill is, and nothing left playing or listening once the screen is left.
 *
 * JS only (expo-audio and expo-file-system, already in the app), so it ships over the air. There is no live pitch
 * here: phones have no pitch stream until a store build adds one, so a take is held, then marked by the server.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { File, Paths } from "expo-file-system";
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
} from "expo-audio";

/** As the daily drill records: one voice at 22 kHz, which is all the grader reads. */
const RECORDING = { ...RecordingPresets.HIGH_QUALITY, sampleRate: 22050, numberOfChannels: 1 };

export type TakePhase = "idle" | "leadin" | "live" | "sending";

export class MicDenied extends Error {
  constructor() {
    super("Microphone permission is needed to hear you sing.");
  }
}

export function useModeTake() {
  const recorder = useAudioRecorder(RECORDING);
  const [phase, setPhase] = useState<TakePhase>("idle");
  /** Seconds since the recording (or the clip) started. */
  const [elapsed, setElapsed] = useState(0);
  /** What is playing without the microphone ("Hear it", a guide, a replay): its tag, or null. */
  const [playing, setPlaying] = useState<string | null>(null);

  const player = useRef<AudioPlayer | null>(null);
  const clip = useRef<File | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopAt = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const leadIn = useRef(0);
  /** Settles the take in hand: with the recording's uri, or null when it was cancelled. */
  const settle = useRef<((uri: string | null) => void) | null>(null);
  const live = useRef(true);
  const phaseRef = useRef<TakePhase>("idle");
  phaseRef.current = phase;

  const clearTimers = () => {
    if (tick.current) clearInterval(tick.current);
    if (stopAt.current) clearTimeout(stopAt.current);
    tick.current = null;
    stopAt.current = null;
  };

  const release = useCallback(() => {
    clearTimers();
    try { player.current?.remove(); } catch { /* already released */ }
    player.current = null;
    try { if (clip.current?.exists) clip.current.delete(); } catch { /* already gone */ }
    clip.current = null;
  }, []);

  /** Stops whatever plays (not a recording). */
  const stopPlaying = useCallback(() => {
    if (phaseRef.current !== "idle") return;
    release();
    setPlaying(null);
  }, [release]);

  /** Drops a take in hand: nothing is sent and none of the day's marks is spent. */
  const cancel = useCallback(() => {
    const pending = settle.current;
    settle.current = null;
    release();
    setPlaying(null);
    if (phaseRef.current === "leadin" || phaseRef.current === "live") {
      void recorder.stop().catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    }
    setPhase("idle");
    pending?.(null);
  }, [recorder, release]);

  // Leaving the screen (or the app's back gesture) stops the sound and the microphone.
  useFocusEffect(useCallback(() => () => cancel(), [cancel]));
  useEffect(() => () => { live.current = false; }, []);

  function writeClip(base64: string, name: string): File {
    const file = new File(Paths.cache, `notefusion-${name}-${Date.now()}.wav`);
    file.write(base64, { encoding: "base64" });
    return file;
  }

  /** Plays a clip the synth wrote, `seconds` long, tagged so the screen can show which one is sounding. */
  const play = useCallback((base64Wav: string, seconds: number, tag: string) => {
    if (phaseRef.current !== "idle") return;
    release();
    try {
      clip.current = writeClip(base64Wav, "practice");
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      player.current = createAudioPlayer({ uri: clip.current.uri });
      player.current.play();
      startedAt.current = Date.now();
      setElapsed(0);
      setPlaying(tag);
      tick.current = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 100);
      stopAt.current = setTimeout(() => { release(); if (live.current) setPlaying(null); }, (seconds + 0.4) * 1000);
    } catch (e) {
      release();
      setPlaying(null);
      throw e;
    }
  }, [release]);

  /** Plays the singer's own take back (Focused's "Replay my take"). */
  const replay = useCallback((uri: string, seconds: number) => {
    if (phaseRef.current !== "idle") return;
    release();
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    player.current = createAudioPlayer({ uri });
    player.current.play();
    setPlaying("replay");
    stopAt.current = setTimeout(() => { release(); if (live.current) setPlaying(null); }, (seconds + 0.4) * 1000);
  }, [release]);

  /** Ends the recording now and sends what was sung (the Stop button, or the take's own end). */
  const finish = useCallback(async () => {
    const pending = settle.current;
    if (!pending) return;
    settle.current = null;
    release();
    setPhase("sending");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      pending(recorder.uri ?? null);
      if (!recorder.uri && live.current) setPhase("idle");
    } catch {
      pending(null);
      if (live.current) setPhase("idle");
    }
  }, [recorder, release]);

  /**
   * Records `seconds` while `clipBase64` plays (the count-in and anything the mode plays under the singer; null plays
   * nothing), then hands the recording to `send`. Resolves with what `send` answered and the take's uri, or null when
   * the take was cancelled. A refused microphone throws `MicDenied`; anything `send` throws comes through.
   */
  const record = useCallback(async <T,>(opts: {
    clipBase64: string | null;
    leadInSec: number;
    seconds: number;
    send: (uri: string) => Promise<T>;
  }): Promise<{ value: T; uri: string } | null> => {
    if (phaseRef.current !== "idle") return null;
    release();
    setPlaying(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) throw new MicDenied();
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldRouteThroughEarpiece: false });
    if (opts.clipBase64) clip.current = writeClip(opts.clipBase64, "take");
    await recorder.prepareToRecordAsync();
    const done = new Promise<string | null>((resolve) => { settle.current = resolve; });
    recorder.record();
    startedAt.current = Date.now();
    leadIn.current = opts.leadInSec;
    if (clip.current) {
      player.current = createAudioPlayer({ uri: clip.current.uri });
      player.current.play();
    }
    setElapsed(0);
    setPhase(opts.leadInSec > 0 ? "leadin" : "live");
    tick.current = setInterval(() => {
      const t = (Date.now() - startedAt.current) / 1000;
      setElapsed(t);
      if (t >= leadIn.current) setPhase((p) => (p === "leadin" ? "live" : p));
    }, 100);
    stopAt.current = setTimeout(() => void finish(), opts.seconds * 1000);

    const uri = await done;
    if (!uri) return null;
    try {
      const value = await opts.send(uri);
      return { value, uri };
    } finally {
      if (live.current) setPhase("idle");
    }
  }, [recorder, release, finish]);

  return { phase, elapsed, playing, play, replay, stopPlaying, record, finish, cancel };
}
