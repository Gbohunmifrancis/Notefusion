import React, { useMemo } from "react";
import Svg, { Circle, G, Line, Rect, Text as SvgText } from "react-native-svg";
import {
  ACCIDENTAL_INK,
  ACC_GAP,
  BAR_PAD,
  CLEF_ART,
  ClefGlyph,
  Flat,
  HEAD_PAD,
  LINE_GAP,
  Natural,
  Sharp,
  SIG_PACK,
  SIG_STEP_FLAT,
  SIG_STEP_SHARP,
  STEP,
  TimeSignature,
  meterWidth,
  pickClef,
  resolveKey,
  yOfStep,
  type Clef,
} from "./StaffNotation";
import { accidentalFor, spell, type Accidental, type KeySignature } from "../lib/keySignature";
import { beatsPerBar } from "../lib/musicxml";
import { fonts, pitchColor, type PitchLetter } from "../design/theme";
import { useTheme } from "../lib/theme";
import type { NoteEvent } from "../api/types";

/**
 * PianoStaff — the piano screen's horizontal, time-proportional stave.
 *
 * `StaffNotation` lays notes out in fixed-width slots, which is right for reading
 * a phrase on a phone but wrong here: this stave scrolls under a playhead, so a
 * note's horizontal position *is* its onset and its width *is* its duration. A
 * minim reads as twice a crotchet because it is drawn twice as long, which is why
 * there are no stems, flags or beams — the chip's length is the rhythm, and a
 * stem on top of that would be the same information said twice. The chip is drawn
 * as a head plus a tail rather than one bar: the head is a constant size so the
 * syllable inside it always has room, and the tail is what carries the length.
 *
 * Everything else is borrowed rather than re-derived. The clef artwork, the
 * key-signature step tables, the accidental ink boxes and the meter come from
 * `StaffNotation` (they are exported for this one caller), and the diatonic
 * placement comes from `lib/keySignature` exactly as it does there, so a Bb in D
 * minor sits on the B line here too.
 *
 * ── Colour ────────────────────────────────────────────────────────────────────
 * A chip is filled by its *letter name* (`pitchColor`), so the chip on the stave
 * and the label on the key you have to press are the same hue — that pairing is
 * the whole point of the colour, and an accidental therefore takes its letter's
 * colour (E♭ is a green E). Since pitch has taken the fill, the PRD's honesty
 * rule moves to an outline: a note under 0.5 confidence keeps its pitch colour
 * and gains a dashed border plus a dot above it. On the correction screen — where
 * doubtful notes matter most — that is the marking the user is looking for.
 *
 * ── Who owns the scroll ───────────────────────────────────────────────────────
 * Not this component. It renders one wide `<Svg>` and reports its width through
 * `staffMetrics`, and the parent translates it: play mode animates it under a
 * fixed playhead on the Reanimated thread, correct and free mode put it in a
 * ScrollView. A ScrollView in here would fight both.
 */

// ─── Vertical model space ─────────────────────────────────────────────────────

/**
 * Diatonic steps drawn above the top line and below the bottom one — three
 * ledger lines each way. Treble covers G3…D6, which holds essentially every sung
 * melody; anything lower picks up the bass clef through `pickClef`. A note past
 * the window is clamped to the edge rather than allowed to clip out of the box,
 * and `Chip.clipped` records that so a caller could say so if it ever needs to.
 */
const WINDOW_STEPS = 5;

const TOP_LINE_Y = 0;
const BOTTOM_LINE_Y = 8 * STEP;
const WINDOW_TOP_Y = TOP_LINE_Y - WINDOW_STEPS * STEP;
const WINDOW_BOTTOM_Y = BOTTOM_LINE_Y + WINDOW_STEPS * STEP;

/**
 * Chip geometry: a head that carries the note, and a tail that carries its length.
 *
 * The head is a fixed rounded square, wide enough for a solfa syllable and its octave
 * marks at 10 pt. The tail is a thinner, lighter bar running from the head's right edge
 * to wherever the note ends, so duration is still drawn to scale — a minim's tail is
 * four times a quaver's — without a short note shrinking to a sliver its label cannot
 * sit inside, which is what a single uniform bar did to anything under a crotchet.
 *
 * Under `HEAD_W` there is no tail at all: the note is the head, and the rhythm is
 * carried by where the *next* head starts. At the screen's 96 px per beat even a
 * semiquaver clears the head, so that floor is a guard rather than a habit.
 */
const HEAD_W = 20;
/** Head height: 1½ staff spaces — tall enough to hold a syllable. */
const CHIP_H = 17;
const CHIP_RX = 5;
/** Tail: a little over half the head, centred on the note's line, and translucent. */
const TAIL_H = 8;
const TAIL_OPACITY = 0.45;
/** Air between two chips that abut, so a run of quavers reads as separate notes. */
const CHIP_GAP = 2;
/** Shorter than this and the tail is not worth drawing; the head already says where. */
const MIN_TAIL_W = 4;

