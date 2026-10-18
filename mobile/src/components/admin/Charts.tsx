import React, { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles } from "../../lib/theme";
import * as haptics from "../../lib/haptics";
import { niceMax } from "../../lib/adminFormat";

/**
 * The console's charts at phone size, drawn with react-native-svg: a tile's sparkline, the area chart with its
 * scrub (a guide line and the web's tooltip follow the finger, a light tick a day), the outcomes donut, members by
 * plan as bars, and the renewals' stacked bar. Nothing is read from colour alone: every chart has its numbers beside
 * it or a Table view.
 */

function points(values: readonly number[], w: number, h: number, pad: number, max?: number): [number, number][] {
  const top = max ?? Math.max(1, ...values);
  const dx = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => [pad + i * dx, h - pad - (v / top) * (h - pad * 2)]);
}

function linePath(p: readonly [number, number][]): string {
  return p.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
}

export function Sparkline({ values, width = 58, height = 20, color }: { values: readonly number[]; width?: number; height?: number; color?: string }) {
  const a = useAdminColors();
  const c = color ?? a.series;
  if (values.length < 2) return null;
  const p = points(values, width, height, 2);
  const line = linePath(p);
  const last = p[p.length - 1]!;
  return (
    <Svg width={width} height={height} accessible={false}>
      <Defs>
        <LinearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c} stopOpacity={0.22} />
          <Stop offset="1" stopColor={c} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={`${line}L${last[0].toFixed(1)} ${height}L${p[0]![0].toFixed(1)} ${height}Z`} fill="url(#sg)" />
      <Path d={line} fill="none" stroke={c} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={last[0]} cy={last[1]} r={2.2} fill={c} />
    </Svg>
  );
}

const LEFT = 28;
const BOTTOM = 22;
const TOP = 8;
const RIGHT = 4;

/**
 * The area chart: a daily (or weekly, monthly) series with its gridlines and three date labels. With `onScrub`, a
 * press and drag shows a guide line at the nearest point and reports it, with a light haptic tick per point.
 */
export function AreaChart({
  values,
  labels,
  height = 160,
  color,
  scrub,
  onScrub,
}: {
  values: readonly number[];
  /** First, middle and last labels under the chart. */
  labels: readonly [string, string, string];
  height?: number;
  color?: string;
  /** The point the finger is on, held by the caller (the tooltip is theirs to draw). */
  scrub?: number | null;
  onScrub?: (index: number | null) => void;
}) {
  const a = useAdminColors();
  const c = color ?? a.series;
  const [width, setWidth] = useState(0);
  const last = useRef<number | null>(null);

  const max = niceMax(Math.max(0, ...values));
  const iw = Math.max(1, width - LEFT - RIGHT);
  const ih = height - BOTTOM - TOP;
  const p = useMemo(
    () => values.map((v, i) => [LEFT + (values.length > 1 ? (i * iw) / (values.length - 1) : iw / 2), TOP + ih - (v / max) * ih] as [number, number]),
    [values, iw, ih, max],
  );

  const pick = (x: number) => {
    if (!values.length) return;
    const i = Math.max(0, Math.min(values.length - 1, Math.round(((x - LEFT) / iw) * (values.length - 1))));
    if (i !== last.current) {
      last.current = i;
      haptics.play("light");
      onScrub?.(i);
    }
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => Boolean(onScrub),
        onMoveShouldSetPanResponder: (_, g) => Boolean(onScrub) && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => pick(e.nativeEvent.locationX),
        onPanResponderMove: (e) => pick(e.nativeEvent.locationX),
        onPanResponderRelease: () => {
          last.current = null;
        },
      }),
    [onScrub, iw, values.length],
  );

  const ticks = [0, max / 2, max];
  const line = linePath(p);
  const guide = scrub !== null && scrub !== undefined ? p[scrub] : undefined;

  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ height }} {...responder.panHandlers}>
      {width > 0 && p.length > 1 ? (
        <Svg width={width} height={height} accessible={false}>
          <Defs>
            <LinearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0.05" stopColor={c} stopOpacity={0.18} />
              <Stop offset="0.95" stopColor={c} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {ticks.map((t) => {
            const y = TOP + ih - (t / max) * ih;
            return (
              <React.Fragment key={t}>
                <Line x1={LEFT} x2={width - RIGHT} y1={y} y2={y} stroke={a.grid} strokeDasharray="3 3" />
                <SvgText x={LEFT - 6} y={y + 3.5} fontSize={10.5} fill={a.tick} textAnchor="end" fontFamily={fonts.regular}>
                  {String(Math.round(t))}
                </SvgText>
              </React.Fragment>
            );
          })}
          {labels.map((l, i) => (
            <SvgText
              key={i}
              x={i === 0 ? LEFT : i === 2 ? width - RIGHT : LEFT + iw / 2}
              y={height - 5}
              fontSize={10.5}
              fill={a.tick}
              textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
              fontFamily={fonts.regular}
            >
              {l}
            </SvgText>
          ))}
          <Path d={`${line}L${p[p.length - 1]![0].toFixed(1)} ${TOP + ih}L${LEFT} ${TOP + ih}Z`} fill="url(#ag)" />
          <Path d={line} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" />
          {guide ? (
            <>
              <Line x1={guide[0]} x2={guide[0]} y1={TOP} y2={TOP + ih} stroke={a.faint} strokeWidth={1} />
              <Circle cx={guide[0]} cy={guide[1]} r={4.5} fill={c} stroke={a.card} strokeWidth={2} />
            </>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

/** The tooltip over a scrubbed chart: the day and its figure, as the web's. */
export function ChartTip({ title, line }: { title: string; line: string }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  return (
    <View style={s.tip}>
      <Text style={s.tipTitle}>{title}</Text>
      <View style={s.tipRow}>
        <View style={[s.tipDot, { backgroundColor: a.series }]} />
        <Text style={s.tipLine}>{line}</Text>
      </View>
    </View>
  );
}

/** The outcomes donut, its total in the middle. */
export function Donut({
  parts,
  size = 112,
  thickness = 11,
  total,
  label,
}: {
  parts: readonly { value: number; color: string }[];
  size?: number;
  thickness?: number;
  total: string;
  label: string;
}) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const sum = parts.reduce((n, p) => n + p.value, 0) || 1;
  let offset = 0;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }} accessible={false}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={a.sub} strokeWidth={thickness} />
        {parts.map((p, i) => {
          const len = Math.max(0, (p.value / sum) * C - (p.value > 0 ? 2 : 0));
          const el = (
            <Circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={p.color}
              strokeWidth={thickness}
              strokeDasharray={`${len.toFixed(1)} ${C.toFixed(1)}`}
              strokeDashoffset={(-offset).toFixed(1)}
            />
          );
          offset += (p.value / sum) * C;
          return el;
        })}
      </Svg>
      <View style={[StyleSheet.absoluteFill, s.donutMid]}>
        <Text style={s.donutTotal}>{total}</Text>
        <Text style={s.donutLabel}>{label}</Text>
      </View>
    </View>
  );
}

