import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import * as Listen from '../../modules/notefusion-listen';
import { KeyDetector, type KeyStatus } from './keyDetect';
import { dohPitchClass, KEY_CHOICES } from './solfa';
import { isExpoGo } from './env';

/**
 * "Find the key": drives the microphone service and the key estimator, and turns what they say into
 * plain words for the screen and the notification.
 *
 * The loop is driven by the native buffer events, never by a timer — React Native pauses JS timers
 * while the app is in the background, which is exactly when this has to keep working. Every 250 ms
 * chunk goes through `KeyDetector`; when the *stable* key changes the notification is rewritten and
 * the tile and widget learn the new key. Nothing here is a transcription: no upload, no credit.
 */

export interface KeyListenerState {
  /** Whether listening exists on this device (Android, real build). */
  available: boolean;
  running: boolean;
  starting: boolean;
  /** False while nothing above the silence floor has been heard for a second. */
  hearing: boolean;
  /** Another app holds the microphone (a call, an assistant); our audio is silence until it lets go. */
  silenced: boolean;
  /** "G" — the doh of the stable key, la-based for minor; null until a key settles. */
  doh: string | null;
  /** "G major" */
  keyName: string | null;
  /** 0..1 for the stable key, or the frame-by-frame guess before one settles. */
  confidence: number;
  /** "Dm" — the chord sounding now, when one dominates. */
  chord: string | null;
  /** A plain sentence for the screen, never a code or a stack. */
  error: string | null;
}

const IDLE: KeyListenerState = {
  available: Listen.available,
  running: false,
  starting: false,
  hearing: false,
  silenced: false,
  doh: null,
  keyName: null,
  confidence: 0,
  chord: null,
  error: null,
};

/** "G major" / "E minor" — KEY_CHOICES is the twelve majors then the twelve minors, in pitch order. */
function keyNameOf(tonic: number, mode: 'major' | 'minor'): string {
  return KEY_CHOICES[mode === 'major' ? tonic : 12 + tonic]!;
}

/** "G" for pitch class 7. */
function pitchNameOf(pc: number): string {
  return KEY_CHOICES[pc]!.replace(' major', '');
}

/** "Dm", "F#" — the chord as a singer would write it over the solfa. */
function chordSymbol(root: number, quality: 'maj' | 'min'): string {
  return pitchNameOf(root) + (quality === 'min' ? 'm' : '');
}

const MIC_DENIED = 'Allow the microphone so NoteFusion can hear the music. You can turn it on in your phone settings.';
const NOT_HERE = 'Background listening is on Android for now.';

/** Every failure the native side can report, as a sentence for the screen. */
function messageFor(code: string | undefined): string {
  switch (code) {
    case 'E_NOT_IN_FOREGROUND':
    case 'E_NOT_ALLOWED':
      return 'Open NoteFusion on screen and tap Start — Android only lets listening begin while the app is in front.';
    case 'E_NO_MIC_PERMISSION':
      return MIC_DENIED;
    case 'E_MIC_UNAVAILABLE':
      return 'The microphone is busy — another app may be using it. Close it and try again.';
    case 'E_UNAVAILABLE':
      return NOT_HERE;
    default:
      return 'Listening could not start. Try again with NoteFusion on screen.';
  }
}

export function useKeyListener() {
  const [state, setState] = useState<KeyListenerState>(() => ({ ...IDLE, running: Listen.isRunning() }));
  const detector = useRef<KeyDetector | null>(null);
  /** The stable key the notification, tile and widget last heard about. */
  const shown = useRef<string | null>(null);

  const apply = useCallback((status: KeyStatus) => {
    const stable = status.stable;
    const doh = stable ? pitchNameOf(dohPitchClass({ tonicPitchClass: stable.tonic, mode: stable.mode })) : null;
    const keyName = stable ? keyNameOf(stable.tonic, stable.mode) : null;
    if (keyName && doh && keyName !== shown.current) {
      shown.current = keyName;
      Listen.updateNotification({ title: `Doh is ${doh} · ${keyName}`, body: 'Still listening — tap to open, Stop to end' });
      Listen.setLastKey(keyName, doh);
    }
    setState((s) => ({
      ...s,
      hearing: status.hearing,
      doh,
      keyName,
      confidence: stable?.confidence ?? status.candidate?.confidence ?? 0,
      chord: status.chord ? chordSymbol(status.chord.root, status.chord.quality) : null,
    }));
  }, []);

  useEffect(() => {
    if (!Listen.available) return;
    const buffers = Listen.addBufferListener(({ samples }) => {
      // A detector may be missing when JS reloaded under a service that kept running.
      if (!detector.current) detector.current = new KeyDetector(16000);
      apply(detector.current.push(samples));
    });
    const statuses = Listen.addStatusListener(({ running, reason, code }) => {
      setState((s) => {
        if (reason === 'silenced') return { ...s, silenced: true };
        if (reason === 'unsilenced') return { ...s, silenced: false };
        if (reason === 'error') return { ...s, running: false, starting: false, error: messageFor(code ?? undefined) };
        return { ...s, running, starting: false, silenced: false, hearing: running ? s.hearing : false };
      });
    });
    return () => {
      buffers?.remove();
      statuses?.remove();
    };
  }, [apply]);

  const start = useCallback(async () => {
    if (!Listen.available) {
      setState((s) => ({ ...s, error: NOT_HERE }));
      return;
    }
    setState((s) => ({ ...s, starting: true, error: null }));
    try {
      const mic = await requestRecordingPermissionsAsync();
      if (!mic.granted) {
        setState((s) => ({ ...s, starting: false, error: MIC_DENIED }));
        return;
      }
      // Android 13+ asks before an app may post notifications; the ongoing one is how the key reaches
      // someone who has switched to Spotify. A refusal is not fatal — listening still works on screen.
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33 && !isExpoGo) {
        try {
          const Notifications = require('expo-notifications') as typeof import('expo-notifications');
          const current = await Notifications.getPermissionsAsync();
          if (current.status === 'undetermined') await Notifications.requestPermissionsAsync();
        } catch {
          // no notification, still a working screen
        }
      }
      detector.current = new KeyDetector(16000);
      shown.current = null;
      await Listen.start();
      setState((s) => ({ ...s, running: true, starting: false, doh: null, keyName: null, chord: null, confidence: 0 }));
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      setState((s) => ({ ...s, starting: false, running: false, error: messageFor(code) }));
    }
  }, []);

  const stop = useCallback(() => {
    Listen.stop();
    setState((s) => ({ ...s, running: false, starting: false, hearing: false, silenced: false }));
  }, []);

  return { ...state, start, stop };
}
