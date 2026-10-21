/**
 * The song's backing on the phone (boards o-backing O1–O3), as plain rules: what the dock shows about it, how the
 * Solfa · Backing balance sets the two volumes, when the backing player is pulled back into step, and the words.
 * The clock itself (where a beat falls in the recording) is `backingClock.ts`; the players are
 * `components/result/useBacking.ts`; the file behind it is `backingAudio.ts`.
 */

/** Past this the backing is pulled back into step with the solfa (board O1b: checked every 250 ms). */
export const DRIFT_LIMIT_SEC = 0.04;
/** How often the two players are compared while they play. */
export const SYNC_TICK_MS = 250;

/**
 * The rates the backing plays at with its pitch kept. expo-audio keeps the pitch at any rate it takes, 0.1–2 on
 * Android (ExoPlayer's PlaybackParameters, speed with pitch 1) and 0–2 on iOS (AVPlayer's spectral time-pitch); below
 * half speed a stretched band warbles more than it helps, so it sits out there, as the solfa's own floor is 0.5.
 */
export const BACKING_RATE_MIN = 0.5;
export const BACKING_RATE_MAX = 2;

/** True when the backing can follow the solfa at this rate. */
export function rateKeepsBacking(rate: number): boolean {
  return Number.isFinite(rate) && rate >= BACKING_RATE_MIN - 1e-9 && rate <= BACKING_RATE_MAX + 1e-9;
}

/** True when the backing has wandered far enough from where the solfa says it should be to be moved back. */
export function needsResync(backingSec: number, targetSec: number, limit = DRIFT_LIMIT_SEC): boolean {
  return Math.abs(backingSec - targetSec) > limit;
}

// ── The balance ──────────────────────────────────────────────────────────────────────────────────────────────

/** Where the thumb starts: 40 % toward Backing, so the solfa is on top and the band under it. */
export const DEFAULT_BALANCE = 0.4;
/** One screen-reader step. */
export const BALANCE_STEP = 0.1;

export function clampBalance(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_BALANCE;
}

/**
 * The two volumes for a balance (0 = the solfa alone, 0.5 = even, 1 = the backing alone). The louder side is
 * always at full volume and the other at its share of it: at 40 % the solfa is full and the backing two-thirds
 * (40 : 60), at either end the other side is silent.
 */
export function balanceVolumes(balance: number): { solfa: number; backing: number } {
  const v = clampBalance(balance);
  if (v <= 0.5) return { solfa: 1, backing: v / (1 - v) };
  return { solfa: (1 - v) / v, backing: 1 };
}

/** Which end is louder, and so shows in the text colour; neither at the middle mark. */
export function louderEnd(balance: number): "solfa" | "backing" | null {
  const v = Math.round(clampBalance(balance) * 1000) / 1000;
  if (v < 0.5) return "solfa";
  if (v > 0.5) return "backing";
  return null;
}

/** A screen reader's swipe up or down: ten percent on or back, on the tens. */
export function stepBalance(balance: number, direction: 1 | -1): number {
  const tens = Math.round(clampBalance(balance) * 10) + direction;
  return clampBalance(tens / 10);
}

/** What a screen reader hears after "Balance": "backing 40 percent". */
export function balanceValueText(balance: number): string {
  return `backing ${Math.round(clampBalance(balance) * 100)} percent`;
}

// ── Remembered on the phone ──────────────────────────────────────────────────────────────────────────────────

/** The switch and the balance, per device, for every sheet with backing (like `nf.result.view`). */
export interface BackingPrefs {
  on: boolean;
  balance: number;
}

export const DEFAULT_BACKING_PREFS: BackingPrefs = { on: true, balance: DEFAULT_BALANCE };

export function parseBackingPrefs(raw: string | null | undefined): BackingPrefs {
  if (!raw) return DEFAULT_BACKING_PREFS;
  try {
    const x = JSON.parse(raw) as Partial<BackingPrefs> | null;
    return {
      on: typeof x?.on === "boolean" ? x.on : DEFAULT_BACKING_PREFS.on,
      balance: typeof x?.balance === "number" ? clampBalance(x.balance) : DEFAULT_BACKING_PREFS.balance,
    };
  } catch {
    return DEFAULT_BACKING_PREFS;
  }
}

// ── What the dock shows ──────────────────────────────────────────────────────────────────────────────────────

/**
 * - `none`: no backing, and nothing to say: the dock is exactly as it was before there was backing.
 * - `linkLater`: a sheet from a pasted link opened again: one muted line, no switch (board O3, 4).
 * - `transposed`: the sheet was moved to another key: the switch greyed and off, the line why, and the way back (O3, 3).
 * - `playable`: the switch and the balance (O1); `freshLink` adds the muted line under the balance (O3, 4).
 */
export type BackingRows =
  | { kind: "none" }
  | { kind: "linkLater" }
  | { kind: "transposed"; backTo: string }
  | { kind: "playable"; freshLink: boolean };

export interface BackingFacts {
  /** The sheet comes with a backing to play: the job's (fresh), the one kept with the sheet, or one sent inline. */
  available: boolean;
  /** It was asked for and the server no longer has it (404 `BACKING_NOT_FOUND`). */
  gone: boolean;
  /** The song came from a pasted link (YouTube, Spotify, Apple Music). */
  fromLink: boolean;
  /** A saved sheet opened again from the Library or Home, not the result of the job that just finished. */
  reopened: boolean;
  /** Semitones the sheet has been moved from the key the backing plays in (0 = its own key). */
  transposedBy: number;
  /** The sheet is the hymnbook's version of the tune: its notes are the book's, not the take's, so not on its clock. */
  hymnbook: boolean;
  /** The key the backing plays in, as the transpose panel names keys ("Eb major"). */
  originalKey: string;
}

export function backingRows(f: BackingFacts): BackingRows {
  const link: BackingRows = { kind: "linkLater" };
  if (!f.available || f.gone) return f.fromLink && (f.reopened || f.gone) ? link : { kind: "none" };
  if (f.hymnbook) return f.fromLink && f.reopened ? link : { kind: "none" };
  if (f.transposedBy !== 0) return { kind: "transposed", backTo: f.originalKey };
  return { kind: "playable", freshLink: f.fromLink };
}

/** True when the rows say anything at all: the dock grows only on these sheets. */
export function showsBackingRows(rows: BackingRows): boolean {
  return rows.kind !== "none";
}

/** True when the backing may play (its switch can be on). */
export function backingCanPlay(rows: BackingRows): boolean {
  return rows.kind === "playable";
}

/**
 * The Transpose panel's warning before it moves the notes: only on a sheet with backing, and not for the shift that
 * takes it back to the song's own key.
 */
export function warnsBeforeTranspose(rows: BackingRows, transposedBy: number, semitones: number): boolean {
  if (rows.kind !== "playable" && rows.kind !== "transposed") return false;
  return !(transposedBy !== 0 && transposedBy + semitones === 0);
}

export const BACKING_WORDS = {
  label: "Song backing",
  freshLink: "Plays while this sheet is open. Songs from a link don't keep their backing.",
  linkLater: "Songs from a link don't keep their backing.",
  transposed: "The backing plays in the song's own key — it's off while the sheet is transposed.",
  rehearse: "It follows the loop and the speed, and stays in the song's key.",
  beforeTranspose: "The song's backing can't move with it, so it will be off until you move it back.",
} as const;

export function backToLabel(key: string): string {
  return `Back to ${key}`;
}
