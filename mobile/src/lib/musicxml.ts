/**
 * MusicXML for the notes currently on screen.
 *
 * The server already engraves properly — `makeMeasures()` plus music21's
 * exporter fills rests, ties, dots and beams, and `TranscriptionResult.musicXml`
 * carries all of it. But that XML is a snapshot of the *original* transcription:
 * the moment a note is corrected or the key is overridden it is stale, which is
 * why the export block warns that it "does not include your corrections". A
 * stave drawn from it would drift out of step with the notes grid beside it.
 *
 * So this module builds the score from the live, edited note list instead. It is
 * a serialiser, not an engraver: it decides *what* the rhythm is (durations,
 * dots, ties, rests, barlines) and leaves every visual decision — beam groups,
 * spacing, system breaks, stem directions — to the renderer that consumes it.
 *
 * Two invariants hold by construction, because every duration is an integer
 * count of divisions from first arithmetic to last and nothing here uses floats:
 *
 *   1. Every measure's contents sum to exactly one measure.
 *   2. The sounding rhythm is preserved: no note is lengthened or shortened
 *      except where a later onset truncates it (a stave is monophonic).
 *
 * Beats are quarter notes. That is not a convention this module picks — it is
 * what the wire carries: `transcriber.py` fills `start_beat` from music21's
 * `offset` and `dur_beats` from `quarterLength`.
 */

import { C_MAJOR, keySignatureFor, spell, type KeySignature } from "./keySignature";
import { parseKey } from "./solfa";

/**
 * Divisions per quarter note. 96 = 2^5 · 3, so every duration the quantizer can
 * emit lands on an integer: powers of two down to a 64th note, and thirds of a
 * beat for triplets, with no rounding anywhere in the arithmetic below.
 */
const DIVISIONS = 96;

/**
 * The key signature a wire key name like "D minor" implies. An unparseable or
 * absent name reads as C major, matching `StaffNotation`: a stave with no key
 * signature is a claim (C major / A minor), so there is no "unknown" to draw.
 */
export function resolveKeySignature(musicalKey: string | null | undefined): KeySignature {
  const parsed = parseKey(musicalKey);
  return parsed === null ? C_MAJOR : keySignatureFor(parsed.tonicPitchClass, parsed.mode);
}

/**
 * A beat as an exact integer, for comparing an onset that has been through the
 * renderer against the one that went in. Every duration here is a whole number
 * of divisions, so two beats are the same beat when their keys match — which
 * `startBeat === beat` on floats cannot promise.
 */
export function beatKey(beat: number): number {
  return Math.round(beat * DIVISIONS);
}

/** Quarter-note beats per bar. "6/8" → 3 (six eighths = three quarters). Falls back to 4. */
export function beatsPerBar(timeSignature: string): number {
  const [num, den] = timeSignature.split("/").map(Number);
  if (!num || !den) return 4;
  return (num * 4) / den;
}

export interface ScoreNote {
  pitchMidi: number;
  /** Quarter notes from the start of the piece. */
  startBeat: number;
  /** Length in quarter notes. */
  durBeats: number;
  conf: number;
  /** Movable-do syllable, printed as a lyric when `lyrics` is on. */
  solfa?: string;
}

export interface BuildOptions {
  /** Work title, shown by the renderer above the first system. */
  title?: string;
  /** Print each note's solfa syllable under its notehead. */
  lyrics?: boolean;
  /**
   * Tint each notehead by its own confidence. Returning null leaves the head
   * black. This is how the PRD's honesty rule survives the move off the native
   * renderer, which tinted heads directly.
   */
  colorFor?: (conf: number) => string | null;
  /** Omit to pick from the median pitch, the way the native stave does. */
  clef?: "treble" | "bass";
}

// ─── Durations ────────────────────────────────────────────────────────────────

