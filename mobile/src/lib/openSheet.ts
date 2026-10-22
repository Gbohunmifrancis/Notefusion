import type { SavedTranscription, TranscriptionResult } from "../api/types";
import { deriveSolfa } from "./solfa";
import { hymnSheet, type PackHymn } from "./hymnPack";
import { EXAMPLE_HYMN } from "./exampleSheet";

/**
 * A saved sheet as the Result screen takes it. The solfa is labelled here, for the stored key; the player's audio
 * is synthesised by Result itself once it is on screen (building it here held the tap until it was done). Shared
 * by the Library and Home, which used to build this each on their own.
 */
export function resultFromSaved(full: SavedTranscription): TranscriptionResult {
  const derived = deriveSolfa(full.notes ?? [], full.key, full.timeSignature);
  return {
    key: full.key,
    keyConfidence: 1,
    tempo: full.tempoBpm,
    timeSignature: full.timeSignature,
    musicXml: full.musicXml ?? "",
    midiBase64: "",
    notes: derived.notes,
    solfaLines: derived.solfaLines,
    overallConfidence: full.overallConfidence,
    lyrics: full.lyrics ?? "",
    parts: (full.parts as TranscriptionResult["parts"]) ?? null,
    partsMusicXml: full.partsMusicXml ?? "",
    shareToken: full.shareToken ?? null,
    chords: full.chords ?? null,
    hymn: full.hymn ?? null,
    // The song's backing kept with the sheet, and its clock (boards o-backing O1, O3).
    hasBacking: !!full.hasBacking && !full.fromLink,
    beatOriginSec: full.beatOriginSec ?? undefined,
    beatTimesSec: full.beatTimesSec ?? null,
  };
}

/**
 * A saved sheet's Result params, opened from the Library or Home: the sheet, and what its backing needs to know —
 * whether it came from a link (whose backing is never kept) and how far it has been transposed from the song's key.
 */
export function savedSheetParams(full: SavedTranscription): {
  result: TranscriptionResult;
  savedId: string;
  title: string;
  fromLink: boolean;
  transposedBy: number;
} {
  return {
    result: resultFromSaved(full),
    savedId: full.id,
    title: full.title,
    fromLink: !!full.fromLink,
    transposedBy: full.transposedBy ?? 0,
  };
}

/** A hymn from the offline pack as the Result screen takes it: the hymnbook version, nothing in doubt. */
export function resultFromHymn(h: PackHymn): TranscriptionResult {
  const sheet = hymnSheet(h);
  const derived = deriveSolfa(sheet.notes, sheet.key, sheet.timeSignature);
  return {
    key: sheet.key,
    keyConfidence: 1,
    tempo: sheet.tempo,
    timeSignature: sheet.timeSignature,
    musicXml: "",
    midiBase64: "",
    notes: derived.notes,
    solfaLines: derived.solfaLines,
    overallConfidence: 1,
    lyrics: sheet.lyrics,
    hymn: sheet.hymn,
  };
}

/**
 * "See an example" (board n-ux-low Q4j): the bundled Amazing Grace as Result opens it with `example`, without the
 * hymn's credit line: the example's own blue line says what it is.
 */
export function exampleResult(): TranscriptionResult {
  return { ...resultFromHymn(EXAMPLE_HYMN), hymn: null };
}
