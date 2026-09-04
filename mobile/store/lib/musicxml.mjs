/**
 * `mobile/src/lib/musicxml.ts`, ported.
 *
 * Same reason `music.mjs` exists: the app's copy is TypeScript inside an Expo
 * bundle and there is no build step here. This is a verbatim port with the types
 * stripped — nothing is reasoned out a second time, and the four things it needs
 * from the engine (`parseKey`, `keySignatureFor`, `C_MAJOR`, `spell`) come from
 * `music.mjs`, which already ports them.
 *
 * It exists so the walkthrough's staff frame is engraved by the same renderer the
 * app uses. `music.mjs`'s `staffSvg` is a port of `StaffNotation.tsx`, which
 * `ScoreView` replaced; a video that showed it would be advertising a renderer
 * the app no longer ships. `score.mjs` feeds this module's XML to
 * `assets/engraver/index.html` and lifts the resulting SVG out.
 *
 * Only `buildMusicXml` and `resolveKeySignature` are used here. `beatKey` and
 * `onsetIndexMap` exist in the app to resolve a tap back to a note index; a still
 * has no taps, so they are left out rather than ported as dead code.
 */

import { parseKey, keySignatureFor, C_MAJOR, spell } from "./music.mjs";

const DIVISIONS = 96;

/** The key signature a wire key name like "D minor" implies; unparseable → C major. */
export function resolveKeySignature(musicalKey) {
  const parsed = parseKey(musicalKey);
  return parsed === null ? C_MAJOR : keySignatureFor(parsed.tonicPitchClass, parsed.mode);
}

/** Quarter-note beats per bar. "6/8" → 3. Falls back to 4. */
export function beatsPerBar(timeSignature) {
  const [num, den] = timeSignature.split("/").map(Number);
  if (!num || !den) return 4;
  return (num * 4) / den;
}

// ─── Durations ────────────────────────────────────────────────────────────────

const NOTE_TYPES = [
  { name: "whole", div: 4 * DIVISIONS },
  { name: "half", div: 2 * DIVISIONS },
  { name: "quarter", div: DIVISIONS },
  { name: "eighth", div: DIVISIONS / 2 },
  { name: "16th", div: DIVISIONS / 4 },
  { name: "32nd", div: DIVISIONS / 8 },
  { name: "64th", div: DIVISIONS / 16 },
];

const WRITABLE = NOTE_TYPES.flatMap(({ name, div }) =>
  [0, 1, 2].map((dots) => ({
    div: (div * (2 ** (dots + 1) - 1)) / 2 ** dots,
    type: name,
    dots,
    plain: dots === 0,
  })),
)
  .filter((w) => Number.isInteger(w.div))
  .sort((a, b) => b.div - a.div);

function decompose(pos, len, isRest) {
  const out = [];
  let at = pos;
  let left = len;

  while (left > 0) {
    const pick =
      (isRest ? WRITABLE.find((w) => w.div <= left && w.plain && at % w.div === 0) : undefined) ??
      WRITABLE.find((w) => w.div <= left);

    if (pick === undefined) break;

    out.push(pick);
    at += pick.div;
    left -= pick.div;
  }
  return out;
}

// ─── Spans ────────────────────────────────────────────────────────────────────

function fragmentsOf(notes, perBarDiv) {
  const scaled = notes
    .map((n) => ({
      note: n,
      start: Math.round(n.startBeat * DIVISIONS),
      div: Math.max(1, Math.round(n.durBeats * DIVISIONS)),
    }))
    .sort((a, b) => a.start - b.start);

  const spans = [];
  let t = 0;

  for (let i = 0; i < scaled.length; i++) {
    const cur = scaled[i];
    if (cur.start < t) continue;
    if (cur.start > t) spans.push({ start: t, div: cur.start - t, note: null });

    const next = scaled[i + 1];
    const end =
      next === undefined ? cur.start + cur.div : Math.min(cur.start + cur.div, next.start);
    if (end <= cur.start) continue;

    spans.push({ start: cur.start, div: end - cur.start, note: cur.note });
    t = end;
  }

  const total = Math.ceil(t / perBarDiv) * perBarDiv;
  if (total > t) spans.push({ start: t, div: total - t, note: null });

  const measures = [];
  for (const span of spans) {
    let at = span.start;
    let left = span.div;
    while (left > 0) {
      const index = Math.floor(at / perBarDiv);
      const pos = at - index * perBarDiv;
      const take = Math.min(left, perBarDiv - pos);
      while (measures.length <= index) measures.push([]);
      measures[index].push({
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

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];

function esc(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Mirrors the native stave's rule, so switching renderers cannot switch clef. */
function pickClef(notes) {
  const sorted = notes.map((n) => n.pitchMidi).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 60;
  return median < 52 ? "bass" : "treble";
}

function noteXml(frag, writable, key, noteIndex, head, opts) {
  const parts = [];

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

  if (opts.lyrics && head && frag.note?.solfa) {
    parts.push('        <lyric number="1">');
    parts.push("          <syllabic>single</syllabic>");
    parts.push(`          <text>${esc(frag.note.solfa)}</text>`);
    parts.push("        </lyric>");
  }

  const id = noteIndex >= 0 ? ` id="n${noteIndex}"` : "";
  return `      <note${id}>\n${parts.join("\n")}\n      </note>`;
}

/** @returns a `score-partwise` document, or null when there is nothing to draw. */
export function buildMusicXml(notes, key, timeSignature, opts = {}) {
  if (notes.length === 0) return null;

  const perBar = beatsPerBar(timeSignature);
  if (!Number.isInteger(perBar * DIVISIONS)) return null;
  const perBarDiv = perBar * DIVISIONS;

  const measures = fragmentsOf(notes, perBarDiv);
  if (measures.length === 0) return null;

  const indexOf = new Map();
  notes.forEach((n, i) => indexOf.set(n, i));

  const [num, den] = timeSignature.split("/").map(Number);
  const clef = opts.clef ?? pickClef(notes);
  const body = [];

  measures.forEach((frags, m) => {
    body.push(`    <measure number="${m + 1}">`);

    if (m === 0) {
      body.push("      <attributes>");
      body.push(`        <divisions>${DIVISIONS}</divisions>`);
      body.push(`        <key><fifths>${key.fifths}</fifths><mode>${key.mode}</mode></key>`);
      body.push(`        <time><beats>${num || 4}</beats><beat-type>${den || 4}</beat-type></time>`);
      body.push(
        clef === "bass"
          ? "        <clef><sign>F</sign><line>4</line></clef>"
          : "        <clef><sign>G</sign><line>2</line></clef>",
      );
      body.push("      </attributes>");
    }

    if (frags.length === 1 && frags[0].note === null && frags[0].div === perBarDiv) {
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
        const piece = {
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
