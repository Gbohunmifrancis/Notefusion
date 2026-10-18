import type { CheckoutExitReason } from "../api/types";
import type { IconName } from "../design/iconGlyphs";

/**
 * "What stopped you?" (board g-checkout): after someone comes back from a payment page without paying, one tap says
 * why, and the same sheet answers. Pure, so it is tested (`checkoutExit.test.ts`); the Upgrade screen and
 * `components/CheckoutExitSheet` use it. The website keeps its own copy in web-site/assets/checkout-exit.js.
 */

/** The longest "Something else" note, once trimmed (the API's `CheckoutExit.NoteMaxLength`). */
export const NOTE_MAX = 280;

/** How many checkouts this device remembers having asked about. */
export const ASKED_MAX = 20;

/** Longer than this is not a page left open: the API refuses it (two days). */
const MAX_SECONDS_OPEN = 2 * 24 * 60 * 60;

export interface ExitRow {
  reason: CheckoutExitReason;
  label: string;
  icon: IconName;
}

/** The six answers, in the board's order. */
export const EXIT_ROWS: readonly ExitRow[] = [
  { reason: "currency", label: "The price wasn't in my currency", icon: "currency" },
  { reason: "cardDeclined", label: "My card was declined", icon: "card-declined" },
  { reason: "slow", label: "The page was slow or didn't load", icon: "waiting" },
  { reason: "tooExpensive", label: "It costs too much", icon: "plans" },
  { reason: "justLooking", label: "I'm just looking", icon: "eye" },
  { reason: "somethingElse", label: "Something else", icon: "feedback" },
];

/** The rows for a checkout in `currency`: the currency one on dollar checkouts only (naira is already theirs). */
export function exitRows(currency: string): ExitRow[] {
  const dollars = currency.toUpperCase() === "USD";
  return EXIT_ROWS.filter((r) => r.reason !== "currency" || dollars);
}

/** What the quick payment check found once the page closed: paid, not paid, or no answer (offline, a server hiccup). */
export type PaymentCheckResult = "paid" | "unpaid" | "unknown";

export interface ReturnFacts {
  /** The provider sent the browser back to the app (its success return): a payment is being confirmed. */
  returned: boolean;
  /** The quick check after the page closed. */
  check: PaymentCheckResult;
  /** The checkout's reference, from the checkout response. */
  reference: string | null;
  /** Checkouts this device has already asked about. */
  asked: readonly string[];
}

/**
 * Whether to report the return and (if the API agrees) ask: the page was closed without the provider's return, the
 * quick check found no payment, and this checkout has not been asked about here. Never while a payment is confirming,
 * never on an unknown answer, once per checkout.
 */
export function shouldReportReturn(f: ReturnFacts): boolean {
  return !f.returned && f.check === "unpaid" && !!f.reference && !f.asked.includes(f.reference);
}

/** Whole seconds the page was open, from the moment it was opened to now. */
export function secondsOpen(openedAt: number, now: number): number {
  if (!Number.isFinite(openedAt) || !Number.isFinite(now)) return 0;
  return Math.min(MAX_SECONDS_OPEN, Math.max(0, Math.round((now - openedAt) / 1000)));
}

/** The note as sent: trimmed and cut to {@link NOTE_MAX}. */
export function cleanNote(text: string): string {
  return text.trim().slice(0, NOTE_MAX);
}

/** The asked list with `reference` first, once, kept to {@link ASKED_MAX}. */
export function rememberAsked(asked: readonly string[], reference: string): string[] {
  return [reference, ...asked.filter((r) => r !== reference)].slice(0, ASKED_MAX);
}

/** The stored asked list, or empty for anything unreadable. */
export function parseAsked(raw: string | null | undefined): string[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((r): r is string => typeof r === "string").slice(0, ASKED_MAX) : [];
  } catch {
    return [];
  }
}

/** A run of the answer's text; `strong` for the words to act on ("Bank transfer", "Try again"). */
export interface ReplyPart {
  text: string;
  strong?: boolean;
}

export type ExitReply =
  /** Closes the sheet with a toast. */
  | { kind: "toast"; message: string }
  /** The short text box ("Something else"). */
  | { kind: "note" }
  /** The answer in the same sheet: [Close] and, with `tryAgain`, [Try again]; `offerSong` adds the one-song row. */
  | { kind: "answer"; title: string; parts: ReplyPart[]; offerSong: boolean; tryAgain: boolean };

export interface ReplyContext {
  /** The checkout's currency ("USD", "NGN"). */
  currency: string;
  /** What they were buying, as the app writes it ("$9.99"). */
  price: string;
  /** The region's one-song price ("$1.99"), or null when it is not on sale to them (Pro, none listed). */
  songPrice: string | null;
  /** The checkout was the one-song purchase itself: never offer it back. */
  buyingSong: boolean;
  /** How long "Try again" hands back the same checkout, in minutes. */
  keptMinutes: number;
}

const THANKS = "Thanks for telling us";

/** The same sheet's answer to a tap (boards 02, 02b). */
export function exitReply(reason: CheckoutExitReason, ctx: ReplyContext): ExitReply {
  const offerSong = !ctx.buyingSong && !!ctx.songPrice;
  const dollars = ctx.currency.toUpperCase() === "USD";
  switch (reason) {
    case "cardDeclined":
      return {
        kind: "answer",
        title: THANKS,
        parts: [
          {
            text: dollars
              ? "Nothing was charged. Some banks outside Nigeria turn down a card payment in naira. "
              : "Nothing was charged. Banks sometimes turn down a card payment online. ",
          },
          { text: "Bank transfer", strong: true },
          { text: ", on the same page, usually goes through." },
        ],
        offerSong,
        tryAgain: true,
      };
    case "currency":
      return {
        kind: "answer",
        title: THANKS,
        parts: [
          {
            text: `The payment page turns your ${ctx.price} into naira at today's rate, so you see a naira total. Your bank may add a small fee for the conversion.`,
          },
        ],
        offerSong: false,
        tryAgain: true,
      };
    case "slow":
      return {
        kind: "answer",
        title: "Sorry it was slow",
        parts: [
          { text: "The ways to pay can take up to 20 seconds to appear. " },
          { text: "Try again", strong: true },
          { text: ` opens the same checkout: we keep it for ${Math.max(1, Math.round(ctx.keptMinutes))} minutes.` },
        ],
        offerSong: false,
        tryAgain: true,
      };
    case "tooExpensive":
      return {
        kind: "answer",
        title: THANKS,
        parts: [
          {
            text: offerSong
              ? "If one song is all you need for now, you can pay for just that, with no subscription."
              : "We read every answer when we set our prices.",
          },
        ],
        offerSong,
        tryAgain: false,
      };
    case "justLooking":
      return {
        kind: "toast",
        message: ctx.buyingSong ? "Thanks. It's here when you want it." : "Thanks. Pro is here when you want it.",
      };
    case "somethingElse":
      return { kind: "note" };
  }
}

/** The toast after a "Something else" note is sent. */
export const NOTE_THANKS = "Thanks, we'll read it";
