// The melody of a CCEH tune, read from its MIDI file (midi.mjs) and checked against the tune's incipit.
//
// CCEH's MIDI files are exported from Noteworthy Composer scores: usually two tracks, the treble staff
// (soprano and alto as chords) and the bass staff (tenor and bass), each note sounding a little shorter
// than written. The melody is one of the four lines in them, almost always the top of the treble staff,
// but some arrangements put the tune in the tenor. So every track gives two candidate lines, its top and
// its bottom ("skyline": the highest — or lowest — note starting at each onset, skipped while a higher —
// or lower — note of the same track is still sounding), and the candidate whose opening matches CCEH's
// do-re-mi incipit is the melody. When none matches, there is no melody: the tune is not imported rather
// than imported with the alto line.

/** Pitch class above doh of each do-re-mi syllable (one letter a note; chromatic forms as CCEH writes them). */
const SYLLABLE_PC = { d: 0, r: 2, m: 4, f: 5, s: 7, l: 9, t: 11 };

/**
 * CCEH's do-re-mi incipit ("ddtlsdrm|mmmrdfmr") as pitch classes above doh, one a note; "|" ends a phrase.
 * A syllable it does not know (a chromatic note) is null and matches any pitch.
 */
export function incipitDegrees(doremi) {
  const out = [];
  // A ";" marks where the tune goes back to repeat a phrase; what follows it is not the opening run on.
  for (const ch of String(doremi || "").replace(/\s+/g, "").split(";")[0]) {
    if (ch === "|") continue;
    if (ch in SYLLABLE_PC) out.push(SYLLABLE_PC[ch]);
    else out.push(null);
  }
  return out;
}

/** The Oxford Hymn Tune Index form ("11765 12333 32143") as the same pitch classes (degrees 1–7 of the major scale). */
export function oxfordDegrees(oxford) {
  const DEG = [null, 0, 2, 4, 5, 7, 9, 11];
  return String(oxford || "").replace(/\s+/g, "").split("").map((c) => (/[1-7]/.test(c) ? DEG[Number(c)] : null));
}

/** Notes of one MIDI track, grouped by channel (a track that mixes channels holds more than one staff). */
function staves(midi) {
  const out = [];
  for (const t of midi.tracks) {
    const byCh = new Map();
    for (const n of t.notes) {
      if (n.channel === 9) continue; // percussion
      if (!byCh.has(n.channel)) byCh.set(n.channel, []);
      byCh.get(n.channel).push(n);
    }
    for (const [ch, notes] of byCh) if (notes.length) out.push({ track: t.index, name: t.name, channel: ch, notes: notes.slice().sort((a, b) => a.start - b.start || b.pitch - a.pitch) });
  }
  return out;
}

/**
 * One line out of a staff's chords: at each onset the highest (`top`) or lowest note starting there,
 * unless a higher (lower) note of the staff that started earlier is still sounding — the top voice is
 * holding, and the note belongs to an inner voice. Returns [{pitch, start, end}] in ticks.
 */
export function skyline(notes, { top = true } = {}) {
  const onsets = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
  const better = (a, b) => (top ? a > b : a < b);
  const line = [];
  for (const t of onsets) {
    const starting = notes.filter((n) => n.start === t);
    const pick = starting.reduce((a, b) => (better(b.pitch, a.pitch) ? b : a));
    // A note of this staff sounding through t, started before it, and above (below) the pick: a held top voice.
    const held = notes.some((n) => n.start < t && n.end > t && better(n.pitch, pick.pitch));
    if (held) continue;
    line.push({ pitch: pick.pitch, start: t, end: Math.max(...starting.filter((n) => n.pitch === pick.pitch).map((n) => n.end)) });
  }
  return line;
}

/** Every candidate melody line: each staff's top and bottom, top lines of higher staves first. */
export function candidateLines(midi) {
  const out = [];
  const ss = staves(midi);
  const mean = (ns) => ns.reduce((a, n) => a + n.pitch, 0) / ns.length;
  ss.sort((a, b) => mean(b.notes) - mean(a.notes));
  ss.forEach((s, i) => {
    const chordal = s.notes.some((n, k) => s.notes.some((m, j) => j !== k && m.start === n.start && m.pitch !== n.pitch));
    out.push({ staff: i, track: s.track, channel: s.channel, part: chordal ? "top" : "only", name: s.name, notes: skyline(s.notes, { top: true }) });
    if (chordal) out.push({ staff: i, track: s.track, channel: s.channel, part: "bottom", name: s.name, notes: skyline(s.notes, { top: false }) });
  });
  return out;
}

