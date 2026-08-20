import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, {
  Ellipse,
  G,
  Line,
  Path,
  Circle,
  Text as SvgText,
} from "react-native-svg";
import { confidenceColor, fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { parseKey } from "../lib/solfa";
import {
  accidentalFor,
  keySignatureFor,
  spell,
  C_MAJOR,
  type Accidental,
  type KeySignature,
} from "../lib/keySignature";
import type { NoteEvent } from "../api/types";

/**
 * StaffNotation — a real five-line stave rendered from the transcribed note list.
 *
 * The MusicXML export (see lib/export) hands a fully engraved score to
 * MuseScore/Sibelius; this component is the *in-app* view, so a user sees the
 * notes on a stave without leaving NoteFusion. It is a faithful placement — not
 * a full engraver — so it draws the clef, key signature, meter, heads, stems,
 * flags, ledger lines, accidentals and barlines, but it does not beam runs of
 * quavers together or lay notes out proportionally to their duration.
 * Proportional engraving is what the export is for; on a phone, even sequential
 * spacing reads more clearly.
 *
 * Placement is diatonic, not chromatic: C and C# share a staff line (C# is C with
 * a sharp), so a MIDI pitch is first resolved to a letter + octave + accidental,
 * then to a vertical step. Which letter depends on the key, so that resolution
 * lives in lib/keySignature — pitch class 10 is a Bb on the B line in D minor and
 * an A# on the A line in B major, and spelling it as a sharp regardless puts the
 * head on the wrong line. That module names *letters* for engraving; lib/solfa
 * names *syllables* from scale degrees. The two are independent by design, so
 * nothing here changes a syllable or needs mirroring in the C#/Python engines.
 *
 * Everything left of the first note is measured, never assumed: the clef artwork
 * is authored in staff-space units and reports its own ink box, and a single
 * left-to-right cursor places the signature and meter after it. That is what
 * keeps the clef from colliding with the meter at any LINE_GAP.
 *
 * PRD honesty rule: each note head is tinted by its own confidence (green / amber
 * / red), so a low-confidence note is as visible on the stave as it is in the grid.
 */

interface Props {
  notes: readonly NoteEvent[];
  /** Quarter-note beats per bar are derived from this (e.g. "6/8" → 3). */
  timeSignature: string;
  /**
   * The key the notes are read in, e.g. "D minor". Drives the key signature and
   * the spelling of every accidental. Pass the *current* key so a re-key
   * re-labels the stave; unparseable or absent falls back to C major.
   */
  musicalKey?: string | null;
  /** Tint each head by its confidence. On by default per the PRD honesty rule. */
  colorByConfidence?: boolean;
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

/** Pixels between two adjacent staff lines. One diatonic step is half of this. */
const LINE_GAP = 12;
const STEP = LINE_GAP / 2;
/** Note-head radii. */
const HEAD_RX = 6.2;
const HEAD_RY = 4.6;
/** Stem length, in whole line-gaps. */
const STEM = LINE_GAP * 2.8;
/** Horizontal slot each note occupies. */
const NOTE_W = 30;
/** Padding after a barline before the next bar's first note. */
const BAR_PAD = 10;
/** Left margin before the clef, and the gaps either side of the key signature. */
const HEAD_PAD = 6;
/** Gap between two adjacent key-signature glyphs. Wide enough to cover the
 *  stroke overhang either side, which the ink widths below exclude. */
const SIG_PACK = 2.5;
/** Gap between an accidental's right edge and the head it belongs to. */
const ACC_GAP = 2.5;
/** Stroke width the clef artwork is drawn at, in pixels. */
const CLEF_STROKE = 2.3;

/**
 * Ink box of each accidental glyph, in pixels relative to its (x, y) anchor:
 * `w` right of x, `up` above y, `down` below y. The layout cursor needs `w` to
 * reserve horizontal space and the vertical pair to keep a high sharp in the key
 * signature from clipping out of the top of the SVG.
 */
const ACCIDENTAL_INK: Record<Accidental, { w: number; up: number; down: number }> = {
  sharp: { w: 7.5, up: 6, down: 6 },
  flat: { w: 6, up: 10, down: 5 },
  natural: { w: 5.4, up: 8, down: 8 },
};

/**
 * Staff step of each letter's key-signature glyph in the treble clef, C..B.
 * These are fixed positions, not derived: convention puts the sharps at F5 C5 G5
 * D5 A4 E5 B4 and the flats at B4 E5 A4 D5 G4 C5 F4, which differ for F, G and C
 * because a flat sequence descends where a sharp sequence climbs.
 */
const SIG_STEP_SHARP = [35, 36, 37, 38, 39, 33, 34] as const;
const SIG_STEP_FLAT = [35, 36, 37, 31, 32, 33, 34] as const;

/** Quarter-note beats per bar. "6/8" → 3 (six eighths = three quarters). Falls back to 4. */
function beatsPerBar(timeSignature: string): number {
  const [num, den] = timeSignature.split("/").map(Number);
  if (!num || !den) return 4;
  return (num * 4) / den;
}

interface Clef {
  kind: "treble" | "bass";
  /** Absolute diatonic step sitting on the top staff line. */
  topLineStep: number;
  /** Step of the line the clef names: G4 for the treble, F3 for the bass. */
  refStep: number;
  /**
   * Added to the treble key-signature steps above. Fourteen, not the twelve steps
   * between the two clefs' top lines: the conventional bass placements sit one
   * staff position lower than a straight transposition of the treble ones.
   */
  sigOffset: number;
}

const TREBLE: Clef = { kind: "treble", topLineStep: 38, refStep: 32, sigOffset: 0 };
const BASS: Clef = { kind: "bass", topLineStep: 26, refStep: 24, sigOffset: -14 };

/** Treble unless the melody's median sits well below the treble staff. */
function pickClef(notes: readonly NoteEvent[]): Clef {
  if (notes.length === 0) return TREBLE;
  const sorted = [...notes].map((n) => n.pitchMidi).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  // Below the C below middle C (MIDI 48) the treble staff needs too many ledger
  // lines to read; drop to bass. Top line: treble F5 → step 38, bass A3 → step 26.
  return median < 52 ? BASS : TREBLE;
}

// ─── Clef artwork ─────────────────────────────────────────────────────────────

/**
 * Both clefs are authored with **one unit = one staff space** and the origin on
 * the clef's own reference line — the G line for the treble, the F line for the
 * bass. Rendering is therefore `translate(x, referenceLineY) scale(LINE_GAP)`,
 * which is correct at any staff size: change LINE_GAP and the clef follows.
 *
 * `ink` is the measured bounding box of the sampled curves in the same units
 * (.preview/clef_author.py renders and reports it). The layout cursor places the
 * clef by its ink, not by a guessed column width, and folds the vertical extent
 * into the SVG box so the tail cannot clip.
 */
interface ClefArt {
  paths: readonly string[];
  dots: readonly { cx: number; cy: number; r: number }[];
  ink: { x0: number; x1: number; y0: number; y1: number };
}

const CLEF_ART: Record<Clef["kind"], ClefArt> = {
  treble: {
    paths: [
      // The spine: top tip, down through the staff, into the tail hook.
      "M 1.08 -3.80 C 1.20 -2.70, 1.31 -1.40, 1.34 -0.06" +
        " C 1.37 0.98, 1.31 1.72, 1.13 2.22" +
        " C 0.96 2.70, 0.50 2.88, 0.25 2.60" +
        " C 0.06 2.38, 0.16 2.04, 0.44 2.00",
      // The crook, the left-bulging upper loop, and the spiral eye on the G line.
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
      // Head on the F line, over the top, then a tail sweeping down and left.
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

// ─── Duration → head shape ──────────────────────────────────────────────────

interface Glyph {
  open: boolean; // hollow head (half / whole)
  stem: boolean;
  flags: number; // 0 = crotchet, 1 = quaver, 2 = semiquaver
}

function glyphFor(durBeats: number): Glyph {
  if (durBeats >= 4) return { open: true, stem: false, flags: 0 }; // semibreve
  if (durBeats >= 2) return { open: true, stem: true, flags: 0 }; // minim
  if (durBeats >= 1) return { open: false, stem: true, flags: 0 }; // crotchet
  if (durBeats >= 0.5) return { open: false, stem: true, flags: 1 }; // quaver
  return { open: false, stem: true, flags: 2 }; // semiquaver
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StaffNotation({
  notes,
  timeSignature,
  musicalKey,
  colorByConfidence = true,
}: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const model = useMemo(
    () => buildModel(notes, timeSignature, musicalKey),
    [notes, timeSignature, musicalKey],
  );

  if (notes.length === 0 || model === null) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.empty}>No notes to place on a stave.</Text>
      </View>
    );
  }

  const { clef, clefX, keySig, tsX, columns, contentWidth, minY, maxY, barlines } = model;
  const height = maxY - minY;

  const staffLineY = (i: number) => yOfStep(clef.topLineStep - i * 2, clef.topLineStep);
  const lineColor = colors.border;
  const inkColor = colors.textMuted;

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* The viewBox starts at minY, which is negative whenever a ledger line,
            high accidental or the clef's top reaches above the top staff line.
            That is what lets model space keep the top line at y=0 — the natural
            origin for diatonic steps — without anything clipping off the top. */}
        <Svg width={contentWidth} height={height} viewBox={`0 ${minY} ${contentWidth} ${height}`}>
          {/* Five staff lines, spanning the full content width. */}
          <G stroke={lineColor} strokeWidth={1}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Line key={i} x1={0} y1={staffLineY(i)} x2={contentWidth} y2={staffLineY(i)} />
            ))}
          </G>

          {/* Clef, scaled from staff-space artwork onto this staff. */}
          <ClefGlyph clef={clef} x={clefX} color={inkColor} />

          {/* Key signature, in canonical order after the clef. */}
          {keySig.map((g, i) => (
            <AccidentalGlyph key={i} kind={g.kind} x={g.x} y={g.y} color={inkColor} />
          ))}

          {/* Time signature, stacked after the key signature. */}
          <TimeSignature
            timeSignature={timeSignature}
            x={tsX}
            midY={(staffLineY(0) + staffLineY(4)) / 2}
            color={inkColor}
          />

          {/* Barlines. */}
          <G stroke={inkColor} strokeWidth={1.2}>
            {barlines.map((x, i) => (
              <Line key={i} x1={x} y1={staffLineY(0)} x2={x} y2={staffLineY(4)} />
            ))}
          </G>

          {/* Notes. */}
          {columns.map((col, i) => {
            const head = colorByConfidence ? confidenceColor(col.conf, colors) : inkColor;
            return (
              <NoteGlyph
                key={i}
                x={col.x}
                y={col.y}
                glyph={col.glyph}
                accidental={col.accidental}
                accX={col.accX}
                stemDown={col.y < (staffLineY(0) + staffLineY(4)) / 2}
                ledgers={col.ledgers}
                topLineY={staffLineY(0)}
                bottomLineY={staffLineY(4)}
                color={head}
                inkColor={inkColor}
              />
            );
          })}
        </Svg>
      </ScrollView>
    </View>
  );
}

