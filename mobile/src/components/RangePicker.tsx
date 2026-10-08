/**
 * RangePicker — a window over a song's waveform, choosing the section to transcribe.
 *
 * Drag either handle, or the window between them; the screen above says the times. The
 * bars are decorative (the song's audio is never fetched before the job, so there is no
 * real waveform to draw) — they give the drag something to read against, and the bars
 * inside the window light up. The rules — whole seconds, at least five of them, never
 * more than the allowance, the other handle following when one is dragged past it — live
 * in `lib/clipRange` so they are tested once and shared with the credit line. Built on
 * PanResponder: no new native dependency.
 *
 * Gestures are created once and read the latest props through refs, the same arrangement
 * as the scrubber in `NotePlayer`, so a drag that began before a re-render keeps working.
 * The responder refuses termination requests: inside a scrolling screen, a horizontal drag
 * must not be handed to the ScrollView halfway through.
 */

import React, { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import { nightFonts, spacing, type Palette } from "../design/theme";
import { useThemedStyles } from "../lib/theme";
import * as haptics from "../lib/haptics";
import { formatClock, moveEnd, moveStart, moveWindow, type ClipRange } from "../lib/clipRange";

/** Touch width of a handle; the visible grip inside it is narrower. */
const THUMB = 28;
const WAVE_H = 56;
/** How far the window's frame stands proud of the bars, above and below. */
const FRAME_OUT = 4;
/** One arrow press or screen-reader step, in seconds. */
const STEP = 5;

/**
 * Bar heights as fractions of the waveform's height: fixed, so the picture holds still
 * while a handle moves. A cheap hash of the index, smoothed with its neighbour so it
 * reads as sound rather than noise.
 */
const BARS = (() => {
  const raw = Array.from({ length: 58 }, (_, i) => {
    const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
    return x - Math.floor(x);
  });
  return raw.map((v, i) => 0.18 + 0.78 * (0.6 * v + 0.4 * (raw[i - 1] ?? v)));
})();

interface Props {
  /** The whole song's length, in seconds. */
  duration: number;
  /** The longest section this account may take, in seconds. */
  maxSeconds: number;
  value: ClipRange;
  onChange: (next: ClipRange) => void;
  disabled?: boolean;
}

export function RangePicker({ duration, maxSeconds, value, onChange, disabled = false }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [width, setWidth] = useState(0);

  // Refs mirror props so the responders, created once below, always read fresh values.
  const valueRef = useRef(value);
  const widthRef = useRef(width);
  const durationRef = useRef(duration);
  const maxRef = useRef(maxSeconds);
  const disabledRef = useRef(disabled);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  widthRef.current = width;
  durationRef.current = duration;
  maxRef.current = maxSeconds;
  disabledRef.current = disabled;
  onChangeRef.current = onChange;

  /** Where the gesture started, so each move is measured from the original position. */
  const originRef = useRef<ClipRange>(value);

  const commit = (next: ClipRange) => {
    const cur = valueRef.current;
    if (next.start !== cur.start || next.end !== cur.end) onChangeRef.current(next);
  };

  const responders = useMemo(() => {
    const secondsPerPx = () => (widthRef.current > 0 ? durationRef.current / widthRef.current : 0);
    const make = (apply: (origin: ClipRange, deltaSec: number) => ClipRange) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabledRef.current,
        onMoveShouldSetPanResponder: () => !disabledRef.current,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          originRef.current = valueRef.current;
          haptics.play("light");
        },
        onPanResponderMove: (_evt, g) => {
          commit(apply(originRef.current, g.dx * secondsPerPx()));
        },
        onPanResponderRelease: () => haptics.play("light"),
      });
    return {
      start: make((o, d) => moveStart(o, o.start + d, durationRef.current, maxRef.current)),
      end: make((o, d) => moveEnd(o, o.end + d, durationRef.current, maxRef.current)),
      window: make((o, d) => moveWindow(o, o.start + d, durationRef.current)),
    };
  }, []);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const px = (sec: number) => (duration > 0 && width > 0 ? (sec / duration) * width : 0);
  const startX = px(value.start);
  const endX = px(value.end);

  const nudgeStart = (delta: number) => commit(moveStart(value, value.start + delta, duration, maxSeconds));
  const nudgeEnd = (delta: number) => commit(moveEnd(value, value.end + delta, duration, maxSeconds));

  return (
    <View style={[styles.root, disabled && styles.disabled]}>
      <View style={styles.trackRow}>
        <View style={styles.trackArea} onLayout={onLayout}>
          <View style={styles.wave} pointerEvents="none">
            {BARS.map((h, i) => {
              const mid = ((i + 0.5) / BARS.length) * width;
              const on = width > 0 && mid >= startX && mid <= endX;
              return <View key={i} style={[styles.bar, on ? styles.barOn : styles.barOff, { height: h * WAVE_H }]} />;
            })}
          </View>
          {width > 0 ? (
            <>
              <View
                {...responders.window.panHandlers}
                style={[styles.window, { left: startX, width: Math.max(0, endX - startX) }]}
                accessible
                accessibilityLabel="Selected section"
                accessibilityHint="Drag to move the section along the song"
                accessibilityValue={{ text: `${formatClock(value.start)} to ${formatClock(value.end)}` }}
              />
              <View
                {...responders.start.panHandlers}
                style={[styles.thumb, { left: startX - THUMB / 2 }]}
                hitSlop={10}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel="Start of section"
                accessibilityValue={{ text: formatClock(value.start) }}
                accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                onAccessibilityAction={(e) => nudgeStart(e.nativeEvent.actionName === "increment" ? STEP : -STEP)}
              >
                <View style={styles.grip} />
              </View>
              <View
                {...responders.end.panHandlers}
                style={[styles.thumb, { left: endX - THUMB / 2 }]}
                hitSlop={10}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel="End of section"
                accessibilityValue={{ text: formatClock(value.end) }}
                accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                onAccessibilityAction={(e) => nudgeEnd(e.nativeEvent.actionName === "increment" ? STEP : -STEP)}
              >
                <View style={styles.grip} />
              </View>
            </>
          ) : null}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.edge}>0:00</Text>
        <Text style={styles.edge}>{formatClock(duration)}</Text>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { marginTop: spacing.md },
    disabled: { opacity: 0.5 },
    // The row is padded by half a handle each side so the handles at 0:00 and the end stay on screen.
    trackRow: { paddingHorizontal: THUMB / 2, paddingVertical: FRAME_OUT },
    trackArea: { height: WAVE_H, justifyContent: "center" },
    wave: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flexDirection: "row", alignItems: "center", gap: 2 },
    bar: { flex: 1, borderRadius: 2 },
    barOff: { backgroundColor: c.textFaint, opacity: 0.45 },
    barOn: { backgroundColor: c.accentAlt },
    window: {
      position: "absolute", top: -FRAME_OUT, height: WAVE_H + FRAME_OUT * 2,
      borderRadius: 10, borderWidth: 2, borderColor: c.text, backgroundColor: c.accentSoft,
    },
    thumb: {
      position: "absolute", top: -FRAME_OUT, width: THUMB, height: WAVE_H + FRAME_OUT * 2,
      alignItems: "center", justifyContent: "center",
    },
    grip: { width: 12, height: 30, borderRadius: 5, backgroundColor: c.text },
    footer: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs, paddingHorizontal: THUMB / 2 },
    edge: { fontFamily: nightFonts.mono, fontSize: 11, color: c.textFaint },
  });
