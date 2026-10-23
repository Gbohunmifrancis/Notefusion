/**
 * A treble stave with one note on it, for Staff to solfa (board s-practice-fun/s3): the clef (the "staff" glyph's own
 * drawing, scaled so its curl wraps the G line), the key signature where a hymn book prints it, and the note — a head
 * and a stem, down from the middle line up. The key signature already sharpens or flattens the note, so it is drawn
 * plain. Lines in muted ink, the note in full ink; nothing here is a control.
 */

import React from "react";
import Svg, { Ellipse, G, Line, Path } from "react-native-svg";
import { keySignature, staffStep } from "../../lib/practiceGames";
import { useColors } from "../../lib/theme";

/** Space between two stave lines, in px. */
const GAP = 13;
const HEIGHT = GAP * 10;
/** The top line's height; the bottom line (E4) is four gaps under it. */
const TOP = GAP * 3;
const BOTTOM = TOP + GAP * 4;
const CLEF_SCALE = GAP / 3;
/** The clef's stroke in the glyph's own units, so it draws about 2 px once scaled. */
const CLEF_STROKE = 2.1 / CLEF_SCALE;

export function Stave({ noteName, fifths, width }: { noteName: string; fifths: number; width: number }) {
  const c = useColors();
  const step = staffStep(noteName);
  const yOf = (s: number) => BOTTOM - (s * GAP) / 2;
  const signs = keySignature(fifths);
  const noteX = Math.max(140, width * 0.62);

  return (
    <Svg width={width} height={HEIGHT} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2, 3, 4].map((i) => (
        <Line key={i} x1={6} x2={width - 6} y1={TOP + i * GAP} y2={TOP + i * GAP} stroke={c.textMuted} strokeWidth={1.3} />
      ))}

      {/* The clef: the 24-grid glyph, its curl (y ≈ 15) on the G line. */}
      <G transform={`translate(${2} ${yOf(2) - 15 * CLEF_SCALE}) scale(${CLEF_SCALE})`}>
        <Path d="M12.6 21.4c-1.2.9-3 .1-2.7-1.3.2-1 1.6-1.3 2.3-.5" stroke={c.text} strokeWidth={CLEF_STROKE} fill="none" strokeLinecap="round" />
        <Path
          d="M12.4 19.8 10.9 4.9c-.2-1.7 1.5-2.6 2.4-1.2 1 1.7-.6 4.4-3.3 6.8-2.5 2.2-3.1 4.7-1.7 6.5 1.5 1.9 5 1.7 6.2-.4 1.1-1.9-.2-4.2-2.4-4-1.9.2-2.9 2-2 3.4"
          stroke={c.text}
          strokeWidth={CLEF_STROKE}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>

      {signs.map((s, i) => (
        <Accidental key={i} sign={s.sign} x={70 + i * 11} y={yOf(s.step)} color={c.text} />
      ))}

      {step != null ? (
        <G>
          <Ellipse cx={noteX} cy={yOf(step)} rx={GAP * 0.66} ry={GAP * 0.47} fill={c.text} transform={`rotate(-20 ${noteX} ${yOf(step)})`} />
          {step >= 4 ? (
            <Line x1={noteX - GAP * 0.6} x2={noteX - GAP * 0.6} y1={yOf(step) + 2} y2={yOf(step) + GAP * 3.4} stroke={c.text} strokeWidth={1.8} />
          ) : (
            <Line x1={noteX + GAP * 0.6} x2={noteX + GAP * 0.6} y1={yOf(step) - 2} y2={yOf(step) - GAP * 3.4} stroke={c.text} strokeWidth={1.8} />
          )}
        </G>
      ) : null}
    </Svg>
  );
}

/** A sharp (two uprights, two thick rising bars) or a flat (an upright and its bowl), centred on its line or space. */
function Accidental({ sign, x, y, color }: { sign: "#" | "b"; x: number; y: number; color: string }) {
  if (sign === "#") {
    return (
      <G>
        <Line x1={x - 2.2} x2={x - 2.2} y1={y - GAP * 1.05} y2={y + GAP * 1.15} stroke={color} strokeWidth={1.2} />
        <Line x1={x + 2.2} x2={x + 2.2} y1={y - GAP * 1.15} y2={y + GAP * 1.05} stroke={color} strokeWidth={1.2} />
        <Line x1={x - 4.5} x2={x + 4.5} y1={y - GAP * 0.25} y2={y - GAP * 0.55} stroke={color} strokeWidth={2.6} />
        <Line x1={x - 4.5} x2={x + 4.5} y1={y + GAP * 0.55} y2={y + GAP * 0.25} stroke={color} strokeWidth={2.6} />
      </G>
    );
  }
  return (
    <G>
      <Line x1={x - 3} x2={x - 3} y1={y - GAP * 1.7} y2={y + GAP * 0.5} stroke={color} strokeWidth={1.3} />
      <Path
        d={`M${x - 3} ${y + GAP * 0.5} C ${x + 5} ${y - GAP * 0.1} ${x + 5} ${y - GAP * 0.9} ${x - 3} ${y - GAP * 0.25}`}
        stroke={color}
        strokeWidth={1.8}
        fill="none"
      />
    </G>
  );
}
