/**
 * Ports of the app's music logic, so the store screenshots show what the app
 * would actually show.
 *
 * `mobile/src/lib/solfa.ts` and `mobile/src/lib/keySignature.ts` are TypeScript
 * inside an Expo bundle; there is no build step here that could import them.
 * Rather than hand-write the solfa strings and the stave — which is how a
 * screenshot ends up showing notation the engine would never produce — the two
 * modules are ported verbatim below and driven from one sample note list.
 *
 * These are ports, not a second implementation: nothing here is called by the
 * app, and every table is a copy. If the engine's tables ever change, these are
 * derived assets — rebuild them, don't reconcile them by hand.
 */

// ─── solfa.ts ─────────────────────────────────────────────────────────────────

const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const ASCENDING_SYLLABLES = ["d", "de", "r", "re", "m", "f", "fe", "s", "se", "l", "le", "t"];
const SEMITONE_TO_DEGREE = [1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 7];
const NATURAL_PITCH_CLASS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const MODE_SUFFIXES = [["minor", "minor"], ["min", "minor"], ["maj", "major"], ["major", "major"], ["m", "minor"]];

export function parseKey(text) {
  if (!text || !text.trim()) return null;
  let s = text.trim();
  let mode = "major";
  for (const [suffix, m] of MODE_SUFFIXES) {
    if (s.length > suffix.length && s.toLowerCase().endsWith(suffix)) {
      mode = m;
      s = s.slice(0, s.length - suffix.length).trimEnd();
      break;
    }
  }
  if (s.length === 0) return null;
  let pitchClass = NATURAL_PITCH_CLASS[s[0].toLowerCase()];
  if (pitchClass === undefined) return null;
  for (const ch of s.slice(1).trim()) {
    if (ch === "#" || ch === "♯") pitchClass += 1;
    else if (ch === "b" || ch === "B" || ch === "♭" || ch === "-") pitchClass -= 1;
    else return null;
  }
  return { tonicPitchClass: ((pitchClass % 12) + 12) % 12, mode };
}

export function dohPitchClass(key) {
  return key.mode === "major" ? key.tonicPitchClass : (key.tonicPitchClass + 3) % 12;
}

export function referenceDoh(pitches, dohPc) {
  if (pitches.length === 0) return Math.round((60 - dohPc) / 12) * 12 + dohPc;
  const sorted = [...pitches].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  let best = dohPc;
  for (let p = dohPc; p < 128; p += 12) {
    if (Math.abs(p - median) < Math.abs(best - median)) best = p;
  }
  return best;
}

export function syllable(pitchMidi, dohPc, refDohMidi) {
  const semitones = (((pitchMidi - dohPc) % 12) + 12) % 12;
  const shift = Math.floor((pitchMidi - refDohMidi) / 12);
  return {
    solfa: ASCENDING_SYLLABLES[semitones],
    octaveMark: shift > 0 ? "'".repeat(shift) : ",".repeat(-shift),
    degree: SEMITONE_TO_DEGREE[semitones],
  };
}

export function dohHeader(dohPc) {
  return `Doh is ${PITCH_NAMES[dohPc]}`;
}

function beatsPerBar(timeSignature) {
  const [num, den] = timeSignature.split("/").map(Number);
  if (!num || !den) return 4;
  return (num * 4) / den;
}

export function deriveSolfa(notes, keyText, timeSignature) {
  const key = parseKey(keyText);
  if (!key || notes.length === 0) return { notes: [...notes], solfaLines: [] };

  const dohPc = dohPitchClass(key);
  const refDoh = referenceDoh(notes.map((n) => n.pitchMidi), dohPc);
  const labelled = notes.map((n) => ({ ...n, ...syllable(n.pitchMidi, dohPc, refDoh) }));

  const perBar = beatsPerBar(timeSignature);
  const bars = [];
  for (const n of labelled) {
    const i = Math.max(0, Math.floor(n.startBeat / perBar));
    while (bars.length <= i) bars.push([]);
    bars[i].push(n.solfa + n.octaveMark);
  }

  const cells = bars.map((b) => (b.length > 0 ? b.join(" ") : "-"));
  const solfaLines = [dohHeader(dohPc)];
  for (let i = 0; i < cells.length; i += 4) {
    solfaLines.push(`| ${cells.slice(i, i + 4).join(" | ")} |`);
  }
  return { notes: labelled, solfaLines };
}

export const KEY_CHOICES = [
  ...PITCH_NAMES.map((n) => `${n} major`),
  ...PITCH_NAMES.map((n) => `${n} minor`),
];

// ─── keySignature.ts ──────────────────────────────────────────────────────────

