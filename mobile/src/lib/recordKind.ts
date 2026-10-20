/**
 * "What is this recording?" — the two answers the Record screen offers for audio from outside the
 * app (an imported file, a phone held up to a speaker), in the order and with the cost each has on
 * this account (board a-core/03). Pure, so the cost lines are tested (`recordKind.test.ts`); the
 * screen draws them as choice rows in the bottom sheet.
 *
 * The costs follow the allowance rules: a song with instruments (its voice isolated first) is one
 * of Pro's songs this month, or a bought song on a free account; a hummed or sung tune is free on
 * Pro and one of the week's free ones (then a bought one) on a free account. Billing not yet known
 * shows no cost at all rather than a wrong one.
 */

export type RecordingKind = "song" | "voice";

export interface KindBilling {
  /** The billing state has been read; until then nothing is said about cost. */
  known: boolean;
  isPro: boolean;
  /** Pro's songs left this month, when the server sent it. */
  songCreditsRemaining?: number | null;
  /** This week's free ones left. */
  freeRemaining: number;
  /** Bought transcriptions left. */
  boughtRemaining: number;
}

export interface KindChoice {
  kind: RecordingKind;
  title: string;
  icon: "song" | "sing";
  /** The answer given last time: listed first and marked. */
  lastTime: boolean;
  /** What it costs here, as a short chip; undefined when billing is not known. */
  cost?: string;
}

const TITLES: Record<RecordingKind, string> = {
  song: "A song with instruments",
  voice: "A tune I hummed or sang",
};

function boughtLine(n: number): string {
  return n === 1 ? "Uses your last bought song" : `Uses 1 of your ${n} bought songs`;
}

function songCost(b: KindBilling): string | undefined {
  if (!b.known) return undefined;
  if (b.isPro) {
    const n = b.songCreditsRemaining;
    if (typeof n !== "number") return undefined;
    if (n <= 0) return "No songs left this month";
    return n === 1 ? "Your last song this month" : `1 of your ${n} songs this month`;
  }
  return b.boughtRemaining > 0 ? boughtLine(b.boughtRemaining) : "Needs Pro or a bought song";
}

function tuneCost(b: KindBilling): string | undefined {
  if (!b.known) return undefined;
  if (b.isPro) return "Costs nothing";
  if (b.freeRemaining > 0) {
    return b.freeRemaining === 1 ? "Uses your last free one this week" : `Uses 1 of ${b.freeRemaining} free this week`;
  }
  // A submit spends a free one while any is left, then a bought one.
  return b.boughtRemaining > 0 ? boughtLine(b.boughtRemaining) : undefined;
}

/** Where the audio came from, and whether this phone has answered the question before. */
export interface KindContext {
  answered: boolean;
  fromMic: boolean;
}

/**
 * The answer put first before anyone has given one. A take from the mic is a hummed or sung tune (a phone held
 * up to a speaker is the exception); a file from the phone is a song, unless this account cannot send a song
 * (free, none bought), when offering it first only led to "Songs need Pro" and a second choice.
 */
export function defaultKind(fromMic: boolean, billing: KindBilling): RecordingKind {
  if (fromMic) return "voice";
  const cannotSendSong = billing.known && !billing.isPro && billing.boughtRemaining <= 0;
  return cannotSendSong ? "voice" : "song";
}

/** The two answers: the one given last time first (and marked), else the likelier one for where the audio came from. */
export function recordKindChoices(
  remembered: RecordingKind,
  billing: KindBilling,
  context: KindContext = { answered: true, fromMic: false },
): KindChoice[] {
  const first = context.answered ? remembered : defaultKind(context.fromMic, billing);
  const song: KindChoice = {
    kind: "song",
    title: TITLES.song,
    icon: "song",
    lastTime: context.answered && remembered === "song",
    cost: songCost(billing),
  };
  const voice: KindChoice = {
    kind: "voice",
    title: TITLES.voice,
    icon: "sing",
    lastTime: context.answered && remembered === "voice",
    cost: tuneCost(billing),
  };
  return first === "song" ? [song, voice] : [voice, song];
}
