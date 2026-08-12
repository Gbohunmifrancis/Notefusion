import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, {
  Ellipse,
  G,
  Line,
  Path,
  Circle,
} from "react-native-svg";
import { confidenceColor, fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { NoteEvent } from "../api/types";

/**
 * StaffNotation — a real five-line stave rendered from the transcribed note list.
 *
 * The MusicXML export (see lib/export) hands a fully engraved score to
 * MuseScore/Sibelius; this component is the *in-app* view, so a user sees the
 * notes on a stave without leaving NoteFusion. It is a faithful placement — not
 * a full engraver — so it draws heads, stems, flags, ledger lines, accidentals
 * and barlines, but it does not beam runs of quavers together or lay notes out
 * proportionally to their duration. Proportional engraving is what the export is
 * for; on a phone, even sequential spacing reads more clearly.
 *
 * Placement is diatonic, not chromatic: C and C# share a staff line (C# is C with
 * a sharp), so a MIDI pitch is first resolved to a letter + octave + accidental,
 * then to a vertical step. Sharp spelling matches the ascending convention the
 * solfa engine already uses (lib/solfa ASCENDING_SYLLABLES), so the stave and the
 * syllables never disagree about how a black key is named.
 *
 * PRD honesty rule: each note head is tinted by its own confidence (green / amber
 * / red), so a low-confidence note is as visible on the stave as it is in the grid.
 */

interface Props {
  notes: readonly NoteEvent[];
  /** Quarter-note beats per bar are derived from this (e.g. "6/8" → 3). */
  timeSignature: string;
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
/** Width reserved for the clef at the far left. */
const CLEF_W = 30;
/** Width of the time-signature column after the clef. */
const TS_W = 18;
/** Padding after a barline before the next bar's first note. */
const BAR_PAD = 10;

/** Letter-step (C=0 … B=6) and sharp flag for each pitch class, sharp convention. */
const PC_LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] as const;
const PC_SHARP = [
  false, true, false, true, false, false, true, false, true, false, true, false,
] as const;

/** Absolute diatonic step of a MIDI pitch: octave*7 + letter. C4 (MIDI 60) → 28. */
function diatonicStep(midi: number): { step: number; sharp: boolean } {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1; // MIDI 60 → C4
  return { step: octave * 7 + PC_LETTER[pc]!, sharp: PC_SHARP[pc]! };
}

/** Quarter-note beats per bar. "6/8" → 3 (six eighths = three quarters). Falls back to 4. */
function beatsPerBar(timeSignature: string): number {
  const [num, den] = timeSignature.split("/").map(Number);
  if (!num || !den) return 4;
  return (num * 4) / den;
}

interface Clef {
  /** Absolute diatonic step sitting on the top staff line. */
  topLineStep: number;
  kind: "treble" | "bass";
}

/** Treble unless the melody's median sits well below the treble staff. */
function pickClef(notes: readonly NoteEvent[]): Clef {
  if (notes.length === 0) return { topLineStep: 38, kind: "treble" };
  const sorted = [...notes].map((n) => n.pitchMidi).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  // Below the C below middle C (MIDI 48) the treble staff needs too many ledger
  // lines to read; drop to bass. Top line: treble F5 → step 38, bass A3 → step 26.
  return median < 52 ? { topLineStep: 26, kind: "bass" } : { topLineStep: 38, kind: "treble" };
}

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

export function StaffNotation({ notes, timeSignature, colorByConfidence = true }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const model = useMemo(
    () => buildModel(notes, timeSignature),
    [notes, timeSignature],
  );

  if (notes.length === 0 || model === null) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.empty}>No notes to place on a stave.</Text>
      </View>
    );
  }

  const { clef, columns, contentWidth, minY, maxY, barlines } = model;
  const height = maxY - minY;
  // A left-anchored translate lets ledger lines above the top line have negative
  // model-space y and still render inside the SVG box.
  const shift = -minY;

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
        <Svg width={contentWidth} height={height} viewBox={`0 ${minY} ${contentWidth} ${height}`}>
          {/* Five staff lines, spanning the full content width. */}
          <G stroke={lineColor} strokeWidth={1}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Line key={i} x1={0} y1={staffLineY(i)} x2={contentWidth} y2={staffLineY(i)} />
            ))}
          </G>

          {/* Clef. */}
          {clef.kind === "treble" ? (
            <TrebleClef y={staffLineY(4)} color={inkColor} />
          ) : (
            <BassClef y={staffLineY(0)} color={inkColor} />
          )}

          {/* Time signature, stacked after the clef. */}
          <TimeSignature
            timeSignature={timeSignature}
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
                sharp={col.sharp}
                stemDown={col.y < (staffLineY(0) + staffLineY(4)) / 2}
                ledgers={col.ledgers}
                topLineY={staffLineY(0)}
                bottomLineY={staffLineY(4)}
                color={head}
                inkColor={inkColor}
              />
            );
          })}
          {/* `shift` is folded into the viewBox min-y above; kept for clarity. */}
          {shift ? null : null}
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
  sharp: boolean;
  conf: number;
  ledgers: number[]; // model-space y of each ledger line for this note
}

