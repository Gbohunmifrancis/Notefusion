/**
 * A run as blocks (board c-practice/6c): one row per note it uses, highest at the top, each note a block as long as
 * it lasts, so the shape reads at a glance. With `trace`, the pattern is drawn in outline and the singer's own pitch
 * line (the run grader's) goes over it.
 */

import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Polyline, Rect, Text as SvgText } from "react-native-svg";
import type { Roll } from "../../lib/practiceModes";
import { fonts, radii, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";

const ROW = 22;
const LABEL = 30;
const PAD = 10;

export function NoteRoll({
  roll,
  active = -1,
  trace,
  label,
}: {
  roll: Roll;
  /** The block sounding or due, lit. */
  active?: number;
  /** The take's line over the pattern, as fractions across and rows down. */
  trace?: readonly { x: number; y: number }[] | null;
  label: string;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [width, setWidth] = useState(0);
  const height = roll.rows.length * ROW + PAD * 2;
  const inner = Math.max(0, width - LABEL - PAD);
  const x = (f: number) => LABEL + f * inner;
  const y = (row: number) => PAD + row * ROW + ROW / 2;
  const outline = !!trace;

  return (
    <View
      style={styles.box}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          {roll.rows.map((r, i) => (
            <React.Fragment key={r.midi}>
              <Rect x={LABEL} y={PAD + i * ROW + 3} width={inner} height={ROW - 6} rx={4} fill={c.surfaceAlt} opacity={0.6} />
              <SvgText x={4} y={y(i) + 4} fontSize={12} fontFamily={fonts.medium} fill={c.textFaint}>{r.label}</SvgText>
            </React.Fragment>
          ))}
          {roll.blocks.map((b) => (
            <Rect
              key={b.index}
              x={x(b.x) + 1}
              y={PAD + b.row * ROW + 4}
              width={Math.max(6, b.w * inner - 3)}
              height={ROW - 8}
              rx={5}
              fill={outline ? "none" : b.index === active ? c.accentAlt : c.primary}
              stroke={outline ? c.textFaint : "none"}
              strokeDasharray={outline ? "3 3" : undefined}
              strokeWidth={outline ? 1.2 : 0}
            />
          ))}
          {trace && trace.length > 1 ? (
            <>
              <Polyline
                points={trace.map((p) => `${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ")}
                fill="none"
                stroke={c.link}
                strokeWidth={2.4}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <Circle cx={x(trace[trace.length - 1]!.x)} cy={y(trace[trace.length - 1]!.y)} r={4} fill={c.success} />
            </>
          ) : null}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    box: { backgroundColor: c.surface, borderRadius: radii.md, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  });
