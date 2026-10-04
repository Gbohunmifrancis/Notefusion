import { Platform } from 'react-native';
import { requireOptionalNativeModule, type NativeModule } from 'expo';

/** What `addListener` hands back; `expo-modules-core` itself is not resolvable from the project root. */
export type ListenSubscription = { remove(): void };

/** A ~250 ms chunk of 16 kHz mono PCM from the microphone, as floats in −1…1. */
export interface ListenBuffer {
  samples: number[];
  sampleRate: number;
}

/**
 * `running` flips with capture. `reason`: "started" | "stopped" (the Stop action, the app swiped away,
 * or stop()) | "silenced" / "unsilenced" (another app holds the microphone) | "error" (with `code`).
 */
export interface ListenStatus {
  running: boolean;
  reason: string;
  code: string | null;
}

type Events = {
  onBuffer(buffer: ListenBuffer): void;
  onStatus(status: ListenStatus): void;
};

declare class Native extends NativeModule<Events> {
  start(): Promise<void>;
  stop(): void;
  isRunning(): boolean;
  updateNotification(title: string, body: string): void;
  setListening(listening: boolean): void;
  setLastKey(key: string, doh: string): void;
  requestAddTile(): Promise<'added' | 'already_added' | 'declined' | 'error' | 'unsupported'>;
}

// Null in Expo Go, on iOS and on web: every call below is then a no-op and `available` is false.
const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('NotefusionListen') : null;

/** Whether background listening exists on this device (Android, in a real build). */
export const available = native !== null;

/**
 * Starts the microphone foreground service. Rejects with a stable `code`:
 * E_NOT_IN_FOREGROUND (the app has to be on screen — Android 14+ rule), E_NO_MIC_PERMISSION,
 * E_NOT_ALLOWED, E_MIC_UNAVAILABLE, E_START_TIMEOUT, E_UNAVAILABLE (no native module).
 */
export async function start(): Promise<void> {
  if (!native) {
    const e = new Error('Background listening is not available here') as Error & { code: string };
    e.code = 'E_UNAVAILABLE';
    throw e;
  }
  await native.start();
}

export function stop(): void {
  native?.stop();
}

export function isRunning(): boolean {
  return native?.isRunning() ?? false;
}

/** Rewrites the ongoing notification: `{ title: "Doh is G", body: "G major" }`. */
export function updateNotification(text: { title: string; body: string }): void {
  native?.updateNotification(text.title, text.body);
}

/** Lights the Quick Settings tile while listening. The service sets this itself; JS may too. */
export function setListening(listening: boolean): void {
  native?.setListening(listening);
}

/** Shows the last detected key on the tile and the home-screen widget, e.g. ("G major", "G"). */
export function setLastKey(key: string, doh: string): void {
  native?.setLastKey(key, doh);
}

/** Android 13+ system prompt to add the tile. Call from a button press while the app is in front. */
export async function requestAddTile() {
  return native ? native.requestAddTile() : 'unsupported';
}

export function addBufferListener(fn: (buffer: ListenBuffer) => void): ListenSubscription | null {
  return native ? native.addListener('onBuffer', fn) : null;
}

export function addStatusListener(fn: (status: ListenStatus) => void): ListenSubscription | null {
  return native ? native.addListener('onStatus', fn) : null;
}