// ─── Layout model ─────────────────────────────────────────────────────────────

interface Column {
  x: number;
  y: number; // head centre, model space
  glyph: Glyph;
  /** Glyph this note needs, or null when the signature or the bar already said it. */
  accidental: Accidental | null;
  /** Left edge of that glyph. Meaningless when `accidental` is null. */
  accX: number;
  conf: number;
  ledgers: number[]; // model-space y of each ledger line for this note
}

interface SigGlyph {
  x: number;
  y: number;
  kind: "sharp" | "flat";
}

interface Model {
  clef: Clef;
  /** Translate x for the clef artwork, chosen so its ink starts at HEAD_PAD. */
  clefX: number;
  keySig: SigGlyph[];
  tsX: number;
  columns: Column[];
  barlines: number[];
  contentWidth: number;
  minY: number;
  maxY: number;
}

/** y of a diatonic step in model space (origin at the top staff line's step). */
function yOfStep(step: number, topLineStep: number): number {
  return (topLineStep - step) * STEP;
}

/** The key signature to draw, falling back to C major when the key is unreadable. */
function resolveKey(musicalKey: string | null | undefined): KeySignature {
  const parsed = parseKey(musicalKey);
  return parsed === null ? C_MAJOR : keySignatureFor(parsed.tonicPitchClass, parsed.mode);
}

