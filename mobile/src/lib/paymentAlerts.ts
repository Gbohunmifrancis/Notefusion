/**
 * Payment alerts on an admin's phone (boards f-admin/08–09), as plain data: the Android channels, the notification's
 * actions, this phone's choices and the quiet hours. Pure and tested (paymentAlerts.test.ts); the runtime that
 * creates the channels and talks to the API is `lib/paymentAlertsRuntime.ts`.
 *
 * Mirrors C# `Application/Admin/PaymentAlerts/PaymentAlertChannels`, which names one of these channels per phone in
 * every push: keep the two in step. A channel's sound and vibration are fixed once Android has created it, so every
 * choice is a channel of its own, and the ids carry a version (`payments-v1`): a new sound is a new id. This code makes
 * `payments-v2-…` (`PAYMENT_CHANNEL_VERSION`) and tells the server so; older code made v1 and is still sent v1.
 */

export type PaymentAlertSound = "chime" | "phone" | "none";

export interface PaymentAlertPrefs {
  /** "Alert me when someone pays". */
  on: boolean;
  sound: PaymentAlertSound;
  /** The two short pulses. */
  vibrate: boolean;
  /** 22:00–07:00 on the phone's clock: banners, no sound. Off by default: always loud. */
  quietAtNight: boolean;
  /** Amount and plan only; "Tap to see who paid". */
  hideNames: boolean;
  /** Paid with no Pro, stuck checkouts. */
  problems: boolean;
}

/** An admin phone starts loud: the chime, the pulses, names shown, problems too, no quiet hours. */
export const DEFAULT_PAYMENT_ALERTS: PaymentAlertPrefs = {
  on: true,
  sound: "chime",
  vibrate: true,
  quietAtNight: false,
  hideNames: false,
  problems: true,
};

/** The chime with the pulses: the main channel (v1, older code). */
export const PAYMENTS_CHANNEL = "payments-v1";
/** No sound, no vibration: quiet hours and "Mute 1 hour". Every phone with alerts keeps it. */
export const PAYMENTS_QUIET_CHANNEL = "payments-v1-none-still";

export type ChannelVersion = 1 | 2;

/**
 * The channels this code makes, sent to the server as `channels` with the phone's settings (C#
 * `DeviceToken.PaymentChannelVersion`). Release builds before plugins/withKeepPaymentSound had res/raw/payment
 * stripped by the resource shrinker, so Android made `payments-v1` with the phone's own sound, which a channel never
 * changes. This code can only run on a build with that plugin (it is part of the fingerprint runtime, so no older
 * build is offered this update), so its new ids, `payments-v2-…`, are made with the chime.
 */
export const PAYMENT_CHANNEL_VERSION: ChannelVersion = 2;

/** No sound, no vibration, in a version's ids. */
export function quietChannel(version: ChannelVersion = 1): string {
  return `payments-v${version}-none-still`;
}
/** The admins' payment-problem alerts, apart from the payments. */
export const PAYMENT_PROBLEMS_CHANNEL = "payment-problems";
/** Every payment channel id starts with this; one no longer chosen is deleted. */
export const PAYMENT_CHANNEL_PREFIX = "payments-v";

/** The bundled chime (app.json's expo-notifications `sounds`), Android raw resource `payment`. */
export const CHIME_FILE = "payment.wav";

/** Two short pulses, unlike any other app's: wait, buzz, gap, buzz (ms). */
export const PAYMENT_VIBRATION = [0, 120, 80, 120];

/** The category the server's payment pushes name, and its two buttons. */
export const PAYMENT_CATEGORY = "payment";
export const VIEW_PAYMENT_ACTION = "view-payment";
export const MUTE_HOUR_ACTION = "mute-1h";
export const MUTE_MINUTES = 60;

/** The quiet hours, on the phone's own clock (C# `PaymentAlertChannels.QuietFromHour`/`QuietUntilHour`). */
export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 7;

export function channelFor(sound: PaymentAlertSound, vibrate: boolean, version: ChannelVersion = 1): string {
  return sound === "chime" && vibrate ? `payments-v${version}` : `payments-v${version}-${sound}${vibrate ? "" : "-still"}`;
}

export interface PaymentChannelSpec {
  id: string;
  /** What Android's settings list it as. */
  name: string;
  /** `CHIME_FILE`, null for none, or undefined for the phone's own sound. */
  sound: string | null | undefined;
  vibrate: boolean;
}

const SOUND_NAMES: Record<PaymentAlertSound, string> = {
  chime: "",
  phone: " · phone's sound",
  none: " · no sound",
};

function spec(sound: PaymentAlertSound, vibrate: boolean, version: ChannelVersion): PaymentChannelSpec {
  const id = channelFor(sound, vibrate, version);
  const name = id === quietChannel(version) ? "Payments · quiet" : `Payments${SOUND_NAMES[sound]}${vibrate ? "" : " · no vibration"}`;
  return { id, name, sound: sound === "chime" ? CHIME_FILE : sound === "none" ? null : undefined, vibrate };
}

/**
 * The payment channels this phone should have: the one its choices name, and the quiet one the server uses while it
 * is muted or in its quiet hours. Every other `payments-v*` channel is deleted, so Android's settings list only these.
 */
export function channelsToKeep(
  prefs: Pick<PaymentAlertPrefs, "sound" | "vibrate">, version: ChannelVersion = 1,
): PaymentChannelSpec[] {
  const chosen = spec(prefs.sound, prefs.vibrate, version);
  return chosen.id === quietChannel(version) ? [chosen] : [chosen, spec("none", false, version)];
}

/** Payment channel ids found on the phone that are no longer wanted. */
export function channelsToDelete(existing: readonly string[], keep: readonly PaymentChannelSpec[]): string[] {
  const wanted = new Set(keep.map((c) => c.id));
  return existing.filter((id) => id.startsWith(PAYMENT_CHANNEL_PREFIX) && !wanted.has(id));
}

/** Whether `hour` (0–23, the phone's clock) is in the quiet hours. */
export function isQuietHour(hour: number): boolean {
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

/** The quiet hours as the switch's line says them. */
export const QUIET_HOURS_LABEL = "22:00 – 07:00: banners, no sound";

/** Reads stored choices, keeping any field that is missing or malformed at its default. */
export function readPrefs(raw: unknown): PaymentAlertPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof PaymentAlertPrefs) =>
    typeof r[k] === "boolean" ? (r[k] as boolean) : (DEFAULT_PAYMENT_ALERTS[k] as boolean);
  const sound = r.sound === "chime" || r.sound === "phone" || r.sound === "none" ? r.sound : DEFAULT_PAYMENT_ALERTS.sound;
  return {
    on: bool("on"),
    sound,
    vibrate: bool("vibrate"),
    quietAtNight: bool("quietAtNight"),
    hideNames: bool("hideNames"),
    problems: bool("problems"),
  };
}

/** "Muted until 19:42" in the phone's own time, or null once it has passed. */
export function mutedLine(mutedUntilUtc: string | null | undefined, now: Date): string | null {
  if (!mutedUntilUtc) return null;
  const until = new Date(mutedUntilUtc);
  if (Number.isNaN(until.getTime()) || until <= now) return null;
  const hh = String(until.getHours()).padStart(2, "0");
  const mm = String(until.getMinutes()).padStart(2, "0");
  return `Muted until ${hh}:${mm}: banners, no sound`;
}