/** Top of the SVG's viewBox in model space (room for a chip and its low-confidence dot). */
export const STAFF_VIEW_TOP = WINDOW_TOP_Y - 20;
/** Height of the SVG in dp. Model space is 1:1 with dp, so this is also its viewBox height. */
export const STAFF_HEIGHT = WINDOW_BOTTOM_Y + 22 - STAFF_VIEW_TOP;

/** Letter step → letter name, C=0 … B=6, matching `Spelling.letter`. */
const LETTERS: readonly PitchLetter[] = ["C", "D", "E", "F", "G", "A", "B"];

// ─── Measurement ──────────────────────────────────────────────────────────────

export interface StaffMetrics {
  clef: Clef;
  key: KeySignature;
  /** Quarter-note beats per bar ("6/8" → 3). */
  perBar: number;
  /** x where beat 0 sits. The clef, signature and meter fill everything left of it. */
  headWidth: number;
  /** Beats the stave is drawn out to: the piece, rounded up to a whole bar. */
  totalBeats: number;
  /** Full width of the `<Svg>`, head included. */
  contentWidth: number;
}

/**
 * Measures the stave without rendering it, so the parent can size its scroll,
 * place the playhead and pick a starting offset from the same numbers the
 * component draws with. The head is measured by the same left-to-right cursor
 * `StaffNotation` uses — clef ink, then signature, then meter — never guessed.
 */
export function staffMetrics(
  notes: readonly NoteEvent[],
  timeSignature: string,
  musicalKey: string | null | undefined,
  pxPerBeat: number,
  minBeats = 0,
): StaffMetrics {
  const clef = pickClef(notes);
  const key = resolveKey(musicalKey);
  const perBar = beatsPerBar(timeSignature);

  const art = CLEF_ART[clef.kind];
  let cursor = HEAD_PAD + (art.ink.x1 - art.ink.x0) * LINE_GAP;
  if (key.accidentals.length > 0) {
    cursor += HEAD_PAD;
    for (const acc of key.accidentals) cursor += ACCIDENTAL_INK[acc.kind].w + SIG_PACK;
    cursor -= SIG_PACK;
  }
  cursor += HEAD_PAD + meterWidth(timeSignature) + BAR_PAD;

  let end = minBeats;
  for (const n of notes) end = Math.max(end, n.startBeat + n.durBeats);
  const totalBeats =
    perBar > 0 ? Math.max(perBar, Math.ceil(end / perBar) * perBar) : Math.max(1, end);

  return {
    clef,
    key,
    perBar,
    headWidth: cursor,
    totalBeats,
    contentWidth: cursor + totalBeats * pxPerBeat + BAR_PAD,
  };
}

/** x of a beat on the stave, head included. The playhead and auto-scroll use this. */
export function beatToX(beat: number, metrics: StaffMetrics, pxPerBeat: number): number {
  return metrics.headWidth + beat * pxPerBeat;
}

// ─── Chip layout ──────────────────────────────────────────────────────────────

interface Chip {
  index: number;
  x: number;
  /** Total span, head plus tail: the note's duration, floored at one head. */
  w: number;
  /** Centre of the chip, model space. */
  y: number;
  letter: PitchLetter;
  solfa: string;
  low: boolean;
  accidental: Accidental | null;
  accX: number;
  ledgers: number[];
  /** The note sits outside the drawn window and has been pinned to its edge. */
  clipped: boolean;
}