function buildModel(
  notes: readonly NoteEvent[],
  timeSignature: string,
  musicalKey: string | null | undefined,
): Model | null {
  if (notes.length === 0) return null;

  const clef = pickClef(notes);
  const key = resolveKey(musicalKey);
  const perBar = beatsPerBar(timeSignature);

  // ── everything left of the first note, placed by one left-to-right cursor ──
  const art = CLEF_ART[clef.kind];
  const clefX = HEAD_PAD - art.ink.x0 * LINE_GAP;
  let cursor = HEAD_PAD + (art.ink.x1 - art.ink.x0) * LINE_GAP;

  const keySig: SigGlyph[] = [];
  if (key.accidentals.length > 0) {
    cursor += HEAD_PAD;
    for (const acc of key.accidentals) {
      const table = acc.kind === "sharp" ? SIG_STEP_SHARP : SIG_STEP_FLAT;
      const step = table[acc.letter]! + clef.sigOffset;
      keySig.push({ x: cursor, y: yOfStep(step, clef.topLineStep), kind: acc.kind });
      cursor += ACCIDENTAL_INK[acc.kind].w + SIG_PACK;
    }
    cursor -= SIG_PACK;
  }

  const tsX = cursor + HEAD_PAD;
  cursor = tsX + meterWidth(timeSignature);

  const columns: Column[] = [];
  const barlines: number[] = [];
  /** Alteration each staff step has been given so far *in this bar*. */
  const barAlter = new Map<number, number>();
  // The cursor is the left edge of the next note's slot, accidental included.
  let x = cursor + BAR_PAD;
  let lastBar = 0;

  const bottomLineStep = clef.topLineStep - 8; // 5 lines span 8 steps
  const topLineStep = clef.topLineStep;

  for (const n of notes) {
    // Insert a barline whenever the note crosses into a new bar.
    const bar = perBar > 0 ? Math.floor(n.startBeat / perBar) : 0;
    if (bar > lastBar) {
      barlines.push(x + BAR_PAD / 2);
      x += BAR_PAD;
      lastBar = bar;
      // Accidentals last to the end of their bar, so the barline cancels them.
      barAlter.clear();
    }

    const sp = spell(n.pitchMidi, key);

    // `sp.accidental` de-duplicates against the key signature. A bar-scoped
    // accidental overrides the signature until the barline, so it both suppresses
    // a repeat of itself and forces a cancelling glyph when the line returns to
    // what the signature says.
    const stated = barAlter.get(sp.step);
    const accidental =
      stated === undefined
        ? sp.accidental
        : sp.alter === stated
          ? null
          : accidentalFor(sp.alter);
    if (accidental !== null) barAlter.set(sp.step, sp.alter);

    // An accidental sits left of the head, so it widens this slot rather than
    // overprinting whatever precedes it.
    const accX = x;
    const headX =
      accidental === null
        ? x + HEAD_RX
        : x + ACCIDENTAL_INK[accidental].w + ACC_GAP + HEAD_RX;
    const y = yOfStep(sp.step, clef.topLineStep);

    // Ledger lines sit on every line-position (even step offset from a line)
    // outside the staff. Lines fall on steps topLineStep, topLineStep-2, … .
    const ledgers: number[] = [];
    if (sp.step > topLineStep) {
      for (let s = topLineStep + 2; s <= sp.step; s += 2) {
        ledgers.push(yOfStep(s, clef.topLineStep));
      }
    } else if (sp.step < bottomLineStep) {
      for (let s = bottomLineStep - 2; s >= sp.step; s -= 2) {
        ledgers.push(yOfStep(s, clef.topLineStep));
      }
    }

    columns.push({
      x: headX,
      y,
      glyph: glyphFor(n.durBeats),
      accidental,
      accX,
      conf: n.conf,
      ledgers,
    });
    x = headX - HEAD_RX + NOTE_W;
  }

  // A trailing final barline closes the last bar.
  const finalBarX = x - NOTE_W * 0.3;
  barlines.push(finalBarX);
  const contentWidth = finalBarX + BAR_PAD;

  // Vertical extent: every head, stem end, ledger, accidental and staff line,
  // plus the clef — whose tail reaches well past the staff — and a margin so
  // nothing clips. Stems can go either way, so account for both.
  const midY = (yOfStep(topLineStep, clef.topLineStep) + yOfStep(bottomLineStep, clef.topLineStep)) / 2;
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

  return { clef, clefX, keySig, tsX, columns, barlines, contentWidth, minY, maxY };
}