interface Model {
  clef: Clef;
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

function buildModel(notes: readonly NoteEvent[], timeSignature: string): Model | null {
  if (notes.length === 0) return null;

  const clef = pickClef(notes);
  const perBar = beatsPerBar(timeSignature);
  const startX = CLEF_W + TS_W + BAR_PAD;

  const columns: Column[] = [];
  const barlines: number[] = [];
  let x = startX;
  let lastBar = 0;

  const bottomLineStep = clef.topLineStep - 8; // 5 lines span 8 steps
  const topLineStep = clef.topLineStep;

  for (const n of notes) {
    // Insert a barline whenever the note crosses into a new bar.
    const bar = perBar > 0 ? Math.floor(n.startBeat / perBar) : 0;
    if (bar > lastBar) {
      barlines.push(x - BAR_PAD / 2);
      x += BAR_PAD;
      lastBar = bar;
    }

    const { step, sharp } = diatonicStep(n.pitchMidi);
    const y = yOfStep(step, clef.topLineStep);

    // Ledger lines sit on every line-position (even step offset from a line)
    // outside the staff. Lines fall on steps topLineStep, topLineStep-2, … .
    const ledgers: number[] = [];
    if (step > topLineStep) {
      for (let s = topLineStep + 2; s <= step; s += 2) ledgers.push(yOfStep(s, clef.topLineStep));
    } else if (step < bottomLineStep) {
      for (let s = bottomLineStep - 2; s >= step; s -= 2) ledgers.push(yOfStep(s, clef.topLineStep));
    }

    columns.push({ x, y, glyph: glyphFor(n.durBeats), sharp, conf: n.conf, ledgers });
    x += NOTE_W;
  }

  // A trailing final barline closes the last bar.
  const finalBarX = x - NOTE_W + NOTE_W * 0.7;
  barlines.push(finalBarX);
  const contentWidth = finalBarX + BAR_PAD;

  // Vertical extent: every head, stem end, ledger, and staff line, plus a margin
  // so nothing clips. Stems can go either way, so account for both.
  const midY = (yOfStep(topLineStep, clef.topLineStep) + yOfStep(bottomLineStep, clef.topLineStep)) / 2;
  let minY = yOfStep(topLineStep, clef.topLineStep);
  let maxY = yOfStep(bottomLineStep, clef.topLineStep);
  for (const col of columns) {
    const stemDown = col.y < midY;
    const stemEnd = stemDown ? col.y + STEM : col.y - STEM;
    minY = Math.min(minY, col.y - HEAD_RY, stemEnd, ...col.ledgers);
    maxY = Math.max(maxY, col.y + HEAD_RY, stemEnd, ...col.ledgers);
  }
  const MARGIN = 10;
  minY -= MARGIN;
  maxY += MARGIN;

  return { clef, columns, barlines, contentWidth, minY, maxY };
}

// ─── Note glyph ───────────────────────────────────────────────────────────────

function NoteGlyph({
  x,
  y,
  glyph,
  sharp,
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
  sharp: boolean;
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
      {sharp && <Sharp x={x - 13} y={y} color={inkColor} />}

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

      {/* Flags — bend away from the stem. */}
      {glyph.flags > 0 &&
        Array.from({ length: glyph.flags }).map((_, i) => {
          const fy = stemEnd + (stemDown ? -1 : 1) * i * 6;
          const d = stemDown
            ? `M${stemX} ${fy} c -7 3, -9 9, -5 15`
            : `M${stemX} ${fy} c 7 3, 9 9, 5 15`;
          return <Path key={i} d={d} stroke={color} strokeWidth={1.6} fill="none" />;
        })}
    </G>
  );
}

/** A compact sharp: two verticals crossed by two slightly-rising bars. */
function Sharp({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <G stroke={color} strokeWidth={1.1}>
      <Line x1={x} y1={y - 5} x2={x} y2={y + 6} />
      <Line x1={x + 3.5} y1={y - 6} x2={x + 3.5} y2={y + 5} />
      <Line x1={x - 2} y1={y - 1.5} x2={x + 5.5} y2={y - 3} strokeWidth={1.6} />
      <Line x1={x - 2} y1={y + 3} x2={x + 5.5} y2={y + 1.5} strokeWidth={1.6} />
    </G>
  );
}

// ─── Clefs (drawn, so they recolour for dark mode and stay crisp when scaled) ──

/** G clef, spiral centred on the second line from the bottom (the G line). `y` = bottom line. */
function TrebleClef({ y, color }: { y: number; color: string }) {
  // The StaffRibbon G-clef, anchored so its curl wraps the G line (y - LINE_GAP*3).
  const gLine = y - LINE_GAP * 3; // fourth line up = G4
  const cx = 15;
  return (
    <G
      stroke={color}
      strokeWidth={2.2}
      fill="none"
      strokeLinecap="round"
      transform={`translate(${cx - 24}, ${gLine - 47})`}
    >
      <Path d="M24 74 c -9 -3 -11 -14 -3 -19 c 9 -6 19 2 19 12 c 0 14 -14 22 -20 30" />
      <Path d="M20 97 c 9 -14 21 -22 21 -40 c 0 -16 -6 -30 -13 -30 c -6 0 -9 8 -8 17 c 1 12 8 22 14 30" />
    </G>
  );
}

/** F clef, the two dots straddling the F line (fourth line up). `y` = top line. */
function BassClef({ y, color }: { y: number; color: string }) {
  const fLine = y + LINE_GAP; // second line down from the top = F3
  const cx = 12;
  return (
    <G stroke={color} fill={color}>
      {/* Comma-hook body. */}
      <Path
        d={`M${cx} ${fLine - 6} c 6 -4 13 0 13 8 c 0 12 -12 18 -20 22`}
        stroke={color}
        strokeWidth={2.4}
        fill="none"
        strokeLinecap="round"
      />
      <Circle cx={cx + 18} cy={fLine - 4} r={1.6} />
      <Circle cx={cx + 18} cy={fLine + 4} r={1.6} />
    </G>
  );
}

// ─── Time signature ─────────────────────────────────────────────────────────

function TimeSignature({
  timeSignature,
  midY,
  color,
}: {
  timeSignature: string;
  midY: number;
  color: string;
}) {
  const [num, den] = timeSignature.split("/");
  if (!num || !den) return null;
  const x = CLEF_W - 2;
  // Two stacked digits, upper and lower halves of the staff.
  return (
    <>
      <StackDigit text={num} x={x} y={midY - LINE_GAP} color={color} />
      <StackDigit text={den} x={x} y={midY + LINE_GAP} color={color} />
    </>
  );
}

/** A time-signature digit drawn as a small filled path is overkill; use vector strokes. */
function StackDigit({ text, x, y, color }: { text: string; x: number; y: number; color: string }) {
  // Rendered with react-native-svg's own Text would need a numeric font baseline
  // that differs across platforms; instead the digit is drawn as a rounded block.
  // For the common meters (2,3,4,6,8) a simple bold glyph reads fine.
  return <SvgDigit text={text} cx={x} cy={y} color={color} />;
}

/** Minimal 7-segment-ish digit renderer for 0-9 using strokes. Good enough for meters. */
function SvgDigit({ text, cx, cy, color }: { text: string; cx: number; cy: number; color: string }) {
  const w = 7;
  const h = 9;
  const l = cx;
  const r = cx + w;
  const t = cy - h / 2;
  const m = cy;
  const b = cy + h / 2;
  const seg: Record<string, string[]> = {
    "0": ["tl", "tr", "rt", "rb", "bl", "br", "lt", "lb"],
    "1": ["rt", "rb"],
    "2": ["tl", "tr", "rt", "mid", "lb", "bl", "br"],
    "3": ["tl", "tr", "rt", "mid", "rb", "bl", "br"],
    "4": ["lt", "rt", "mid", "rb"],
    "5": ["tl", "tr", "lt", "mid", "rb", "bl", "br"],
    "6": ["tl", "tr", "lt", "mid", "rb", "lb", "bl", "br"],
    "7": ["tl", "tr", "rt", "rb"],
    "8": ["tl", "tr", "rt", "rb", "mid", "lt", "lb", "bl", "br"],
    "9": ["tl", "tr", "rt", "rb", "mid", "lt", "br", "bl"],
  };
  const lines: Record<string, [number, number, number, number]> = {
    tl: [l, t, cx + w / 2, t],
    tr: [cx + w / 2, t, r, t],
    lt: [l, t, l, m],
    lb: [l, m, l, b],
    rt: [r, t, r, m],
    rb: [r, m, r, b],
    mid: [l, m, r, m],
    bl: [l, b, cx + w / 2, b],
    br: [cx + w / 2, b, r, b],
  };
  const segs = seg[text] ?? [];
  return (
    <G stroke={color} strokeWidth={1.8} strokeLinecap="round">
      {segs.map((s, i) => {
        const c = lines[s]!;
        return <Line key={i} x1={c[0]} y1={c[1]} x2={c[2]} y2={c[3]} />;
      })}
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
