import type { SavedTranscription, TranscriptionResult } from "../api/types";
import { deriveSolfa } from "./solfa";
import { synthesizeMelodyWavBase64 } from "./synth";
import { hymnSheet, type PackHymn } from "./hymnPack";

/**
 * A saved sheet as the Result screen takes it. The solfa is labelled here, for the stored key, and
 * the player's audio is synthesised on the phone — so a copy kept offline plays exactly as a fresh
 * one does. Shared by the Library and Home, which used to build this each on their own.
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
    audioPreviewBase64: synthesizeMelodyWavBase64(derived.notes, full.tempoBpm),
    lyrics: full.lyrics ?? "",
    parts: (full.parts as TranscriptionResult["parts"]) ?? null,
    partsMusicXml: full.partsMusicXml ?? "",
    shareToken: full.shareToken ?? null,
    chords: full.chords ?? null,
    hymn: full.hymn ?? null,
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
    audioPreviewBase64: synthesizeMelodyWavBase64(derived.notes, sheet.tempo),
    lyrics: sheet.lyrics,
    hymn: sheet.hymn,
  };
}