// ─── Note glyph ───────────────────────────────────────────────────────────────

function NoteGlyph({
  x,
  y,
  glyph,
  accidental,
  accX,
  stemDown,
  ledgers,
  topLineY,
  bottomLineY,
  color,
  inkColor,
}: {
  x: number;
  y: number;
  glyph: Glyph;
  accidental: Accidental | null;
  accX: number;
  stemDown: boolean;
  ledgers: number[];
  topLineY: number;
  bottomLineY: number;
  color: string;
  inkColor: string;
}) {
  const stemX = stemDown ? x - HEAD_RX + 0.4 : x + HEAD_RX - 0.4;
  const stemEnd = stemDown ? y + STEM : y - STEM;

  return (
    <G>
      {/* Ledger lines — a touch wider than the head. */}
      {ledgers.map((ly, i) => (
        <Line key={i} x1={x - 9} y1={ly} x2={x + 9} y2={ly} stroke={inkColor} strokeWidth={1} />
      ))}

      {/* Accidental. */}
      {accidental !== null && (
        <AccidentalGlyph kind={accidental} x={accX} y={y} color={inkColor} />
      )}

      {/* Head — hollow for minim/semibreve, filled otherwise. */}
      <Ellipse
        cx={x}
        cy={y}
        rx={HEAD_RX}
        ry={HEAD_RY}
        transform={`rotate(-20 ${x} ${y})`}
        fill={glyph.open ? "none" : color}
        stroke={color}
        strokeWidth={glyph.open ? 1.8 : 0}
      />

      {/* Stem. */}
      {glyph.stem && (
        <Line x1={stemX} y1={y} x2={stemX} y2={stemEnd} stroke={color} strokeWidth={1.6} />
      )}

      {/*
       * Flags. A flag always hangs off the **right** of the stem and curves back
       * toward the head, whichever way the stem points — so a down stem mirrors
       * the shape vertically, not horizontally. Extra flags stack 6px back along
       * the stem, i.e. toward the head.
       */}
      {glyph.flags > 0 &&
        Array.from({ length: glyph.flags }).map((_, i) => {
          const fy = stemEnd + (stemDown ? -1 : 1) * i * 6;
          const d = stemDown
            ? `M${stemX} ${fy} c 7 -3, 9 -9, 5 -15`
            : `M${stemX} ${fy} c 7 3, 9 9, 5 15`;
          return <Path key={i} d={d} stroke={color} strokeWidth={1.6} fill="none" />;
        })}
    </G>
  );
}

