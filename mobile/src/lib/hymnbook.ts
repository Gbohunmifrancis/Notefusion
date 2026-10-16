/**
 * "Is this Amazing Grace? Use the hymnbook version." When the worker recognises a hymn we hold in a
 * transcription (`hymnMatch`), the published score is exactly right where the transcription is a
 * reading: notes, rhythm, bar lines, pickup and time signature. The match carries that score already
 * written in the key that was sung, so taking it swaps the sheet, nothing more. A recognition-only
 * match (`kind` "incipit") names the hymn and links to it; it never offers a version. Mirrors the web's
 * assets/hymnbook.js.
 */
import type { HymnCredit, HymnMatch, NoteEvent } from "../api/types";

export type HymnOffer = "version" | "name";

/**
 * What to ask about a result's hymn match: a whole score to swap to, a name to show, or nothing. Never
 * on a saved sheet, once answered, or on a sheet with parts (they are written against its own beats).
 */
export function hymnOffer(
  match: HymnMatch | null | undefined,
  state: { saved: boolean; answered: boolean; hasParts: boolean },
): HymnOffer | null {
  if (!match || state.saved || state.answered || state.hasParts) return null;
  if (match.kind === "score" && match.notes?.length && match.key && match.timeSignature) return "version";
  if (match.kind === "incipit" && match.url) return "name";
  return null;
}

/** "Amazing Grace (hymnbook, 3/4)": what the prompt calls the version on offer. */
export function hymnLabel(match: HymnMatch): string {
  return match.timeSignature ? `${match.title} (hymnbook, ${match.timeSignature})` : match.title;
}

/** The sheet the hymnbook version replaces the transcription with. */
export interface HymnbookSheet {
  notes: NoteEvent[];
  key: string;
  timeSignature: string;
  tempo: number;
  lyrics: string;
  hymn: HymnCredit;
}

/** The hymnbook version from a score match (null for a match without one); `tempo` is kept when it has none. */
export function hymnbookSheet(match: HymnMatch, tempo: number): HymnbookSheet | null {
  if (match.kind !== "score" || !match.notes?.length || !match.key || !match.timeSignature) return null;
  return {
    notes: match.notes.map((n) => ({ ...n })),
    key: match.key,
    timeSignature: match.timeSignature,
    tempo: match.tempo && match.tempo >= 20 && match.tempo <= 300 ? match.tempo : tempo,
    lyrics: match.lyrics ?? "",
    hymn: { slug: match.slug, title: match.title, url: match.url, credit: match.credit },
  };
}

/** The credit line under a hymnbook version's title. */
export function hymnCreditLine(hymn: HymnCredit): string {
  return `Hymnbook version of “${hymn.title}”. ${hymn.credit}`.trim();
}
