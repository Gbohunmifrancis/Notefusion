// A single-voice MusicXML score from a parsed melody, for the staff OSMD draws on hymn pages.
// Notes are spelled in the key (lib/solfa spellPitch), split at bar lines with ties, and carry the
// first verse's syllables.
import { escapeXml } from "./util.mjs";
import { keyFifths, spellPitch, loadEngine, onHalfBeatGrid } from "./solfa.mjs";

// Notatable lengths in quarters, longest first: [quarters, type, dots]. The semiquaver and the dotted
// quaver are there for tunes with quarter-beat notes; a tune on the half-beat grid never needs them.
const VALUES = [[6, "whole", 1], [4, "whole", 0], [3, "half", 1], [2, "half", 0], [1.5, "quarter", 1], [1, "quarter", 0], [0.75, "eighth", 1], [0.5, "eighth", 0], [0.25, "16th", 0]];

function pieces(len) {
  const out = [];
  let left = len;
  while (left > 1e-9) {
    const v = VALUES.find(([q]) => q <= left + 1e-9);
    if (!v) throw new Error(`cannot notate a length of ${len} beats`);
    out.push(v); left -= v[0];
  }
  return out;
}

/** Syllables under each sounding note (engine's lyricsUnderNotes), as MusicXML lyric parts. */
function lyricParts(notes, underlay) {
  const syl = loadEngine().lyricsUnderNotes(notes, underlay || "");
  let prevJoins = false;
  return syl.map((s) => {
    if (!s || s === "_") return null;
    const joins = s.endsWith("-");
    const text = joins ? s.slice(0, -1) : s;
    const syllabic = prevJoins ? (joins ? "middle" : "end") : joins ? "begin" : "single";
    prevJoins = joins;
    return { text, syllabic };
  });
}

export function melodyToMusicXml(melody, { key, title = "", underlay = "", transpose = 0 } = {}) {
  const N = loadEngine();
  const [beats, beatType] = String(melody.time).split("/").map(Number);
  const bpb = N.beatsPerBar(melody.time);
  const keyInfo = N.parseKey(key);
  const notes = melody.notes.map((n) => ({ ...n, pitchMidi: n.pitchMidi + transpose }));
  const lyrics = lyricParts(notes, underlay);
  // Divisions per quarter: 2 while the eighth is the shortest value, 4 once a tune has semiquavers.
  const DIVISIONS = onHalfBeatGrid(notes) ? 2 : 4;

  // Events in grid beats, rests filling the gaps, from the pickup's start to the last note's end.
  const events = [];
  let t = melody.offset;
  notes.forEach((n, i) => {
    if (n.startBeat > t + 1e-9) events.push({ rest: true, start: t, dur: n.startBeat - t });
    events.push({ rest: false, start: n.startBeat, dur: n.durBeats, midi: n.pitchMidi, lyric: lyrics[i] });
    t = n.startBeat + n.durBeats;
  });
  const end = t;

  // Measures: a pickup measure (number 0, implicit) when the tune starts off the bar line.
  const measures = [];
  let mStart = 0;
  while (mStart < end - 1e-9) { measures.push({ start: Math.max(mStart, melody.offset), end: Math.min(mStart + bpb, end), items: [] }); mStart += bpb; }
  const hasPickup = melody.offset > 1e-9;

  for (const ev of events) {
    let s = ev.start, first = true;
    const evEnd = ev.start + ev.dur;
    while (s < evEnd - 1e-9) {
      const m = measures.find((mm) => s >= mm.start - 1e-9 && s < mm.end - 1e-9);
      const segEnd = Math.min(evEnd, m.end);
      const parts = pieces(segEnd - s);
      parts.forEach((p, pi) => {
        const lastPiece = segEnd >= evEnd - 1e-9 && pi === parts.length - 1;
        m.items.push({ ...ev, value: p, tieStart: !ev.rest && !lastPiece, tieStop: !ev.rest && !first, lyric: first ? ev.lyric : null });
        first = false;
      });
      s = segEnd;
    }
  }

  const fifths = keyFifths(key);
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<score-partwise version="3.1">');
  if (title) out.push(`  <work><work-title>${escapeXml(title)}</work-title></work>`);
  out.push('  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>');
  out.push('  <part id="P1">');
  measures.forEach((m, mi) => {
    const number = hasPickup ? mi : mi + 1;
    out.push(`    <measure number="${number}"${hasPickup && mi === 0 ? ' implicit="yes"' : ""}>`);
    if (mi === 0) {
      out.push(`      <attributes><divisions>${DIVISIONS}</divisions><key><fifths>${fifths}</fifths><mode>${keyInfo.mode}</mode></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`);
    }
    for (const it of m.items) {
      const [q, type, dots] = it.value;
      const parts = ["      <note>"];
      if (it.rest) parts.push("<rest/>");
      else {
        const sp = spellPitch(it.midi, key);
        parts.push(`<pitch><step>${sp.letter}</step>${sp.alter ? `<alter>${sp.alter}</alter>` : ""}<octave>${sp.octave}</octave></pitch>`);
      }
      parts.push(`<duration>${Math.round(q * DIVISIONS)}</duration>`);
      if (it.tieStop) parts.push('<tie type="stop"/>');
      if (it.tieStart) parts.push('<tie type="start"/>');
      parts.push(`<voice>1</voice><type>${type}</type>${"<dot/>".repeat(dots)}`);
      if (it.tieStart || it.tieStop) parts.push(`<notations>${it.tieStop ? '<tied type="stop"/>' : ""}${it.tieStart ? '<tied type="start"/>' : ""}</notations>`);
      if (it.lyric) parts.push(`<lyric number="1"><syllabic>${it.lyric.syllabic}</syllabic><text>${escapeXml(it.lyric.text)}</text></lyric>`);
      parts.push("</note>");
      out.push(parts.join(""));
    }
    if (mi === measures.length - 1) out.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
    out.push("    </measure>");
  });
  out.push("  </part>");
  out.push("</score-partwise>");
  return out.join("\n") + "\n";
}