// ─── Accidentals ──────────────────────────────────────────────────────────────

/**
 * All three glyphs share one anchor convention: `x` is the **left edge of the
 * ink** and `y` the staff position the glyph belongs to. Both the key signature
 * and the inline accidentals are placed from ACCIDENTAL_INK above, so the two
 * cannot drift apart.
 */
function AccidentalGlyph({
  kind,
  x,
  y,
  color,
}: {
  kind: Accidental;
  x: number;
  y: number;
  color: string;
}) {
  if (kind === "sharp") return <Sharp x={x} y={y} color={color} />;
  if (kind === "flat") return <Flat x={x} y={y} color={color} />;
  return <Natural x={x} y={y} color={color} />;
}

/** Two verticals crossed by two slightly-rising bars. */
function Sharp({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <G stroke={color} strokeWidth={1.1}>
      <Line x1={x + 2} y1={y - 5} x2={x + 2} y2={y + 6} />
      <Line x1={x + 5.5} y1={y - 6} x2={x + 5.5} y2={y + 5} />
      <Line x1={x} y1={y - 1.5} x2={x + 7.5} y2={y - 3} strokeWidth={1.6} />
      <Line x1={x} y1={y + 3} x2={x + 7.5} y2={y + 1.5} strokeWidth={1.6} />
    </G>
  );
}

/** A stem rising well above the line, with a bowl bulging right of its foot. */
function Flat({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <G stroke={color} strokeWidth={1.3} fill="none" strokeLinecap="round">
      <Line x1={x + 1} y1={y - 9.5} x2={x + 1} y2={y + 4} />
      <Path d={`M${x + 1} ${y - 1} C ${x + 6} ${y - 3}, ${x + 7} ${y + 1.5}, ${x + 1} ${y + 4.5}`} />
    </G>
  );
}

/** Two offset verticals joined by two bars — the box that cancels an alteration. */
function Natural({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <G stroke={color} strokeWidth={1.2}>
      <Line x1={x + 0.9} y1={y - 7.5} x2={x + 0.9} y2={y + 4} />
      <Line x1={x + 4.6} y1={y - 4} x2={x + 4.6} y2={y + 7.5} />
      <Line x1={x + 0.9} y1={y - 2.4} x2={x + 4.6} y2={y - 3.8} strokeWidth={1.7} />
      <Line x1={x + 0.9} y1={y + 2.6} x2={x + 4.6} y2={y + 1.2} strokeWidth={1.7} />
    </G>
  );
}

