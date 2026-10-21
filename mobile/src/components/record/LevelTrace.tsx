import React, { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { useColors } from "../../lib/theme";

/** Faint horizontal guides the line is drawn over, like a stave seen from far off. */
const GUIDES = 4;
/** Room around the line so the head's halo is never clipped. */
const PAD = 18;

/**
 * The recording's level, drawn as one thin glowing line over faint guides — newest reading at
 * the right, where the head dot sits. It is the mic level and nothing more: the screen has no
 * live pitch, and drawing one would promise notes the server has not read yet.
 *
 * `levels` are 0..1 fractions, oldest first; `capacity` is how many fit across, so a fresh take
 * grows in from the right rather than stretching its first few readings over the whole width.
 * The head dot stays in the line's own light blue (board n-ux-low Q5b): the level is said in words
 * beside the trace, not by a colour (mint is the app's tick, amber its alert).
 */
export function LevelTrace({
  levels,
  capacity,
}: {
  levels: readonly number[];
  capacity: number;
}) {
  const c = useColors();
  const headColor = c.accentAlt;
  const [size, setSize] = useState({ w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  };

  const { w, h } = size;
  const span = h - PAD * 2;
  const right = w - PAD;
  const step = capacity > 1 ? right / (capacity - 1) : right;
  const points = levels.map((f, i) => ({
    x: right - (levels.length - 1 - i) * step,
    y: PAD + span - Math.max(0, Math.min(1, f)) * span,
  }));

  // Quadratic segments through the midpoints: a level that jumps between readings still reads
  // as a voice, not as a bar chart.
  let d = "";
  if (points.length > 1) {
    d = `M${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i].x + points[i + 1].x) / 2;
      const my = (points[i].y + points[i + 1].y) / 2;
      d += ` Q${points[i].x},${points[i].y} ${mx},${my}`;
    }
    const last = points[points.length - 1];
    d += ` L${last.x},${last.y}`;
  }
  const head = points[points.length - 1];

  return (
    <View style={styles.fill} onLayout={onLayout} pointerEvents="none">
      {w > 0 && h > 0 ? (
        <Svg width={w} height={h}>
          <Defs>
            <LinearGradient id="levelTrace" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={c.ink} stopOpacity={0.15} />
              <Stop offset="0.7" stopColor={c.accent} stopOpacity={1} />
              <Stop offset="1" stopColor={c.accentAlt} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          {Array.from({ length: GUIDES }, (_, i) => {
            const y = PAD + (span * (i + 0.5)) / GUIDES;
            return <Line key={i} x1={0} x2={w} y1={y} y2={y} stroke={c.border} strokeWidth={1} />;
          })}
          {d ? (
            <>
              {/* The glow: the same path, wide and faint, under the line itself. */}
              <Path d={d} fill="none" stroke={c.accentGlow} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
              <Path d={d} fill="none" stroke="url(#levelTrace)" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
            </>
          ) : null}
          {head ? (
            <>
              <Circle cx={head.x} cy={head.y} r={14} fill={headColor} opacity={0.22} />
              <Circle cx={head.x} cy={head.y} r={6} fill={headColor} />
            </>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: StyleSheet.absoluteFill,
});
