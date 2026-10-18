/**
 * Doh's one suggestion card on Home (board c-practice/8a): which card, if any, and what it says. Pure, so the rules
 * are tested (`dohSuggestion.test.ts`); Home reads the inputs, keeps the memory on the device (`lib/dohPrefs`) and
 * draws the card (`components/doh/DohCard`).
 *
 * Highest first, and never two cards:
 *  1. a sheet saved in the last 24 h — "“Abide with Me” is ready", Practise this tune;
 *  2. after 18:00 on the phone, today's drill not sung and a streak of 2+ days that would really end at midnight
 *     (no freeze left this week to bridge today: the reminders' own honesty, C# `PracticeReminderRules`);
 *  3. the account's first week — "Hi, I'm Doh!", only while it can transcribe (Pro, a free one left, a bought one,
 *     or billing not read yet).
 *
 * Each card is about one thing, its key (`ready:<sheet>`, `streak:<day>`, `welcome`). A key is on Home for one day at
 * most, and once it leaves — × hides it, its action was taken, or a higher card took its place — it does not come
 * back. So × hides a card until the context changes (a new sheet, another evening), and no card is shown twice a day.
 */

export type DohCardKind = "ready" | "streak" | "welcome";

/** The Doh drawn on the card: singing for a new sheet, keen for the streak, waving hello. */
export type DohCardPose = "sing" | "encourage" | "wave";

export interface DohCard {
  kind: DohCardKind;
  /** What the card is about. */
  key: string;
  pose: DohCardPose;
  title: string;
  body: string;
  /** The card's one text action. */
  action: string;
  /** The ready sheet's id. */
  sheetId?: string;
}

export interface DohStreak {
  current: number;
  todayDone: boolean;
  /** This ISO week's freeze is unused: a miss today would be bridged, not end the run. */
  freezeAvailable: boolean;
}

export interface DohInput {
  now: number;
  /** The phone's local hour, 0–23. */
  hour: number;
  /** The phone's local date, yyyy-mm-dd: the day the "once" rules count. */
  day: string;
  /** Saved sheets, any order, each with when it was saved (ms; `lib/sheetMeta` `parseUtc` reads the API's date). */
  sheets: readonly { id: string; title: string; savedAt: number }[];
  streak: DohStreak | null;
  /** When the account was made (ms), or null when not known: then there is no first-week card. */
  joinedAt: number | null;
  /** A free account's free transcriptions left this week; null for Pro or while billing is unknown. */
  freeLeft: number | null;
  /** Something can be transcribed now (Pro, a free or bought one left, or billing unknown). */
  canTranscribe: boolean;
}

/** What the phone remembers between visits. */
export interface DohMemory {
  /** The card on Home now. */
  shown: string | null;
  /** Each key shown, and the day it was first shown. */
  seen: Record<string, string>;
}

export const EMPTY_DOH_MEMORY: DohMemory = { shown: null, seen: {} };

export const READY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The streak card waits for the evening, as the reminders' last chance does. */
export const STREAK_FROM_HOUR = 18;
/** A one-day streak is not yet a streak to keep (the reminders say the same). */
export const STREAK_MIN_DAYS = 2;
export const FIRST_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Keys older than this are forgotten: none of them can come back by then. */
const FORGET_AFTER_DAYS = 14;

/** The phone's local date as yyyy-mm-dd. */
export function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Every card the moment allows, highest first. */
export function dohCandidates(input: DohInput): DohCard[] {
  const out: DohCard[] = [];

  const ready = input.sheets
    .map((s) => ({ s, at: s.savedAt }))
    .filter(({ at }) => Number.isFinite(at) && input.now - at >= 0 && input.now - at < READY_WINDOW_MS)
    .sort((a, b) => b.at - a.at)[0];
  if (ready) {
    out.push({
      kind: "ready",
      key: `ready:${ready.s.id}`,
      pose: "sing",
      title: `“${ready.s.title}” is ready`,
      body: "Sing it back once while it's fresh? Learn my part loops it for you.",
      action: "Practise this tune",
      sheetId: ready.s.id,
    });
  }

  const st = input.streak;
  if (st && !st.todayDone && st.current >= STREAK_MIN_DAYS && !st.freezeAvailable && input.hour >= STREAK_FROM_HOUR) {
    out.push({
      kind: "streak",
      key: `streak:${input.day}`,
      pose: "encourage",
      title: `Your ${st.current}-day streak ends at midnight`,
      body: "One drill keeps it going. It takes about two minutes.",
      action: "Sing today's drill",
    });
  }

  if (input.joinedAt !== null && input.now - input.joinedAt < FIRST_WEEK_MS && input.canTranscribe) {
    const free = input.freeLeft !== null && input.freeLeft > 0 ? ` You have ${input.freeLeft} free this week.` : "";
    out.push({
      kind: "welcome",
      key: "welcome",
      pose: "wave",
      title: "Hi, I'm Doh! Hum a hymn you love",
      body: `Just the first line. I'll write it in solfa.${free}`,
      action: "Hum one now",
    });
  }
  return out;
}

/** A key may show if it was never shown, or it is the card on Home now and was first shown today. */
function eligible(key: string, memory: DohMemory, day: string): boolean {
  const first = memory.seen[key];
  return first === undefined || (memory.shown === key && first === day);
}

/** The card for this moment, and the memory to keep. Call it only with the inputs read (not while loading). */
export function chooseDohCard(input: DohInput, memory: DohMemory): { card: DohCard | null; memory: DohMemory } {
  const card = dohCandidates(input).find((c) => eligible(c.key, memory, input.day)) ?? null;
  const seen = forgetOld(memory.seen, input.day);
  if (card && seen[card.key] === undefined) seen[card.key] = input.day;
  return { card, memory: { shown: card?.key ?? null, seen } };
}

/** × or the card's action: the card leaves Home and its key does not come back. */
export function dismissDohCard(memory: DohMemory, key: string, day: string): DohMemory {
  return { shown: memory.shown === key ? null : memory.shown, seen: { ...memory.seen, [key]: memory.seen[key] ?? day } };
}

function forgetOld(seen: Record<string, string>, day: string): Record<string, string> {
  const today = Date.parse(`${day}T00:00:00Z`);
  const out: Record<string, string> = {};
  for (const [k, d] of Object.entries(seen)) {
    const at = Date.parse(`${d}T00:00:00Z`);
    if (!Number.isFinite(at) || !Number.isFinite(today) || today - at < FORGET_AFTER_DAYS * 86_400_000) out[k] = d;
  }
  return out;
}

/** Reads what was stored, tolerating a missing or corrupted value. */
export function parseDohMemory(raw: string | null): DohMemory {
  if (!raw) return EMPTY_DOH_MEMORY;
  try {
    const v = JSON.parse(raw) as Partial<DohMemory>;
    const seen: Record<string, string> = {};
    if (v.seen && typeof v.seen === "object") {
      for (const [k, d] of Object.entries(v.seen)) if (typeof d === "string") seen[k] = d;
    }
    return { shown: typeof v.shown === "string" ? v.shown : null, seen };
  } catch {
    return EMPTY_DOH_MEMORY;
  }
}