/** MusicXML `<type>` names, longest first, with their length in divisions. */
const NOTE_TYPES: readonly { name: string; div: number }[] = [
  { name: "whole", div: 4 * DIVISIONS },
  { name: "half", div: 2 * DIVISIONS },
  { name: "quarter", div: DIVISIONS },
  { name: "eighth", div: DIVISIONS / 2 },
  { name: "16th", div: DIVISIONS / 4 },
  { name: "32nd", div: DIVISIONS / 8 },
  { name: "64th", div: DIVISIONS / 16 },
];

interface Writable {
  div: number;
  type: string;
  dots: number;
  /** True for the undotted powers of two, which are the only rest lengths that
   *  read cleanly when aligned to their own grid. */
  plain: boolean;
}

/**
 * Every length a single notehead can express, longest first. A dot adds half of
 * what precedes it, so `dots` scales the base by 1.5 then 1.75; two is the most
 * anyone reads at a glance, and a third would only ever save one tie.
 */
const WRITABLE: readonly Writable[] = NOTE_TYPES.flatMap(({ name, div }) =>
  [0, 1, 2].map((dots) => ({
    div: (div * (2 ** (dots + 1) - 1)) / 2 ** dots,
    type: name,
    dots,
    plain: dots === 0,
  })),
)
  .filter((w) => Number.isInteger(w.div))
  .sort((a, b) => b.div - a.div);

/**
 * Split `len` divisions starting `pos` into the fewest noteheads that sum to it
 * exactly, largest first. Anything not writable as one head comes back as
 * several, to be joined by ties (for a note) or simply printed in sequence (for
 * a rest).
 *
 * Rests additionally prefer a length they are aligned to, so three beats of
 * silence from beat 2 of 4/4 reads as a crotchet rest then a minim rest rather
 * than one dotted minim rest straddling the middle of the bar. Notes take the
 * plain greedy result: a tie is a heavier mark on the page than a dot in an
 * unconventional place, so fewer heads wins.
 */
function decompose(pos: number, len: number, isRest: boolean): Writable[] {
  const out: Writable[] = [];
  let at = pos;
  let left = len;

  while (left > 0) {
    const pick =
      (isRest
        ? WRITABLE.find((w) => w.div <= left && w.plain && at % w.div === 0)
        : undefined) ?? WRITABLE.find((w) => w.div <= left);

    // Unreachable for any duration the pipeline can produce — the shortest
    // writable length is a 64th and every input is an integer number of
    // divisions — but a silent infinite loop is not worth risking.
    if (pick === undefined) break;

    out.push(pick);
    at += pick.div;
    left -= pick.div;
  }
  return out;
}

// ─── Spans ────────────────────────────────────────────────────────────────────

/** A stretch of one measure, either sounding or silent. */
interface Fragment {
  /** Divisions from the start of its measure. */
  pos: number;
  div: number;
  note: ScoreNote | null;
  /** This fragment continues a note that began in an earlier measure. */
  tiedFrom: boolean;
  /** This note carries on into the next measure. */
  tiedTo: boolean;
}

/**
 * Lay the notes out on a timeline of measures, filling silence with rests.
 *
 * Overlaps are resolved rather than rendered: a stave has one voice, so a note
 * still sounding when the next begins is truncated at that onset, and a second
 * note sharing an onset is dropped. The pipeline is monophonic, so neither
 * should occur — but a measure that does not sum exactly would misplace every
 * barline after it, and silently swallowing that is worse than resolving it.
 */
