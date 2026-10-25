/**
 * "Listen from anywhere" (boards r-listen R1–R3, Android): the rules apart from the native button, pill and
 * tile that act on them. What the account may send, as the overlay reads it with no JS running; the words of
 * the Settings group; the setup's three steps and which comes next. Pure, so it is testable; the native side
 * is modules/notefusion-listen (ListenPrefs reads the allowance this writes).
 */

/** "Listen for": the Record screen's mode a Listen take is sent as (mirrors the native `ListenKind`). */
export type ListenKind = "melody" | "poly" | "chords";

/** A free account's take is cut at three minutes, Pro's at six: `FreeTier.UploadSeconds` and the Pro cap on the API. */
export const FREE_TAKE_SECONDS = 180;
export const PRO_TAKE_SECONDS = 360;

/** What the overlay needs of the subscription (lib/subscription's state, or the same read off the DTO). */
export interface AllowanceSource {
  isPro: boolean;
  /** The server has answered; until then nothing is refused on these numbers. */
  known: boolean;
  freeRemaining: number;
  freePerWeek: number;
  /** "Friday 6pm", in the phone's time (lib/freeWeek). */
  freeBack: string;
  boughtRemaining: number;
}

/** The JSON handed to the native side: the pill's line and the "none left" card come from it. */
export interface ListenAllowance {
  freeLeft: number;
  freePerWeek: number;
  boughtLeft: number;
  capSeconds: number;
  back: string;
  isPro: boolean;
  known: boolean;
}

export function listenAllowance(s: AllowanceSource): ListenAllowance {
  return {
    freeLeft: Math.max(0, Math.round(s.freeRemaining || 0)),
    freePerWeek: Math.max(1, Math.round(s.freePerWeek || 3)),
    boughtLeft: s.isPro ? 0 : Math.max(0, Math.round(s.boughtRemaining || 0)),
    capSeconds: s.isPro ? PRO_TAKE_SECONDS : FREE_TAKE_SECONDS,
    back: s.freeBack,
    isPro: s.isPro,
    known: s.known,
  };
}

/** A take may start: Pro, a free one left, a bought one left, or the server not heard from yet (fail open, as the gates do). */
export function canStartTake(a: ListenAllowance): boolean {
  return !a.known || a.isPro || a.freeLeft > 0 || a.boughtLeft > 0;
}

/** "3:00", "6:00". */
export function formatTakeCap(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The pill's second line while listening (R1, "The words"). */
export function pillLine(a: ListenAllowance): string {
  const cap = formatTakeCap(a.capSeconds);
  if (a.isPro || !a.known) return `Up to ${cap} · sends when you stop`;
  if (a.freeLeft > 0) return `Free: ${a.freeLeft} of ${a.freePerWeek} left this week · up to ${cap}`;
  return `${a.boughtLeft} bought left · up to ${cap}`;
}

/** The card when a free account has none left (R3/4). */
export function noneLeftLine(a: ListenAllowance): string {
  return `No free transcriptions left this week — back on ${a.back}`;
}

/** The note under the Settings group. */
export function groupNote(a: ListenAllowance): string {
  const head = "Each take is a transcription, like one from the Record screen.";
  return a.isPro
    ? `${head} Pro: up to ${formatTakeCap(PRO_TAKE_SECONDS)} each, no weekly limit. It stops by itself when the music does.`
    : `${head} Free: ${a.freePerWeek} a week, up to ${formatTakeCap(FREE_TAKE_SECONDS)} each, from the tile. The floating button and the notification are part of Pro.`;
}

/** The floating button and Listen in notifications are Pro's; this is what a free account's row says instead. */
export const PRO_ONLY_HINT = "Part of Pro";

/** "Listen for" (R4): what a take is sent as, in the order the pill's chip steps through them. */
export const KIND_CHOICES: readonly { kind: ListenKind; label: string; detail: string }[] = [
  { kind: "melody", label: "Singing", detail: "A voice, or one instrument playing a tune. If no voice is heard, it’s read as chords." },
  { kind: "poly", label: "Instrument", detail: "An instrument playing several notes at once, like a piano piece." },
  { kind: "chords", label: "Chords", detail: "Piano or guitar chords: the chords are written over the solfa." },
];

export function kindLabel(kind: ListenKind | undefined): string {
  return KIND_CHOICES.find((k) => k.kind === kind)?.label ?? "Singing";
}

/**
 * What a Listen take is sent as: the kind it was taken for (from the native side, or the swept file's name, which ends
 * `-<kind>.m4a`), Singing when unknown. A Singing take carries the worker's safety net: no voice heard, read as chords.
 */
export function takeSubmitOptions(kind: string | undefined, fileName?: string): { mode: ListenKind; noVoiceAsChords?: boolean } {
  const fromName = fileName?.match(/-(melody|poly|chords)\.m4a$/)?.[1];
  const k = (KIND_CHOICES.some((c) => c.kind === kind) ? kind : fromName ?? "melody") as ListenKind;
  return k === "melody" ? { mode: "melody", noVoiceAsChords: true } : { mode: k };
}

// ── Setup (R3/2) ────────────────────────────────────────────────────────────

export type SetupStep = "mic" | "notifications" | "overlay";

export interface SetupState {
  mic: boolean;
  notifications: boolean;
  overlay: boolean;
}

export const SETUP_STEPS: readonly { step: SetupStep; label: string; hint: string }[] = [
  { step: "mic", label: "Microphone", hint: "To hear what’s playing" },
  { step: "notifications", label: "Notifications", hint: "To tell you when it’s ready" },
  { step: "overlay", label: "Display over other apps", hint: "For the floating button" },
];

/** The first thing still needed, in the sheet's order; null once all three are given. */
export function nextSetupStep(s: SetupState): SetupStep | null {
  for (const { step } of SETUP_STEPS) if (!s[step]) return step;
  return null;
}

export function setupDone(s: SetupState): boolean {
  return nextSetupStep(s) === null;
}

/** The sheet's one button names the next step. */
export function setupButtonLabel(s: SetupState): string {
  switch (nextSetupStep(s)) {
    case "mic":
      return "Allow microphone";
    case "notifications":
      return "Allow notifications";
    case "overlay":
      return "Open settings";
    default:
      return "Done";
  }
}

export const SETUP_WORDS = {
  title: "Listen from anywhere",
  message: "Android needs three things, once. Then a button waits on the edge of your screen, over any app.",
  overlayNote: "Android keeps this one in its own Settings: switch NoteFusion on there, then come back.",
  micRefused: "Android won’t ask again. Open NoteFusion’s settings and allow the microphone.",
  doneTitle: "You’re set",
  doneMessage: "Look for the button on the right edge. Tap it whenever something is playing.",
  notNow: "Not now",
  tileAdded: "Listen is in your Quick Settings.",
  tileByHand: "Pull down Quick Settings, tap the pencil, and drag Listen in.",
} as const;