const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
const PC_LETTER_SHARP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const PC_ALTER_SHARP = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const PC_LETTER_FLAT = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];
const PC_ALTER_FLAT = [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0];

export function fifthsFor(tonicPitchClass, mode) {
  const pc = ((tonicPitchClass % 12) + 12) % 12;
  const fifths = MAJOR_FIFTHS[pc] - (mode === "minor" ? 3 : 0);
  return fifths < -6 ? fifths + 12 : fifths;
}

export function keySignatureFor(tonicPitchClass, mode) {
  const fifths = fifthsFor(tonicPitchClass, mode);
  const sharps = fifths >= 0;
  const order = sharps ? SHARP_ORDER : FLAT_ORDER;
  const alter = [0, 0, 0, 0, 0, 0, 0];
  const accidentals = [];
  for (let i = 0; i < Math.abs(fifths); i++) {
    const letter = order[i];
    alter[letter] = sharps ? 1 : -1;
    accidentals.push({ letter, kind: sharps ? "sharp" : "flat" });
  }
  return { fifths, alter, accidentals, tonicPitchClass: ((tonicPitchClass % 12) + 12) % 12, mode };
}

export const C_MAJOR = keySignatureFor(0, "major");

export function accidentalFor(alter) {
  return alter > 0 ? "sharp" : alter < 0 ? "flat" : "natural";
}

function leadingLetter(key) {
  const target = (key.tonicPitchClass + 11) % 12;
  for (let letter = 0; letter < 7; letter++) {
    const sounding = (NATURAL_PC[letter] + key.alter[letter] + 12) % 12;
    if ((sounding + 1) % 12 === target) return letter;
  }
  return null;
}

function finish(midi, letter, alter, key) {
  const octave = Math.round((Math.round(midi) - alter - NATURAL_PC[letter]) / 12) - 1;
  const signatureAlter = key.alter[letter];
  return {
    letter,
    step: octave * 7 + letter,
    alter,
    accidental: alter === signatureAlter ? null : accidentalFor(alter),
  };
}

export function spell(midi, key) {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  for (let letter = 0; letter < 7; letter++) {
    const sounding = (NATURAL_PC[letter] + key.alter[letter] + 12) % 12;
    if (sounding === pc) return finish(midi, letter, key.alter[letter], key);
  }
  if (key.mode === "minor" && pc === (key.tonicPitchClass + 11) % 12) {
    const seventh = leadingLetter(key);
    if (seventh !== null && Math.abs(key.alter[seventh] + 1) <= 1) {
      return finish(midi, seventh, key.alter[seventh] + 1, key);
    }
  }
  const flats = key.fifths < 0;
  const letter = (flats ? PC_LETTER_FLAT : PC_LETTER_SHARP)[pc];
  const alter = (flats ? PC_ALTER_FLAT : PC_ALTER_SHARP)[pc];
  return finish(midi, letter, alter, key);
}

// ─── StaffNotation.tsx, as an SVG string ──────────────────────────────────────

const LINE_GAP = 12;
const STEP = LINE_GAP / 2;
const HEAD_RX = 6.2;
const HEAD_RY = 4.6;
const STEM = LINE_GAP * 2.8;
const NOTE_W = 30;
const BAR_PAD = 10;
const HEAD_PAD = 6;
const SIG_PACK = 2.5;
const ACC_GAP = 2.5;
const CLEF_STROKE = 2.3;

const ACCIDENTAL_INK = {
  sharp: { w: 7.5, up: 6, down: 6 },
  flat: { w: 6, up: 10, down: 5 },
  natural: { w: 5.4, up: 8, down: 8 },
};

const SIG_STEP_SHARP = [35, 36, 37, 38, 39, 33, 34];
const SIG_STEP_FLAT = [35, 36, 37, 31, 32, 33, 34];

const TREBLE = { kind: "treble", topLineStep: 38, refStep: 32, sigOffset: 0 };
const BASS = { kind: "bass", topLineStep: 26, refStep: 24, sigOffset: -14 };