/** Horizontal bars with their counts (members by plan). */
export function Bars({ rows }: { rows: readonly { label: string; value: number; color: string }[] }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  // Each bar is its share of the whole (24 of 46 members fills half the track), as on the web.
  const sum = Math.max(1, rows.reduce((n, r) => n + r.value, 0));
  return (
    <View>
      {rows.map((r) => (
        <View key={r.label} style={s.bar}>
          <Text style={s.barLabel} numberOfLines={1}>
            {r.label}
          </Text>
          <View style={[s.barTrack, { backgroundColor: a.sub }]}>
            <View style={[s.barFill, { width: `${Math.max(r.value > 0 ? 2 : 0, Math.round((r.value / sum) * 100))}%`, backgroundColor: r.color }]} />
          </View>
          <Text style={s.barValue}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

/** One bar split by part (what happened at each due end), and its legend with counts and shares. */
export function StackBar({ parts }: { parts: readonly { label: string; value: number; color: string }[] }) {
  const s = useAdminStyles(makeStyles);
  const sum = parts.reduce((n, p) => n + p.value, 0);
  return (
    <View>
      <View style={s.stack}>
        {parts.map((p) =>
          p.value > 0 ? <View key={p.label} style={{ flex: p.value, backgroundColor: p.color }} /> : null,
        )}
        {sum === 0 ? <View style={{ flex: 1 }} /> : null}
      </View>
      {parts.map((p) => (
        <View key={p.label} style={s.legend}>
          <View style={[s.legendKey, { backgroundColor: p.color }]} />
          <Text style={s.legendLabel}>{p.label}</Text>
          <Text style={s.legendValue}>{p.value}</Text>
          <Text style={s.legendPct}>{sum ? `${Math.round((p.value / sum) * 100)}%` : "–"}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    tip: {
      position: "absolute",
      top: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: a.card,
      borderWidth: 1,
      borderColor: a.line,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    tipTitle: { fontFamily: fonts.semibold, fontSize: 13, color: a.text },
    tipRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
    tipDot: { width: 7, height: 7, borderRadius: 4 },
    tipLine: { fontFamily: fonts.regular, fontSize: 13, color: a.muted },
    donutMid: { alignItems: "center", justifyContent: "center" },
    donutTotal: { fontFamily: fonts.semibold, fontSize: 20, color: a.text, letterSpacing: -0.4, fontVariant: ["tabular-nums"] },
    donutLabel: { fontFamily: fonts.regular, fontSize: 11, color: a.muted, marginTop: 2 },
    bar: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
    barLabel: { width: 96, fontFamily: fonts.regular, fontSize: 13.5, color: a.text },
    barTrack: { flex: 1, height: 8, borderRadius: 4, overflow: "hidden" },
    barFill: { height: 8, borderRadius: 4 },
    barValue: { width: 28, textAlign: "right", fontFamily: fonts.regular, fontSize: 13.5, color: a.muted, fontVariant: ["tabular-nums"] },
    stack: { flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", gap: 2, backgroundColor: a.sub, marginBottom: 12 },
    legend: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 6 },
    legendKey: { width: 10, height: 10, borderRadius: 2 },
    legendLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, color: a.text },
    legendValue: { fontFamily: fonts.medium, fontSize: 13.5, color: a.text, fontVariant: ["tabular-nums"] },
    legendPct: { width: 40, textAlign: "right", fontFamily: fonts.regular, fontSize: 13.5, color: a.muted, fontVariant: ["tabular-nums"] },
  });
