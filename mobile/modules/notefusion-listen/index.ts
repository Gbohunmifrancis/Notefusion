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

/** "Listen from anywhere" (boards r-listen): what the room's microphone hears, or what the phone itself plays. */
export type ListenSource = 'room' | 'phone';

export interface AnywhereState {
  /** The floating button switch. It shows only while `overlayPermitted` too. */
  button: boolean;
  /** The quiet notification with Listen. */
  notification: boolean;
  source: ListenSource;
  /** Android's "Display over other apps", granted on its own Settings page. */
  overlayPermitted: boolean;
  /** Playback capture exists (Android 10+). */
  phoneSoundAvailable: boolean;
  /** The Listen tile was added through the system prompt (or found already there). */
  tileAdded: boolean;
  /** A take is being recorded right now. */
  listening: boolean;
  /**
   * The account is Pro as the phone last heard it: the floating button and the notification are Pro's and show only
   * then (the switches keep their place). The tile is everyone's.
   */
  pro?: boolean;
}

/** Something the native side did with no JS running, for the admin console (lib/appEvents sends it). */
export interface NativeEvent {
  name: string;
  /** Flat `key=value;…` pairs: where it came from, how long, why it ended. Nothing about the person. */
  detail: string;
  /** Epoch milliseconds, the phone's clock. */
  at: number;
}

export type TileResult = 'added' | 'already_added' | 'declined' | 'error' | 'unsupported';

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
  requestAddTile(): Promise<TileResult>;
  getAnywhere(): AnywhereState;
  setAnywhere(options: { button?: boolean; notification?: boolean; source?: ListenSource }): AnywhereState;
  hasOverlayPermission(): boolean;
  openOverlaySettings(): boolean;
  setAllowance(json: string | null): void;
  setAccount(signedIn: boolean): void;
  setDataSaver(on: boolean): void;
  requestAddTakeTile(): Promise<TileResult>;
  setTakeTileAdded(added: boolean): void;
  takeHandled(): void;
  pendingTakes(): { uri: string; fileName: string }[];
  /** Absent on store builds before build 61: an OTA running there drains nothing. */
  drainEvents?(): string;
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

// ── Listen from anywhere ─────────────────────────────────────────────────────

/** The feature's state, or null where it does not exist (iOS, Expo Go, web). */
export function getAnywhere(): AnywhereState | null {
  return native ? native.getAnywhere() : null;
}

/** Sets what is given, leaves the rest, and starts or stops the service to match. */
export function setAnywhere(options: { button?: boolean; notification?: boolean; source?: ListenSource }): AnywhereState | null {
  return native ? native.setAnywhere(options) : null;
}

export function hasOverlayPermission(): boolean {
  return native?.hasOverlayPermission() ?? false;
}

/** Android's own "Display over other apps" page for this app. */
export function openOverlaySettings(): boolean {
  return native?.openOverlaySettings() ?? false;
}

/** What the account may send, as JSON (lib/listenAnywhere `listenAllowance`); null forgets it. */
export function setAllowance(json: string | null): void {
  native?.setAllowance(json);
}

export function setAccount(signedIn: boolean): void {
  native?.setAccount(signedIn);
}

export function setDataSaver(on: boolean): void {
  native?.setDataSaver(on);
}

export async function requestAddTakeTile(): Promise<TileResult> {
  return native ? native.requestAddTakeTile() : 'unsupported';
}

export function setTakeTileAdded(added: boolean): void {
  native?.setTakeTileAdded(added);
}

/** The headless task has queued (or given up on) its take. */
export function takeHandled(): void {
  native?.takeHandled();
}

/** Takes the headless task never received (the process died in between), for the app to queue. */
export function pendingTakes(): { uri: string; fileName: string }[] {
  return native?.pendingTakes() ?? [];
}

/** The native side's events since the last call, the log emptied (lib/appEvents). */
export function drainEvents(): NativeEvent[] {
  const raw = native?.drainEvents?.();
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list)
      ? list.filter((e): e is NativeEvent => !!e && typeof e.name === 'string' && typeof e.at === 'number')
      : [];
  } catch {
    return [];
  }
}