const CLEF_ART = {
  treble: {
    paths: [
      "M 1.08 -3.80 C 1.20 -2.70, 1.31 -1.40, 1.34 -0.06" +
        " C 1.37 0.98, 1.31 1.72, 1.13 2.22" +
        " C 0.96 2.70, 0.50 2.88, 0.25 2.60" +
        " C 0.06 2.38, 0.16 2.04, 0.44 2.00",
      "M 1.08 -3.80 C 1.02 -4.24, 0.44 -4.22, 0.18 -3.78" +
        " C 0.00 -3.46, 0.04 -3.16, 0.12 -2.96" +
        " C 0.20 -2.34, 0.02 -1.74, 0.36 -1.04" +
        " C 0.74 -0.40, 2.00 -0.86, 2.10 -0.20" +
        " C 2.20 0.46, 1.72 0.90, 1.20 0.82" +
        " C 0.72 0.74, 0.52 0.20, 0.74 -0.18" +
        " C 0.94 -0.50, 1.44 -0.48, 1.52 -0.14",
    ],
    dots: [],
    ink: { x0: 0.0524, x1: 2.1133, y0: -4.1202, y1: 2.7327 },
  },
  bass: {
    paths: [
      "M 0.16 0.46 C 0.10 -0.30, 0.60 -0.92, 1.24 -0.86" +
        " C 1.86 -0.80, 2.16 -0.20, 2.10 0.44" +
        " C 1.98 1.42, 1.24 2.10, 0.30 2.52" +
        " C 0.06 2.62, -0.12 2.66, -0.28 2.66",
    ],
    dots: [
      { cx: 2.52, cy: -0.5, r: 0.14 },
      { cx: 2.52, cy: 0.5, r: 0.14 },
    ],
    ink: { x0: -0.28, x1: 2.66, y0: -0.8639, y1: 2.66 },
  },
};

const TS_FONT = LINE_GAP * 2.5;
const TS_BASELINE = 0.36;
const TS_DIGIT_W = TS_FONT * 0.677;

function meterWidth(timeSignature) {
  const [num, den] = timeSignature.split("/");
  if (!num || !den) return 0;
  return Math.max(num.length, den.length) * TS_DIGIT_W;
}

function glyphFor(durBeats) {
  if (durBeats >= 4) return { open: true, stem: false, flags: 0 };
  if (durBeats >= 2) return { open: true, stem: true, flags: 0 };
  if (durBeats >= 1) return { open: false, stem: true, flags: 0 };
  if (durBeats >= 0.5) return { open: false, stem: true, flags: 1 };
  return { open: false, stem: true, flags: 2 };
}

function pickClef(notes) {
  if (notes.length === 0) return TREBLE;
  const sorted = notes.map((n) => n.pitchMidi).sort((a, b) => a - b);
  return sorted[sorted.length >> 1] < 52 ? BASS : TREBLE;
}

const yOfStep = (step, topLineStep) => (topLineStep - step) * STEP;

/** `confidenceColor` from design/theme.ts. */
export function confidenceColor(v, c) {
  return v >= 0.75 ? c.confHigh : v >= 0.5 ? c.confMed : c.confLow;
}

/** `confidenceLabel` from design/theme.ts. */
export function confidenceLabel(v) {
  return v >= 0.75
    ? "High confidence"
    : v >= 0.5
      ? "Fair — worth a review"
      : "Low — please double-check";
}

function accidentalPaths(kind, x, y, color) {
  if (kind === "sharp") {
    return (
      `<g stroke="${color}" stroke-width="1.1">` +
      `<line x1="${x + 2}" y1="${y - 5}" x2="${x + 2}" y2="${y + 6}"/>` +
      `<line x1="${x + 5.5}" y1="${y - 6}" x2="${x + 5.5}" y2="${y + 5}"/>` +
      `<line x1="${x}" y1="${y - 1.5}" x2="${x + 7.5}" y2="${y - 3}" stroke-width="1.6"/>` +
      `<line x1="${x}" y1="${y + 3}" x2="${x + 7.5}" y2="${y + 1.5}" stroke-width="1.6"/>` +
      `</g>`
    );
  }
  if (kind === "flat") {
    return (
      `<g stroke="${color}" stroke-width="1.3" fill="none" stroke-linecap="round">` +
      `<line x1="${x + 1}" y1="${y - 9.5}" x2="${x + 1}" y2="${y + 4}"/>` +
      `<path d="M${x + 1} ${y - 1} C ${x + 6} ${y - 3}, ${x + 7} ${y + 1.5}, ${x + 1} ${y + 4.5}"/>` +
      `</g>`
    );
  }
  return (
    `<g stroke="${color}" stroke-width="1.2">` +
    `<line x1="${x + 0.9}" y1="${y - 7.5}" x2="${x + 0.9}" y2="${y + 4}"/>` +
    `<line x1="${x + 4.6}" y1="${y - 4}" x2="${x + 4.6}" y2="${y + 7.5}"/>` +
    `<line x1="${x + 0.9}" y1="${y - 2.4}" x2="${x + 4.6}" y2="${y - 3.8}" stroke-width="1.7"/>` +
    `<line x1="${x + 0.9}" y1="${y + 2.6}" x2="${x + 4.6}" y2="${y + 1.2}" stroke-width="1.7"/>` +
    `</g>`
  );
}

