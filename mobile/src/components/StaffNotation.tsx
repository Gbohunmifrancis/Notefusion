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
 *
 * ── Who renders this ──────────────────────────────────────────────────────────
 * Nothing, at present: `ScoreView` (a WebView around OpenSheetMusicDisplay) took
 * over the in-app stave on the Result screen. What is still live is the *glyph
 * table* below — `CLEF_ART`, `SIG_STEP_SHARP` / `SIG_STEP_FLAT`, `ACCIDENTAL_INK`
 * and the three accidental components — which `PianoStaff` imports rather than
 * authoring a second treble clef. Those exports exist for that reason alone; the
 * component itself is kept for the day a stave has to render without a WebView.
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
export const LINE_GAP = 12;
export const STEP = LINE_GAP / 2;
/** Note-head radii. */
const HEAD_RX = 6.2;
const HEAD_RY = 4.6;
/** Stem length, in whole line-gaps. */
const STEM = LINE_GAP * 2.8;
/** Horizontal slot each note occupies. */
const NOTE_W = 30;
/** Padding after a barline before the next bar's first note. */
export const BAR_PAD = 10;
/** Left margin before the clef, and the gaps either side of the key signature. */
export const HEAD_PAD = 6;
/** Gap between two adjacent key-signature glyphs. Wide enough to cover the
 *  stroke overhang either side, which the ink widths below exclude. */
export const SIG_PACK = 2.5;
/** Gap between an accidental's right edge and the head it belongs to. */
export const ACC_GAP = 2.5;

/**
 * Ink box of each accidental glyph, in pixels relative to its (x, y) anchor:
 * `w` right of x, `up` above y, `down` below y. The layout cursor needs `w` to
 * reserve horizontal space and the vertical pair to keep a high sharp in the key
 * signature from clipping out of the top of the SVG.
 */