function fragmentsOf(notes: readonly ScoreNote[], perBarDiv: number): Fragment[][] {
  const scaled = notes
    .map((n) => ({
      note: n,
      start: Math.round(n.startBeat * DIVISIONS),
      // A note that rounds away would leave a gap no rest accounts for.
      div: Math.max(1, Math.round(n.durBeats * DIVISIONS)),
    }))
    .sort((a, b) => a.start - b.start);

  const spans: { start: number; div: number; note: ScoreNote | null }[] = [];
  let t = 0;

  for (let i = 0; i < scaled.length; i++) {
    const cur = scaled[i]!;
    if (cur.start < t) continue; // starts inside the previous note: same onset, or contained
    if (cur.start > t) spans.push({ start: t, div: cur.start - t, note: null });

    const next = scaled[i + 1];
    const end = next === undefined ? cur.start + cur.div : Math.min(cur.start + cur.div, next.start);
    if (end <= cur.start) continue;

    spans.push({ start: cur.start, div: end - cur.start, note: cur.note });
    t = end;
  }

  // Pad the last measure so it is as full as every other one.
  const total = Math.ceil(t / perBarDiv) * perBarDiv;
  if (total > t) spans.push({ start: t, div: total - t, note: null });

  const measures: Fragment[][] = [];
  for (const span of spans) {
    let at = span.start;
    let left = span.div;
    while (left > 0) {
      const index = Math.floor(at / perBarDiv);
      const pos = at - index * perBarDiv;
      const take = Math.min(left, perBarDiv - pos);
      while (measures.length <= index) measures.push([]);
      measures[index]!.push({
        pos,
        div: take,
        note: span.note,
        tiedFrom: span.note !== null && at > span.start,
        tiedTo: span.note !== null && take < left,
      });
      at += take;
      left -= take;
    }
  }
  return measures;
}

// ─── Serialisation ────────────────────────────────────────────────────────────

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Mirrors the native stave's rule, so switching renderers cannot switch clef. */
function pickClef(notes: readonly ScoreNote[]): "treble" | "bass" {
  const sorted = notes.map((n) => n.pitchMidi).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 60;
  return median < 52 ? "bass" : "treble";
}

function noteXml(
  frag: Fragment,
  writable: Writable,
  key: KeySignature,
  /** Index of this note in the caller's array, for tap-back. Rests get −1. */
  noteIndex: number,
  /** First of a note's fragments carries the lyric; continuations must not. */
  head: boolean,
  opts: BuildOptions,
): string {
  const parts: string[] = [];

  if (frag.note === null) {
    parts.push("        <rest/>");
  } else {
    const sp = spell(frag.note.pitchMidi, key);
    const octave = (sp.step - sp.letter) / 7;
    parts.push("        <pitch>");
    parts.push(`          <step>${LETTERS[sp.letter]}</step>`);
    if (sp.alter !== 0) parts.push(`          <alter>${sp.alter}</alter>`);
    parts.push(`          <octave>${octave}</octave>`);
    parts.push("        </pitch>");
  }

  parts.push(`        <duration>${writable.div}</duration>`);
  if (frag.tiedFrom) parts.push('        <tie type="stop"/>');
  if (frag.tiedTo) parts.push('        <tie type="start"/>');
  parts.push("        <voice>1</voice>");
  parts.push(`        <type>${writable.type}</type>`);
  for (let d = 0; d < writable.dots; d++) parts.push("        <dot/>");

  const color = frag.note === null ? null : (opts.colorFor?.(frag.note.conf) ?? null);
  if (color !== null) parts.push(`        <notehead color="${esc(color)}">normal</notehead>`);

  if (frag.tiedFrom || frag.tiedTo) {
    parts.push("        <notations>");
    if (frag.tiedFrom) parts.push('          <tied type="stop"/>');
    if (frag.tiedTo) parts.push('          <tied type="start"/>');
    parts.push("        </notations>");
  }

  // A tie is one sound, so only its first head is sung — a continuation with its
  // own syllable would tell the singer to re-attack.
  if (opts.lyrics && head && frag.note?.solfa) {
    parts.push("        <lyric number=\"1\">");
    parts.push("          <syllabic>single</syllabic>");
    parts.push(`          <text>${esc(frag.note.solfa)}</text>`);
    parts.push("        </lyric>");
  }

  const id = noteIndex >= 0 ? ` id="n${noteIndex}"` : "";
  return `      <note${id}>\n${parts.join("\n")}\n      </note>`;
}

/**
 * Which note each engraved notehead belongs to, keyed by `beatKey` of its onset.
 *
 * A renderer can only report *where* a head is, so this is how a tap on the page
 * becomes an index into `notes`. It goes through `fragmentsOf` rather than
 * reading onsets off `notes` directly, because overlap resolution decides which
 * notes get a head at all: two notes sharing an onset leave only one on the
 * page, and restating that rule here is how the two would drift apart.
 *
 * Tie continuations are excluded — they are the same sound as their first head.
 */
