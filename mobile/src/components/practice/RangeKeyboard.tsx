/**
 * The range finder's keyboard (board c-practice/6d): whole octaves around the singer's range, the keys inside it lit,
 * each C named, and the two ends marked above.
 */

import React, { useState } from "react";
import { View } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";
import { midiName, rangeKeys } from "../../lib/practiceModes";
import { fonts } from "../../design/theme";
import { useTheme } from "../../lib/theme";

const KEY_H = 76;
const TOP = 26;

export function RangeKeyboard({ lowMidi, highMidi }: { lowMidi: number; highMidi: number }) {
  const { palette: c, mode } = useTheme();
  const dark = mode === "dark";
  const [width, setWidth] = useState(0);
  const keys = rangeKeys(lowMidi, highMidi);
  const whites = keys.filter((k) => !k.black);
  const w = whites.length > 0 ? width / whites.length : 0;
  // A black key sits over the line between the white key before it and the next.
  const whiteIndex = (midi: number) => whites.findIndex((k) => k.midi === midi);
  const xOf = (midi: number) => {
    const k = keys.find((x) => x.midi === midi);
    if (!k) return 0;
    if (!k.black) return whiteIndex(midi) * w + w / 2;
    return (whiteIndex(midi - 1) + 1) * w;
  };

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`A keyboard with ${midiName(lowMidi)} to ${midiName(highMidi)} lit`}
    >
      {width > 0 ? (
        <Svg width={width} height={TOP + KEY_H}>
          {[lowMidi, highMidi].map((m) => (
            <React.Fragment key={m}>
              <SvgText x={xOf(m)} y={12} fontSize={12} fontFamily={fonts.semibold} fill={c.text} textAnchor="middle">{midiName(m)}</SvgText>
              <Line x1={xOf(m)} x2={xOf(m)} y1={16} y2={TOP - 2} stroke={c.text} strokeWidth={1.2} />
            </React.Fragment>
          ))}
          {whites.map((k, i) => (
            <React.Fragment key={k.midi}>
              <Rect
                x={i * w + 0.5}
                y={TOP}
                width={w - 1.5}
                height={KEY_H}
                rx={3}
                fill={k.lit ? c.accentAlt : dark ? c.surfaceAlt : c.surface}
                stroke={dark ? "none" : c.border}
                strokeWidth={dark ? 0 : 1}
                opacity={k.lit ? 0.85 : 1}
              />
              {k.label ? (
                <SvgText x={i * w + w / 2} y={TOP + KEY_H - 6} fontSize={9} fontFamily={fonts.medium} fill={k.lit ? c.bg : c.textFaint} textAnchor="middle">
                  {k.label}
                </SvgText>
              ) : null}
            </React.Fragment>
          ))}
          {keys.filter((k) => k.black).map((k) => (
            <Rect key={k.midi} x={xOf(k.midi) - w * 0.32} y={TOP} width={w * 0.64} height={KEY_H * 0.6} rx={2} fill={k.lit ? c.primary : dark ? c.bg : c.text} />
          ))}
        </Svg>
      ) : (
        <View style={{ height: TOP + KEY_H }} />
      )}
    </View>
  );
}