export const ACCIDENTAL_INK: Record<Accidental, { w: number; up: number; down: number }> = {
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
export const SIG_STEP_SHARP = [35, 36, 37, 38, 39, 33, 34] as const;
export const SIG_STEP_FLAT = [35, 36, 37, 31, 32, 33, 34] as const;

/** Quarter-note beats per bar. "6/8" → 3 (six eighths = three quarters). Falls back to 4. */
function beatsPerBar(timeSignature: string): number {
  const [num, den] = timeSignature.split("/").map(Number);
  if (!num || !den) return 4;
  return (num * 4) / den;
}

export interface Clef {
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

export const TREBLE: Clef = { kind: "treble", topLineStep: 38, refStep: 32, sigOffset: 0 };
export const BASS: Clef = { kind: "bass", topLineStep: 26, refStep: 24, sigOffset: -14 };

/** Treble unless the melody's median sits well below the treble staff. */
export function pickClef(notes: readonly NoteEvent[]): Clef {
  if (notes.length === 0) return TREBLE;
  const sorted = [...notes].map((n) => n.pitchMidi).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  // Below the C below middle C (MIDI 48) the treble staff needs too many ledger
  // lines to read; drop to bass. Top line: treble F5 → step 38, bass A3 → step 26.
  return median < 52 ? BASS : TREBLE;
}

// ─── Clef artwork ─────────────────────────────────────────────────────────────

/**
 * The same clef the engraver draws.
 *
 * `ScoreView` renders the stave with OpenSheetMusicDisplay, which draws through
 * VexFlow 1.2.93 and its Gonville glyph outlines — so the clef a user sees after
 * recording comes from `vexflow/src/fonts/vexflow_font.js`, glyphs `v83` (treble)
 * and `v79` (bass). These are those two outlines, converted once: VexFlow renders
 * them at `point: 40` against 10 px line spacing, which works out to 347.22 font
 * units per staff space, and its font is y-up while SVG is y-down. Dividing by the
 * former and negating the latter lands both clefs in the units below. The bass
 * clef's two dots are part of its outline, so `dots` is empty for both.
 *
 * The units are therefore **one unit = one staff space**, with the origin on the
 * clef's own reference line — the G line for the treble, the F line for the bass,
 * which is where a font puts its baseline. Rendering is
 * `translate(x, referenceLineY) scale(LINE_GAP)`, correct at any staff size:
 * change LINE_GAP and the clef follows.
 *
 * These are filled outlines, not stroked skeletons, which is what makes them read
 * as engraving rather than as a sketch of one. `ink` is the tight bounding box of
 * the curves, sampled at conversion time. The layout cursor places the clef by its
 * ink, not by a guessed column width, and folds the vertical extent into the SVG
 * box so the tail cannot clip.
 */
export interface ClefArt {
  paths: readonly string[];
  dots: readonly { cx: number; cy: number; r: number }[];
  ink: { x0: number; x1: number; y0: number; y1: number };
}

export const CLEF_ART: Record<Clef["kind"], ClefArt> = {
  treble: {
    paths: [
      "M 1.405 -4.317 C 1.411 -4.32 1.417 -4.32 1.426 -4.32 C 1.46 -4.32 1.5 -4.291 1.558 -4.219 C 1.791 -3.951 1.956 -3.485 1.956 -3.105 C 1.956 -3.076 1.95 -3.053 1.95 -3.024 C 1.924 -2.572 1.74 -2.2 1.374 -1.849 L 1.276 -1.754 L 1.241 -1.716 L 1.241 -1.705 L 1.261 -1.619 L 1.293 -1.463 L 1.325 -1.319 C 1.368 -1.123 1.385 -1.022 1.385 -1.022 C 1.385 -1.022 1.385 -1.022 1.385 -1.022 C 1.385 -1.022 1.397 -1.022 1.411 -1.025 C 1.426 -1.025 1.472 -1.031 1.521 -1.031 C 1.555 -1.031 1.59 -1.025 1.607 -1.025 C 2.013 -0.973 2.327 -0.683 2.416 -0.274 C 2.434 -0.207 2.439 -0.135 2.439 -0.063 C 2.439 0.325 2.206 0.697 1.817 0.873 C 1.794 0.887 1.786 0.89 1.786 0.89 L 1.786 0.893 C 1.786 0.893 1.803 0.959 1.817 1.034 L 1.86 1.253 L 1.901 1.428 C 1.924 1.541 1.935 1.621 1.935 1.693 C 1.935 1.757 1.927 1.814 1.912 1.881 C 1.814 2.281 1.466 2.52 1.103 2.52 C 0.924 2.52 0.74 2.462 0.579 2.333 C 0.435 2.212 0.372 2.102 0.372 1.958 C 0.372 1.705 0.576 1.526 0.789 1.526 C 0.864 1.526 0.939 1.549 1.011 1.593 C 1.132 1.676 1.187 1.803 1.187 1.927 C 1.187 2.117 1.054 2.304 0.827 2.318 L 0.804 2.318 L 0.821 2.33 C 0.916 2.37 1.011 2.39 1.103 2.39 C 1.336 2.39 1.555 2.272 1.688 2.068 C 1.763 1.953 1.803 1.817 1.803 1.682 C 1.803 1.63 1.794 1.578 1.783 1.521 C 1.783 1.515 1.774 1.469 1.763 1.426 C 1.699 1.115 1.662 0.933 1.662 0.933 C 1.662 0.933 1.662 0.933 1.662 0.933 C 1.656 0.933 1.644 0.933 1.636 0.939 C 1.607 0.945 1.547 0.959 1.521 0.962 C 1.457 0.971 1.397 0.973 1.339 0.973 C 0.775 0.973 0.251 0.593 0.069 0.032 C 0.023 -0.118 -0.003 -0.268 -0.003 -0.418 C -0.003 -0.717 0.092 -1.011 0.276 -1.273 C 0.478 -1.558 0.68 -1.803 0.927 -2.056 L 1.014 -2.146 L 0.994 -2.252 L 0.956 -2.428 L 0.907 -2.652 C 0.893 -2.736 0.876 -2.817 0.873 -2.834 C 0.858 -2.929 0.85 -3.021 0.85 -3.116 C 0.85 -3.479 0.968 -3.828 1.189 -4.107 C 1.256 -4.193 1.374 -4.308 1.405 -4.317",
      "M 1.581 -3.747 C 1.575 -3.747 1.567 -3.747 1.558 -3.747 C 1.44 -3.747 1.287 -3.637 1.184 -3.476 C 1.077 -3.318 1.022 -3.108 1.022 -2.892 C 1.022 -2.834 1.025 -2.773 1.034 -2.713 C 1.043 -2.67 1.045 -2.641 1.068 -2.537 L 1.109 -2.356 C 1.12 -2.301 1.129 -2.258 1.129 -2.252 L 1.129 -2.252 C 1.132 -2.252 1.221 -2.35 1.25 -2.385 C 1.538 -2.71 1.711 -3.053 1.748 -3.355 C 1.751 -3.384 1.751 -3.407 1.751 -3.436 C 1.751 -3.525 1.74 -3.612 1.719 -3.658 C 1.696 -3.704 1.644 -3.741 1.581 -3.747",
      "M 1.146 -1.521 C 1.14 -1.561 1.132 -1.593 1.132 -1.598 C 1.132 -1.598 1.132 -1.598 1.129 -1.598 C 1.123 -1.598 0.999 -1.454 0.913 -1.354 C 0.766 -1.175 0.611 -0.962 0.547 -0.858 C 0.426 -0.654 0.366 -0.426 0.366 -0.202 C 0.366 -0.055 0.395 0.086 0.446 0.222 C 0.602 0.622 0.959 0.873 1.348 0.873 C 1.394 0.873 1.446 0.87 1.495 0.861 C 1.558 0.85 1.636 0.827 1.636 0.818 L 1.636 0.818 C 1.636 0.818 1.63 0.789 1.621 0.757 L 1.538 0.346 L 1.472 0.037 L 1.428 -0.176 L 1.382 -0.383 C 1.359 -0.507 1.351 -0.539 1.351 -0.539 C 1.351 -0.539 1.351 -0.541 1.348 -0.541 C 1.331 -0.541 1.238 -0.495 1.198 -0.467 C 1.048 -0.363 0.971 -0.199 0.971 -0.037 C 0.971 0.115 1.045 0.268 1.189 0.357 C 1.221 0.377 1.233 0.395 1.233 0.415 C 1.233 0.418 1.233 0.426 1.233 0.429 C 1.227 0.464 1.207 0.478 1.178 0.478 C 1.166 0.478 1.152 0.475 1.135 0.467 C 0.87 0.351 0.691 0.078 0.691 -0.222 L 0.691 -0.222 C 0.691 -0.567 0.907 -0.867 1.238 -0.985 L 1.256 -0.991 L 1.227 -1.135 L 1.146 -1.521",
      "M 1.578 -0.559 C 1.555 -0.562 1.532 -0.562 1.515 -0.562 C 1.509 -0.562 1.5 -0.562 1.495 -0.562 L 1.48 -0.562 L 1.492 -0.51 L 1.552 -0.228 L 1.59 -0.043 L 1.63 0.138 L 1.711 0.539 L 1.742 0.691 C 1.754 0.732 1.76 0.766 1.763 0.766 C 1.763 0.766 1.763 0.766 1.763 0.766 C 1.765 0.766 1.814 0.737 1.846 0.714 C 1.993 0.611 2.102 0.449 2.143 0.282 C 2.157 0.228 2.163 0.17 2.163 0.115 C 2.163 -0.219 1.915 -0.521 1.578 -0.559",
    ],
    dots: [],
    ink: { x0: -0.003, x1: 2.439, y0: -4.32, y1: 2.52 },
  },
  bass: {
    paths: [
      "M 0.884 -1.005 C 0.907 -1.011 0.93 -1.011 0.956 -1.011 C 1.057 -1.011 1.175 -0.999 1.276 -0.979 C 1.748 -0.881 2.074 -0.562 2.134 -0.135 C 2.14 -0.089 2.143 -0.046 2.143 0 C 2.143 0.259 2.053 0.593 1.901 0.873 C 1.538 1.529 0.876 2.002 0.081 2.174 C 0.066 2.174 0.055 2.177 0.04 2.177 C 0.012 2.177 -0.003 2.16 -0.003 2.134 C -0.003 2.105 0.003 2.097 0.06 2.074 C 0.971 1.731 1.578 0.991 1.633 0.161 C 1.636 0.118 1.636 0.069 1.636 0.032 C 1.636 -0.372 1.512 -0.671 1.273 -0.821 C 1.169 -0.887 1.057 -0.919 0.936 -0.919 C 0.668 -0.919 0.395 -0.766 0.268 -0.51 C 0.262 -0.49 0.242 -0.446 0.242 -0.444 C 0.242 -0.444 0.242 -0.444 0.242 -0.444 C 0.242 -0.444 0.245 -0.446 0.253 -0.449 C 0.317 -0.49 0.386 -0.51 0.458 -0.51 C 0.559 -0.51 0.665 -0.467 0.74 -0.386 C 0.809 -0.311 0.847 -0.21 0.847 -0.118 C 0.847 0.069 0.708 0.259 0.492 0.279 C 0.478 0.279 0.464 0.282 0.449 0.282 C 0.21 0.282 0.017 0.063 0.017 -0.213 C 0.017 -0.219 0.017 -0.228 0.017 -0.23 C 0.029 -0.642 0.406 -0.979 0.884 -1.005",
      "M 2.416 -0.619 C 2.422 -0.622 2.425 -0.622 2.434 -0.622 C 2.454 -0.622 2.477 -0.619 2.483 -0.613 C 2.555 -0.593 2.589 -0.53 2.589 -0.469 C 2.589 -0.418 2.563 -0.366 2.511 -0.337 C 2.491 -0.323 2.465 -0.32 2.439 -0.32 C 2.399 -0.32 2.356 -0.337 2.327 -0.374 C 2.304 -0.403 2.292 -0.435 2.292 -0.467 C 2.292 -0.539 2.339 -0.611 2.416 -0.619",
      "M 2.416 0.323 C 2.422 0.323 2.425 0.323 2.434 0.323 C 2.454 0.323 2.477 0.325 2.483 0.331 C 2.555 0.351 2.589 0.415 2.589 0.475 C 2.589 0.527 2.563 0.579 2.511 0.605 C 2.491 0.619 2.465 0.625 2.439 0.625 C 2.399 0.625 2.356 0.605 2.327 0.57 C 2.304 0.541 2.292 0.51 2.292 0.475 C 2.292 0.403 2.339 0.334 2.416 0.323",
    ],
    dots: [],
    ink: { x0: -0.003, x1: 2.589, y0: -1.011, y1: 2.177 },
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
export function yOfStep(step: number, topLineStep: number): number {
  return (topLineStep - step) * STEP;
}

/** The key signature to draw, falling back to C major when the key is unreadable. */
export function resolveKey(musicalKey: string | null | undefined): KeySignature {
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
  minY = Math.min(minY, refY + art.ink.y0 * LINE_GAP);
  maxY = Math.max(maxY, refY + art.ink.y1 * LINE_GAP);

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
export function Sharp({ x, y, color }: { x: number; y: number; color: string }) {
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
export function Flat({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <G stroke={color} strokeWidth={1.3} fill="none" strokeLinecap="round">
      <Line x1={x + 1} y1={y - 9.5} x2={x + 1} y2={y + 4} />
      <Path d={`M${x + 1} ${y - 1} C ${x + 6} ${y - 3}, ${x + 7} ${y + 1.5}, ${x + 1} ${y + 4.5}`} />
    </G>
  );
}

/** Two offset verticals joined by two bars — the box that cancels an alteration. */
export function Natural({ x, y, color }: { x: number; y: number; color: string }) {
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

export function ClefGlyph({ clef, x, color }: { clef: Clef; x: number; color: string }) {
  const art = CLEF_ART[clef.kind];
  const refY = yOfStep(clef.refStep, clef.topLineStep);
  return (
    <G
      transform={`translate(${x}, ${refY}) scale(${LINE_GAP})`}
      // Filled, not stroked: these are real glyph outlines, so the shape *is* the
      // ink and the counters (the treble's spiral eye) are reverse-wound subpaths
      // that only read as holes under a fill.
      fill={color}
      stroke="none"
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
export function meterWidth(timeSignature: string): number {
  const [num, den] = timeSignature.split("/");
  if (!num || !den) return 0;
  return Math.max(num.length, den.length) * TS_DIGIT_W;
}

export function TimeSignature({
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