export function onsetIndexMap(
  notes: readonly ScoreNote[],
  timeSignature: string,
): Map<number, number> {
  const map = new Map<number, number>();
  const perBar = beatsPerBar(timeSignature);
  if (notes.length === 0 || !Number.isInteger(perBar * DIVISIONS)) return map;
  const perBarDiv = perBar * DIVISIONS;

  const indexOf = new Map<ScoreNote, number>();
  notes.forEach((n, i) => indexOf.set(n, i));

  fragmentsOf(notes, perBarDiv).forEach((frags, m) => {
    for (const frag of frags) {
      if (frag.note === null || frag.tiedFrom) continue;
      const index = indexOf.get(frag.note);
      if (index !== undefined) map.set(m * perBarDiv + frag.pos, index);
    }
  });
  return map;
}

/**
 * @returns A `score-partwise` document, or null when there is nothing to draw.
 */
export function buildMusicXml(
  notes: readonly ScoreNote[],
  key: KeySignature,
  timeSignature: string,
  opts: BuildOptions = {},
): string | null {
  if (notes.length === 0) return null;

  const perBar = beatsPerBar(timeSignature);
  if (!Number.isInteger(perBar * DIVISIONS)) return null;
  const perBarDiv = perBar * DIVISIONS;

  const measures = fragmentsOf(notes, perBarDiv);
  if (measures.length === 0) return null;

  // Ids are indices into the caller's array, not into the engraved order, so a
  // tap on a notehead names the same note the notes grid does.
  const indexOf = new Map<ScoreNote, number>();
  notes.forEach((n, i) => indexOf.set(n, i));

  const [num, den] = timeSignature.split("/").map(Number);
  const clef = opts.clef ?? pickClef(notes);
  const body: string[] = [];

  measures.forEach((frags, m) => {
    body.push(`    <measure number="${m + 1}">`);

    if (m === 0) {
      body.push("      <attributes>");
      body.push(`        <divisions>${DIVISIONS}</divisions>`);
      body.push(`        <key><fifths>${key.fifths}</fifths><mode>${key.mode}</mode></key>`);
      body.push(`        <time><beats>${num || 4}</beats><beat-type>${den || 4}</beat-type></time>`);
      body.push(
        clef === "bass"
          ? '        <clef><sign>F</sign><line>4</line></clef>'
          : '        <clef><sign>G</sign><line>2</line></clef>',
      );
      body.push("      </attributes>");
    }

    // A measure of silence is one whole-measure rest, not a sum of rests that
    // happens to fill it.
    if (frags.length === 1 && frags[0]!.note === null && frags[0]!.div === perBarDiv) {
      body.push("      <note>");
      body.push('        <rest measure="yes"/>');
      body.push(`        <duration>${perBarDiv}</duration>`);
      body.push("        <voice>1</voice>");
      body.push("      </note>");
      body.push("    </measure>");
      return;
    }

    for (const frag of frags) {
      const index = frag.note === null ? -1 : (indexOf.get(frag.note) ?? -1);
      const heads = decompose(frag.pos, frag.div, frag.note === null);
      heads.forEach((w, i) => {
        // Splitting one fragment into several heads makes ties inside the bar too.
        const piece: Fragment = {
          ...frag,
          tiedFrom: frag.tiedFrom || (frag.note !== null && i > 0),
          tiedTo: frag.tiedTo || (frag.note !== null && i < heads.length - 1),
        };
        body.push(noteXml(piece, w, key, index, !frag.tiedFrom && i === 0, opts));
      });
    }

    body.push("    </measure>");
  });

  const title = opts.title?.trim();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
${title ? `  <work><work-title>${esc(title)}</work-title></work>\n` : ""}  <part-list>
    <score-part id="P1"><part-name>Voice</part-name></score-part>
  </part-list>
  <part id="P1">
${body.join("\n")}
  </part>
</score-partwise>
`;
}