/**
 * The engraved stave for a note list, as an `<svg>` string. A direct port of
 * StaffNotation's buildModel + render, so a head that sits on the wrong line
 * here would sit on the wrong line in the app too.
 */
export function staffSvg(notes, timeSignature, musicalKey, c) {
  if (notes.length === 0) return { svg: "", width: 0, height: 0 };

  const clef = pickClef(notes);
  const parsed = parseKey(musicalKey);
  const key = parsed === null ? C_MAJOR : keySignatureFor(parsed.tonicPitchClass, parsed.mode);
  const perBar = beatsPerBar(timeSignature);

  const art = CLEF_ART[clef.kind];
  const clefX = HEAD_PAD - art.ink.x0 * LINE_GAP;
  let cursor = HEAD_PAD + (art.ink.x1 - art.ink.x0) * LINE_GAP;

  const keySig = [];
  if (key.accidentals.length > 0) {
    cursor += HEAD_PAD;
    for (const acc of key.accidentals) {
      const table = acc.kind === "sharp" ? SIG_STEP_SHARP : SIG_STEP_FLAT;
      const step = table[acc.letter] + clef.sigOffset;
      keySig.push({ x: cursor, y: yOfStep(step, clef.topLineStep), kind: acc.kind });
      cursor += ACCIDENTAL_INK[acc.kind].w + SIG_PACK;
    }
    cursor -= SIG_PACK;
  }

  const tsX = cursor + HEAD_PAD;
  cursor = tsX + meterWidth(timeSignature);

  const columns = [];
  const barlines = [];
  const barAlter = new Map();
  let x = cursor + BAR_PAD;
  let lastBar = 0;

  const bottomLineStep = clef.topLineStep - 8;
  const topLineStep = clef.topLineStep;

  for (const n of notes) {
    const bar = perBar > 0 ? Math.floor(n.startBeat / perBar) : 0;
    if (bar > lastBar) {
      barlines.push(x + BAR_PAD / 2);
      x += BAR_PAD;
      lastBar = bar;
      barAlter.clear();
    }

    const sp = spell(n.pitchMidi, key);
    const stated = barAlter.get(sp.step);
    const accidental =
      stated === undefined
        ? sp.accidental
        : sp.alter === stated
          ? null
          : accidentalFor(sp.alter);
    if (accidental !== null) barAlter.set(sp.step, sp.alter);

    const accX = x;
    const headX =
      accidental === null ? x + HEAD_RX : x + ACCIDENTAL_INK[accidental].w + ACC_GAP + HEAD_RX;
    const y = yOfStep(sp.step, clef.topLineStep);

    const ledgers = [];
    if (sp.step > topLineStep) {
      for (let s = topLineStep + 2; s <= sp.step; s += 2) ledgers.push(yOfStep(s, clef.topLineStep));
    } else if (sp.step < bottomLineStep) {
      for (let s = bottomLineStep - 2; s >= sp.step; s -= 2) ledgers.push(yOfStep(s, clef.topLineStep));
    }

    columns.push({ x: headX, y, glyph: glyphFor(n.durBeats), accidental, accX, conf: n.conf, ledgers });
    x = headX - HEAD_RX + NOTE_W;
  }

  const finalBarX = x - NOTE_W * 0.3;
  barlines.push(finalBarX);
  const contentWidth = finalBarX + BAR_PAD;

  const midY =
    (yOfStep(topLineStep, clef.topLineStep) + yOfStep(bottomLineStep, clef.topLineStep)) / 2;
  let minY = yOfStep(topLineStep, clef.topLineStep);
  let maxY = yOfStep(bottomLineStep, clef.topLineStep);

  const refY = yOfStep(clef.refStep, clef.topLineStep);
  minY = Math.min(minY, refY + art.ink.y0 * LINE_GAP - CLEF_STROKE / 2);
  maxY = Math.max(maxY, refY + art.ink.y1 * LINE_GAP + CLEF_STROKE / 2);

  for (const g of keySig) {
    minY = Math.min(minY, g.y - ACCIDENTAL_INK[g.kind].up);
    maxY = Math.max(maxY, g.y + ACCIDENTAL_INK[g.kind].down);
  }
  for (const col of columns) {
    const stemDown = col.y < midY;
    const stemEnd = stemDown ? col.y + STEM : col.y - STEM;
    minY = Math.min(minY, col.y - HEAD_RY, stemEnd, ...col.ledgers);
    maxY = Math.max(maxY, col.y + HEAD_RY, stemEnd, ...col.ledgers);
    if (col.accidental !== null) {
      minY = Math.min(minY, col.y - ACCIDENTAL_INK[col.accidental].up);
      maxY = Math.max(maxY, col.y + ACCIDENTAL_INK[col.accidental].down);
    }
  }
  const MARGIN = 10;
  minY -= MARGIN;
  maxY += MARGIN;

  const height = maxY - minY;
  const staffLineY = (i) => yOfStep(clef.topLineStep - i * 2, clef.topLineStep);
  const lineColor = c.border;
  const ink = c.textMuted;

  const parts = [];

  parts.push(`<g stroke="${lineColor}" stroke-width="1">`);
  for (let i = 0; i < 5; i++) {
    parts.push(`<line x1="0" y1="${staffLineY(i)}" x2="${contentWidth}" y2="${staffLineY(i)}"/>`);
  }
  parts.push(`</g>`);

  parts.push(
    `<g transform="translate(${clefX}, ${refY}) scale(${LINE_GAP})" stroke="${ink}"` +
      ` stroke-width="${CLEF_STROKE / LINE_GAP}" fill="none" stroke-linecap="round">` +
      art.paths.map((d) => `<path d="${d}"/>`).join("") +
      art.dots
        .map((dt) => `<circle cx="${dt.cx}" cy="${dt.cy}" r="${dt.r}" fill="${ink}" stroke="none"/>`)
        .join("") +
      `</g>`,
  );

  for (const g of keySig) parts.push(accidentalPaths(g.kind, g.x, g.y, ink));

  const [num, den] = timeSignature.split("/");
  if (num && den) {
    const cx = tsX + meterWidth(timeSignature) / 2;
    const mid = (staffLineY(0) + staffLineY(4)) / 2;
    parts.push(
      `<g fill="${ink}" font-size="${TS_FONT}" font-family="Poppins" font-weight="700" text-anchor="middle">` +
        `<text x="${cx}" y="${mid - LINE_GAP + TS_FONT * TS_BASELINE}">${num}</text>` +
        `<text x="${cx}" y="${mid + LINE_GAP + TS_FONT * TS_BASELINE}">${den}</text>` +
        `</g>`,
    );
  }

  parts.push(`<g stroke="${ink}" stroke-width="1.2">`);
  for (const bx of barlines) {
    parts.push(`<line x1="${bx}" y1="${staffLineY(0)}" x2="${bx}" y2="${staffLineY(4)}"/>`);
  }
  parts.push(`</g>`);

  for (const col of columns) {
    const color = confidenceColor(col.conf, c);
    const stemDown = col.y < (staffLineY(0) + staffLineY(4)) / 2;
    const stemX = stemDown ? col.x - HEAD_RX + 0.4 : col.x + HEAD_RX - 0.4;
    const stemEnd = stemDown ? col.y + STEM : col.y - STEM;

    parts.push(`<g>`);
    for (const ly of col.ledgers) {
      parts.push(
        `<line x1="${col.x - 9}" y1="${ly}" x2="${col.x + 9}" y2="${ly}" stroke="${ink}" stroke-width="1"/>`,
      );
    }
    if (col.accidental !== null) parts.push(accidentalPaths(col.accidental, col.accX, col.y, ink));
    parts.push(
      `<ellipse cx="${col.x}" cy="${col.y}" rx="${HEAD_RX}" ry="${HEAD_RY}"` +
        ` transform="rotate(-20 ${col.x} ${col.y})" fill="${col.glyph.open ? "none" : color}"` +
        ` stroke="${color}" stroke-width="${col.glyph.open ? 1.8 : 0}"/>`,
    );
    if (col.glyph.stem) {
      parts.push(
        `<line x1="${stemX}" y1="${col.y}" x2="${stemX}" y2="${stemEnd}" stroke="${color}" stroke-width="1.6"/>`,
      );
    }
    for (let i = 0; i < col.glyph.flags; i++) {
      const fy = stemEnd + (stemDown ? -1 : 1) * i * 6;
      const d = stemDown
        ? `M${stemX} ${fy} c 7 -3, 9 -9, 5 -15`
        : `M${stemX} ${fy} c 7 3, 9 9, 5 15`;
      parts.push(`<path d="${d}" stroke="${color}" stroke-width="1.6" fill="none"/>`);
    }
    parts.push(`</g>`);
  }

  const svg =
    `<svg width="${contentWidth}" height="${height}" viewBox="0 ${minY} ${contentWidth} ${height}"` +
    ` xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;

  return { svg, width: contentWidth, height };
}