// ─── Clef (drawn, so it recolours for dark mode and stays crisp when scaled) ──

function ClefGlyph({ clef, x, color }: { clef: Clef; x: number; color: string }) {
  const art = CLEF_ART[clef.kind];
  const refY = yOfStep(clef.refStep, clef.topLineStep);
  return (
    <G
      transform={`translate(${x}, ${refY}) scale(${LINE_GAP})`}
      stroke={color}
      // The whole group is scaled by LINE_GAP, so the stroke has to be divided by
      // it to come out at CLEF_STROKE pixels on screen.
      strokeWidth={CLEF_STROKE / LINE_GAP}
      fill="none"
      strokeLinecap="round"
    >
      {art.paths.map((d, i) => (
        <Path key={i} d={d} />
      ))}
      {art.dots.map((dot, i) => (
        <Circle key={i} cx={dot.cx} cy={dot.cy} r={dot.r} fill={color} stroke="none" />
      ))}
    </G>
  );
}

// ─── Time signature ─────────────────────────────────────────────────────────

/**
 * The meter is set in the app's own bold face rather than drawn.
 *
 * It used to be built out of seven-segment strokes, which renders 4 legibly and
 * 3, 6 and 8 as calculator boxes — a 6/8 came out as one box over another. Real
 * digits are the whole point of a time signature, and a stroked table good enough
 * for all of 0-9 is a lot of bezier authoring for two glyphs.
 *
 * The historical objection to <Text> was that the numeric baseline differs across
 * platforms. It does, but only the *alphabetic* baseline is used here, which is
 * well defined everywhere, and digits have no descender — so centring a digit on
 * a staff position is just the baseline plus half a cap height. `textAnchor`
 * handles the horizontal, so differing digit advances between the fallback font
 * and Poppins cannot shift it off centre either.
 */
const TS_FONT = LINE_GAP * 2.5;
/**
 * Half the cap height of Poppins Bold, as a fraction of font size — how far below
 * the intended centre the baseline has to sit for the digit to look centred.
 * Measured from the bundled TTF: cap height 0.720 em. Round digits (0 6 8 9)
 * overshoot to 0.745 em, but symmetrically top and bottom, so cap height is still
 * the right thing to centre on. Re-measure if `fonts.bold` ever changes.
 */
const TS_BASELINE = 0.36;
/**
 * Advance of the *widest* bold digit, 4 at 0.677 em, used only to reserve
 * horizontal space. The widest is the safe choice because the reserved box has to
 * hold whichever digits arrive; `textAnchor` then centres the real string inside
 * it, so a narrow numerator like "12" (0.947 em, not 1.354) simply sits centred
 * with a little slack either side rather than overflowing.
 */
const TS_DIGIT_W = TS_FONT * 0.677;

/** Width the meter needs, so 12/8 reserves more room than 4/4. */
function meterWidth(timeSignature: string): number {
  const [num, den] = timeSignature.split("/");
  if (!num || !den) return 0;
  return Math.max(num.length, den.length) * TS_DIGIT_W;
}

function TimeSignature({
  timeSignature,
  x,
  midY,
  color,
}: {
  timeSignature: string;
  x: number;
  midY: number;
  color: string;
}) {
  const [num, den] = timeSignature.split("/");
  if (!num || !den) return null;
  const cx = x + meterWidth(timeSignature) / 2;
  // Upper and lower halves of the staff: the numerator centres between the top
  // and middle lines, the denominator between the middle and bottom.
  return (
    <G fill={color} fontSize={TS_FONT} fontFamily={fonts.bold} textAnchor="middle">
      <SvgText x={cx} y={midY - LINE_GAP + TS_FONT * TS_BASELINE}>
        {num}
      </SvgText>
      <SvgText x={cx} y={midY + LINE_GAP + TS_FONT * TS_BASELINE}>
        {den}
      </SvgText>
    </G>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      backgroundColor: c.surface,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: spacing.md,
    },
    scrollContent: {
      paddingHorizontal: spacing.md,
      alignItems: "center",
    },
    empty: {
      ...typography.body,
      color: c.textFaint,
      fontStyle: "italic",
      paddingHorizontal: spacing.lg,
    },
    legend: {
      ...typography.caption,
      color: c.textFaint,
      fontFamily: fonts.regular,
    },
  });