/** Edit distance between two sequences, where a null in `want` matches anything. */
function editDistance(have, want) {
  const m = have.length, n = want.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const same = want[j - 1] === null || have[i - 1] === want[j - 1];
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (same ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * How well a line's opening matches the incipit, at the doh that fits it best (so the key does not
 * matter): {distance, doh (pitch class), compared}. The line's first notes, as many as the incipit
 * has (one more, so a dropped note costs one edit and not two), are compared as pitch classes above doh.
 */
export function incipitMatch(line, degrees) {
  const n = degrees.length;
  if (!n || !line.length) return { distance: Infinity, doh: null, compared: 0 };
  let best = { distance: Infinity, doh: null, compared: n };
  for (let doh = 0; doh < 12; doh++) {
    const have = line.slice(0, n).map((x) => (((x.pitch - doh) % 12) + 12) % 12);
    const d = editDistance(have, degrees);
    if (d < best.distance) best = { distance: d, doh, compared: n };
  }
  return best;
}

/** The most an opening may differ from the incipit and still be the tune: about one edit in seven notes, at least one. */
export const allowedDistance = (n) => Math.max(1, Math.round(n / 7));

/**
 * The melody line: the candidate that matches the incipit (the fewest edits; on a tie the higher staff's
 * top line, the soprano). Returns {line, match, candidates} or {line: null, reason, candidates}.
 */
export function chooseMelody(midi, degrees) {
  const candidates = candidateLines(midi).map((c) => ({ ...c, match: incipitMatch(c.notes, degrees) }));
  if (!candidates.length) return { line: null, reason: "the MIDI file has no notes", candidates };
  if (degrees.filter((d) => d !== null).length < 6) return { line: null, reason: "the page has no usable incipit to check the melody against", candidates };
  const ok = candidates.filter((c) => c.match.distance <= allowedDistance(degrees.length));
  if (!ok.length) {
    const near = candidates.reduce((a, b) => (b.match.distance < a.match.distance ? b : a));
    return { line: null, reason: `no voice in the MIDI file matches the incipit (the nearest, the ${near.part} of staff ${near.staff + 1}, is ${near.match.distance} notes off in ${degrees.length})`, candidates };
  }
  const best = ok.reduce((a, b) => (b.match.distance < a.match.distance ? b : a));
  return { line: best, match: best.match, candidates };
}

// ── From the chosen line to the melody string ─────────────────────────────────
const PITCH_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
/** The key spelling the engine and the staff use for each doh (lib/solfa keyFifths), major and la-based minor. */
const MAJOR_BY_DOH = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_BY_DOH = ["A", "Bb", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
export const keyText = (doh, mode) => `${(mode === "minor" ? MINOR_BY_DOH : MAJOR_BY_DOH)[doh]} ${mode}`;
/** A MIDI key signature's doh: sharps and flats around the circle of fifths. */
export const dohOfSignature = (sf) => (((sf * 7) % 12) + 12) % 12;

const fmt = (x) => String(Math.round(x * 1000) / 1000).replace(/^0\./, ".");
const onGrid = (x, tol = 0.04) => Math.abs(x * 4 - Math.round(x * 4)) <= tol * 4;
const q4 = (x) => Math.round(x * 4) / 4;

/**
 * The written length of a note that sounded `L` quarter beats. Noteworthy Composer plays a note short
 * of its written value (a crotchet sounds 5/6 of a beat, a minim 1¾ beats); the written value is the
 * one on the quarter-beat grid that sounds this long.
 */
export function writtenLength(L) {
  // A minim or longer is cut by a quarter beat, a crotchet or a dotted crotchet by a sixth, a slurred note not at all.
  if (L + 0.25 >= 2 - 1e-9 && onGrid(L + 0.25, 0.01)) return q4(L + 0.25);
  for (const cut of [1 / 6, 0]) if (onGrid(L + cut, 0.01)) return q4(L + cut);
  return Math.max(0.25, Math.ceil(L * 4 - 0.1) / 4);
}
/** The longest a note is cut short when played: a gap longer than this before the next note is a rest. */
const MAX_CUT = 0.25 + 1e-3;

/** A line's notes as written: on the quarter-beat grid, each with its written length, a gap longer than the playing cut a rest. */
export function lineEvents(line, division, shift = 0) {
  const notes = line.notes.map((n) => ({ pitch: n.pitch, s: q4(n.start / division), L: (n.end - n.start) / division }));
  const events = [];
  notes.forEach((n, i) => {
    const next = notes[i + 1];
    const gap = next ? next.s - n.s : null;
    const w = writtenLength(n.L);
    const dur = next ? (gap - n.L <= MAX_CUT ? gap : Math.min(w, gap)) : w;
    events.push({ pitch: n.pitch + shift, start: n.s, dur });
    if (next && gap - dur > 1e-9) events.push({ pitch: null, start: n.s + dur, dur: gap - dur });
  });
  return events;
}

/** Inference weights: the melody's own rhythm counts in full, the other voices' (the harmony's rhythm) at `others`. */
export const BAR_WEIGHTS = { others: 0.5, mid: 0.5, last: 0.5 };

/**
 * Where the first bar line falls (the pickup, in quarter beats), read off the rhythm of the melody and of
 * the other voices: the bar line that puts the most held weight on strong beats (a note's length counts on
 * a downbeat, half on the middle of a bar of four or six beats), the tune's last note on a downbeat breaking
 * a tie (a tune of even crotchets says nothing else). Returns {pickup, margin}: how much better the choice
 * scores than the next best, as a share of the melody's whole length (0 = a coin toss).
 */
export function inferBarLines(events, bpb, others = [], w = BAR_WEIGHTS) {
  const notes = events.filter((e) => e.pitch != null);
  const first = events[0].start;
  const last = notes[notes.length - 1];
  const mids = bpb === 4 || bpb === 6 || bpb === 8 ? [bpb / 2] : [];
  const weigh = (list, off) => {
    let s = 0;
    for (const n of list) {
      if (n.pitch == null) continue;
      const pos = (((n.start - off) % bpb) + bpb) % bpb;
      if (pos < 1e-9) s += n.dur;
      else if (mids.some((m) => Math.abs(pos - m) < 1e-9)) s += n.dur * w.mid;
    }
    return s;
  };
  const scores = [];
  for (let off = 0; off < bpb - 1e-9; off += 0.5) {
    let s = weigh(notes, off);
    for (const o of others) s += (w.others * weigh(o, off)) / others.length;
    if (((((last.start - off) % bpb) + bpb) % bpb) < 1e-9) s += w.last;
    scores.push({ off, s });
  }
  scores.sort((a, b) => b.s - a.s);
  const total = notes.reduce((a, n) => a + n.dur, 0);
  const off = scores[0].off;
  // The pickup: from the first note to the first bar line at or after it.
  const pickup = (((off - first) % bpb) + bpb) % bpb;
  return { pickup: q4(pickup), offset: off, margin: scores.length > 1 ? (scores[0].s - scores[1].s) / total : 1 };
}

/**
 * The chosen line as the tune format's melody: {melody, time, pickup, key, tempo, lo, hi, problems, barsFrom}.
 * `doh` is the pitch class the incipit matched at. `score` is the Noteworthy score's bars (nwc.mjs nwcBars,
 * with its time signature): where they are, the bar lines are the score's; without them they are read off
 * the rhythm, and the tune is held back to be checked. Each problem keeps the tune a draft; one marked
 * `fatal` leaves the melody out (one time signature, notes on the semiquaver grid).
 */
export function lineToMelody(line, midi, { doh, allLines = [], weights = BAR_WEIGHTS, score = null }) {
  const problems = [];
  const d = midi.division;
  const sigs = [...new Map(midi.timeSigs.map((t) => [`${t.num}/${t.den}`, t])).values()];
  if (!sigs.length) return { melody: null, problems: [{ text: "the MIDI file has no time signature", fatal: true }] };
  if (sigs.length > 1) return { melody: null, problems: [{ text: `the time signature changes (${sigs.map((t) => `${t.num}/${t.den}`).join(", ")}), which the solfa grid does not bar`, fatal: true }] };
  const time = `${sigs[0].num}/${sigs[0].den}`;
  if (!/^\d+\/(2|4|8)$/.test(time)) return { melody: null, problems: [{ text: `the time signature ${time} is not one the solfa grid draws`, fatal: true }] };
  const bpb = sigs[0].num * 4 / sigs[0].den;

  // Notes on the quarter-beat grid, each with its written length; a gap longer than the playing cut is a rest.
  let notes = line.notes.map((n) => ({ pitch: n.pitch, s: n.start / d, L: (n.end - n.start) / d }));
  if (notes.some((n) => !onGrid(n.s))) return { melody: null, problems: [{ text: "a note starts off the semiquaver grid (a triplet or a grace note), which the solfa grid does not draw", fatal: true }] };
  // A tenor-lead tune is written an octave above where it sounds in the MIDI file's bass staff.
  const lo0 = Math.min(...notes.map((n) => n.pitch));
  const shift = line.staff > 0 && lo0 < 55 ? 12 : 0;
  const events = lineEvents(line, d, shift);
  // The other voices (each staff's top and bottom line but this one) carry the harmony's rhythm.
  const others = allLines.filter((l) => l !== line && l.notes.length && l.notes.every((n) => onGrid(n.start / d))).map((l) => lineEvents(l, d));
  // Where the bar lines fall: the score's (its staff starts where the MIDI file starts, so its first bar
  // line is at the length of its first bar), else the rhythm's best guess, held back to be checked.
  let offset, barsFrom;
  const scoreUsable = score && score.bars && Math.abs((score.num * 4) / score.den - bpb) < 1e-9;
  if (scoreUsable) {
    offset = score.pickup ? score.pickup : 0;
    barsFrom = "score";
    if (score.irregular.length) problems.push({ text: `the score has ${score.irregular.length === 1 ? "a bar" : "bars"} of another length (bar ${score.irregular.join(", ")}), which the solfa grid does not draw` });
    if (score.timeChanges) problems.push({ text: "the score changes its time signature, which the solfa grid does not bar", fatal: true });
  } else {
    const inferred = inferBarLines(events, bpb, others, weights);
    offset = inferred.offset;
    barsFrom = "rhythm";
    if (score && score.bars) problems.push({ text: `the Noteworthy score is in ${score.num}/${score.den} and the MIDI file in ${time}; the bar lines are read off the rhythm — check them against the score` });
    else problems.push({ text: inferred.margin < 0.02 ? "where the bar lines fall is not clear from the rhythm, and CCEH's Noteworthy score could not be read; check the pickup against the score" : "the bar lines are read off the rhythm (CCEH's Noteworthy score could not be read); check the pickup against the score" });
  }
  if (problems.some((p) => p.fatal)) return { melody: null, problems };
  const pickup = q4((((offset - events[0].start) % bpb) + bpb) % bpb);
  // Bars: from the first note, the first bar `pickup` beats long; a note across a bar line is tied over it.
  const origin = events[0].start - (pickup ? bpb - pickup : 0); // the (virtual) start of the first bar
  const bars = [];
  for (const e of events) {
    let t = e.start, left = e.dur;
    while (left > 1e-9) {
      const b = Math.floor((t - origin) / bpb + 1e-9);
      const barEnd = origin + (b + 1) * bpb;
      const part = Math.min(left, barEnd - t);
      while (bars.length <= b) bars.push([]);
      left -= part;
      bars[b].push({ pitch: e.pitch, dur: part, tie: e.pitch != null && left > 1e-9 });
      t += part;
    }
  }
  // Rests after the last note are padding: the last bar is filled out to a full bar less the pickup.
  const lastBar = bars[bars.length - 1];
  while (lastBar.length > 1 && lastBar[lastBar.length - 1].pitch == null) lastBar.pop();
  const sum = (b) => b.reduce((a, x) => a + x.dur, 0);
  if (bars.length > 1) {
    const want = pickup ? bpb - pickup : bpb, s = sum(lastBar);
    if (s < want - 1e-9) lastBar.push({ pitch: null, dur: want - s });
    else if (s > want + 1e-9 && s < bpb - 1e-9) lastBar.push({ pitch: null, dur: bpb - s });
  }
  const tok = (x) => (x.pitch == null ? `r:${fmt(x.dur)}` : `${PITCH_NAMES[x.pitch % 12]}${Math.floor(x.pitch / 12) - 1}:${fmt(x.dur)}${x.tie ? "~" : ""}`);
  const melody = bars.map((b) => b.map(tok).join(" ")).join(" | ");

  // Key: the doh the incipit matched; the key signature should agree. La-based minor when the tune ends on lah.
  const sounding = events.filter((e) => e.pitch != null);
  const final = sounding[sounding.length - 1].pitch % 12;
  const ksigs = [...new Set(midi.keySigs.map((k) => `${k.sf}${k.minor ? "m" : ""}`))];
  if (ksigs.length > 1) problems.push({ text: "the key signature changes in the score; the solfa keeps one doh" });
  const ks = midi.keySigs[0];
  if (ks && dohOfSignature(ks.sf) !== doh) problems.push({ text: `the key signature (doh ${PITCH_NAMES[dohOfSignature(ks.sf)]}) and the incipit's doh (${PITCH_NAMES[doh]}) disagree` });
  let mode = "major";
  if (final === (doh + 9) % 12) mode = "minor";
  const notes2 = [];
  if (final !== doh && final !== (doh + 9) % 12) notes2.push(`The tune ends on ${PITCH_NAMES[final]}, neither doh nor lah: it may be modal; the doh is the key signature's.`);
  const key = keyText(doh, mode);
  const tempoEv = midi.tempos.find((t) => t.tick === 0) || midi.tempos[0];
  const tempo = Math.max(48, Math.min(132, tempoEv ? Math.round(60e6 / tempoEv.usPerQuarter) : 96));
  const lo = Math.min(...sounding.map((e) => e.pitch)), hi = Math.max(...sounding.map((e) => e.pitch));
  return { melody, time, pickup, key, tempo, lo, hi, bpb, shift, problems, notes: notes2, barsFrom };
}