function buildChips(
  notes: readonly NoteEvent[],
  metrics: StaffMetrics,
  pxPerBeat: number,
): Chip[] {
  const { clef, key, perBar } = metrics;
  const topLineStep = clef.topLineStep;
  const bottomLineStep = topLineStep - 8; // five lines span eight steps
  const minStep = bottomLineStep - WINDOW_STEPS;
  const maxStep = topLineStep + WINDOW_STEPS;

  /** Alteration each staff step has been given so far *in this bar*. */
  const barAlter = new Map<number, number>();
  let lastBar = 0;
  const chips: Chip[] = [];

  notes.forEach((n, index) => {
    // Accidentals last to the end of their bar, so a barline cancels them.
    const bar = perBar > 0 ? Math.floor(n.startBeat / perBar) : 0;
    if (bar !== lastBar) {
      barAlter.clear();
      lastBar = bar;
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

    const step = Math.max(minStep, Math.min(maxStep, sp.step));
    const x = beatToX(n.startBeat, metrics, pxPerBeat);
    const w = Math.max(HEAD_W, n.durBeats * pxPerBeat - CHIP_GAP);
    const y = yOfStep(step, topLineStep);

    // Ledgers sit on every line-position outside the staff, and lines fall on
    // even step offsets from the top line.
    const ledgers: number[] = [];
    if (step > topLineStep) {
      for (let s = topLineStep + 2; s <= step; s += 2) ledgers.push(yOfStep(s, topLineStep));
    } else if (step < bottomLineStep) {
      for (let s = bottomLineStep - 2; s >= step; s -= 2) ledgers.push(yOfStep(s, topLineStep));
    }

    chips.push({
      index,
      x,
      w,
      y,
      letter: LETTERS[sp.letter]!,
      solfa: `${n.solfa ?? ""}${n.octaveMark ?? ""}`,
      low: n.conf < 0.5,
      accidental,
      // An accidental hangs left of the chip. It cannot widen the slot the way it
      // does on a sequential stave — the chip's x is its onset and is not
      // negotiable — so it borrows the gap the previous note left instead.
      accX: x - ACC_GAP - (accidental === null ? 0 : ACCIDENTAL_INK[accidental].w),
      ledgers,
      clipped: step !== sp.step,
    });
  });

  return chips;
}

// ─── Component ────────────────────────────────────────────────────────────────

/** Judgement of one note in play mode. Mirrors the screen's PENDING / HIT / MISS. */
export const CHIP_PENDING = 0;
export const CHIP_HIT = 1;
export const CHIP_MISS = 2;

interface Props {
  notes: readonly NoteEvent[];
  /** Quarter-note beats per bar are derived from this (e.g. "6/8" → 3). */
  timeSignature: string;
  /** The key the notes are read in, e.g. "D minor". Unparseable or absent → C major. */
  musicalKey?: string | null;
  /** Horizontal scale. The parent picks it, since it also owns the scroll. */
  pxPerBeat: number;
  /** Draw at least this many beats of empty stave — free play starts with none. */
  minBeats?: number;
  /** Highlighted note in correct mode. */
  selectedIndex?: number | null;
  /** Omitted in play mode, which makes every chip untouchable. */
  onSelectNote?: (index: number) => void;
  onLongPressNote?: (index: number) => void;
  /** Play mode's per-note verdict, indexed alongside `notes`. */
  judged?: Uint8Array;
}

export function PianoStaff({
  notes,
  timeSignature,
  musicalKey,
  pxPerBeat,
  minBeats = 0,
  selectedIndex = null,
  onSelectNote,
  onLongPressNote,
  judged,
}: Props) {
  const { palette: c, mode } = useTheme();

  const metrics = useMemo(
    () => staffMetrics(notes, timeSignature, musicalKey, pxPerBeat, minBeats),
    [notes, timeSignature, musicalKey, pxPerBeat, minBeats],
  );
  const chips = useMemo(() => buildChips(notes, metrics, pxPerBeat), [notes, metrics, pxPerBeat]);

  const { clef, key, perBar, headWidth, totalBeats, contentWidth } = metrics;
  const lineColor = c.border;
  // Lighter than the notes, deliberately. The clef, key signature and meter are read
  // once on arrival and then never again, whereas the chips are read continuously — so
  // the furniture sits back and lets the colour carry the eye.
  const inkColor = c.textFaint;
  const midY = (TOP_LINE_Y + BOTTOM_LINE_Y) / 2;

  // Key signature glyphs, placed by the same cursor `staffMetrics` measured with.
  const sigGlyphs: { x: number; y: number; kind: "sharp" | "flat" }[] = [];
  {
    const art = CLEF_ART[clef.kind];
    let cursor = HEAD_PAD + (art.ink.x1 - art.ink.x0) * LINE_GAP;
    if (key.accidentals.length > 0) {
      cursor += HEAD_PAD;
      for (const acc of key.accidentals) {
        const table = acc.kind === "sharp" ? SIG_STEP_SHARP : SIG_STEP_FLAT;
        const step = table[acc.letter]! + clef.sigOffset;
        sigGlyphs.push({ x: cursor, y: yOfStep(step, clef.topLineStep), kind: acc.kind });
        cursor += ACCIDENTAL_INK[acc.kind].w + SIG_PACK;
      }
    }
  }
  const clefX = HEAD_PAD - CLEF_ART[clef.kind].ink.x0 * LINE_GAP;
  const meterX = headWidth - BAR_PAD - meterWidth(timeSignature);

  const barCount = perBar > 0 ? Math.round(totalBeats / perBar) : 0;

  return (
    <Svg
      width={contentWidth}
      height={STAFF_HEIGHT}
      viewBox={`0 ${STAFF_VIEW_TOP} ${contentWidth} ${STAFF_HEIGHT}`}
    >
      {/* Staff lines. */}
      <G stroke={lineColor} strokeWidth={1}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Line key={i} x1={0} y1={i * LINE_GAP} x2={contentWidth} y2={i * LINE_GAP} />
        ))}
      </G>

      {/* Barlines. The last is the piece's closing line and draws heavier. */}
      {Array.from({ length: barCount }, (_, i) => i + 1).map((bar) => {
        const x = headWidth + bar * perBar * pxPerBeat;
        return (
          <Line
            key={`bar-${bar}`}
            x1={x}
            y1={TOP_LINE_Y}
            x2={x}
            y2={BOTTOM_LINE_Y}
            stroke={lineColor}
            strokeWidth={bar === barCount ? 2.4 : 1}
          />
        );
      })}

      <ClefGlyph clef={clef} x={clefX} color={inkColor} />
      {sigGlyphs.map((g, i) =>
        g.kind === "sharp" ? (
          <Sharp key={`sig-${i}`} x={g.x} y={g.y} color={inkColor} />
        ) : (
          <Flat key={`sig-${i}`} x={g.x} y={g.y} color={inkColor} />
        ),
      )}
      <TimeSignature timeSignature={timeSignature} x={meterX} midY={midY} color={inkColor} />

      {/* Notes. */}
      {chips.map((chip) => {
        const verdict = judged?.[chip.index] ?? CHIP_PENDING;
        const fill = pitchColor(chip.letter, mode);
        const selected = selectedIndex === chip.index;
        const top = chip.y - CHIP_H / 2;
        const tailW = chip.w - HEAD_W;

        return (
          <G key={chip.index} opacity={verdict === CHIP_MISS ? 0.3 : 1}>
            {chip.ledgers.map((ly, i) => (
              <Line
                key={`led-${i}`}
                x1={chip.x - 3}
                y1={ly}
                x2={chip.x + HEAD_W + 3}
                y2={ly}
                stroke={lineColor}
                strokeWidth={1}
              />
            ))}

            {chip.accidental === "sharp" ? (
              <Sharp x={chip.accX} y={chip.y} color={fill} />
            ) : chip.accidental === "flat" ? (
              <Flat x={chip.accX} y={chip.y} color={fill} />
            ) : chip.accidental === "natural" ? (
              <Natural x={chip.accX} y={chip.y} color={fill} />
            ) : null}

            {/* Tail before the head, and started under it, so the head's corner covers
                the seam rather than the two rectangles meeting in a visible join. */}
            {tailW >= MIN_TAIL_W ? (
              <Rect
                x={chip.x + HEAD_W - CHIP_RX}
                y={chip.y - TAIL_H / 2}
                width={tailW + CHIP_RX}
                height={TAIL_H}
                rx={TAIL_H / 2}
                fill={fill}
                fillOpacity={TAIL_OPACITY}
              />
            ) : null}

            {/* Selection wraps the head alone. The tail is a length readout; haloing it
                too would make a semibreve one long smear instead of a marked note. */}
            {selected ? (
              <Rect
                x={chip.x - 3}
                y={top - 3}
                width={HEAD_W + 6}
                height={CHIP_H + 6}
                rx={CHIP_RX + 3}
                fill={fill}
                fillOpacity={0.28}
              />
            ) : null}

            <Rect
              x={chip.x}
              y={top}
              width={HEAD_W}
              height={CHIP_H}
              rx={CHIP_RX}
              fill={fill}
              stroke={selected ? c.text : chip.low ? c.confLow : verdict === CHIP_HIT ? c.onAccent : undefined}
              strokeWidth={selected ? 2 : chip.low ? 1.6 : verdict === CHIP_HIT ? 1.6 : 0}
              strokeDasharray={chip.low && !selected ? "3,2" : undefined}
            />

            {/* Confidence, since pitch took the fill: a dot over a doubtful note. */}
            {chip.low ? (
              <Circle cx={chip.x + HEAD_W / 2} cy={top - 7} r={2.5} fill={c.confLow} />
            ) : null}

            {/* Always inside the head — which is the point of the head being a fixed
                size, and why there is no longer a fallback label under the chip. */}
            {chip.solfa.length > 0 ? (
              <SvgText
                x={chip.x + HEAD_W / 2}
                y={chip.y + 3.4}
                fill={c.onAccent}
                fontSize={10}
                fontFamily={fonts.semibold}
                textAnchor="middle"
              >
                {chip.solfa}
              </SvgText>
            ) : null}

            {/* Touch target, generous vertically and invisible. Absent in play
                mode, where a stray tap on a falling chip should do nothing. */}
            {onSelectNote ? (
              <Rect
                x={chip.x - 4}
                y={top - 8}
                width={chip.w + 8}
                height={CHIP_H + 16}
                fill={c.text}
                fillOpacity={0}
                onPress={() => onSelectNote(chip.index)}
                onLongPress={onLongPressNote ? () => onLongPressNote(chip.index) : undefined}
              />
            ) : null}
          </G>
        );
      })}
    </Svg>
  );
}
