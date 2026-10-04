/**
 * RangePicker — two thumbs on a track, choosing the section of a song to transcribe.
 *
 * Drag either thumb, or the window between them, and the times above the thumbs follow;
 * the "Selected 0:30 of 3:33" line below says how much is chosen. The rules — whole
 * seconds, at least five of them, never more than the allowance, the other thumb following
 * when one is dragged past it — live in `lib/clipRange` so they are tested once and shared
 * with the credit line. Built on PanResponder: no new native dependency.
 *
 * Gestures are created once and read the latest props through refs, the same arrangement
 * as the scrubber in `NotePlayer`, so a drag that began before a re-render keeps working.
 * The responder refuses termination requests: inside a scrolling screen, a horizontal drag
 * must not be handed to the ScrollView halfway through.
 */

import React, { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import { fonts, spacing, type Palette } from "../design/theme";
import { useThemedStyles } from "../lib/theme";
import * as haptics from "../lib/haptics";
import {
  formatClock,
  moveEnd,
  moveStart,
  moveWindow,
  selectedLabel,
  type ClipRange,
} from "../lib/clipRange";

const THUMB = 28;
const TRACK = 6;
/** Wide enough for "1:02:05" at 12px. */
const LABEL_W = 60;
/** One arrow press or screen-reader step, in seconds. */
const STEP = 5;

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

  // Labels sit centred over their thumbs (in track coordinates; the row adds half a thumb of
  // padding), kept inside the track; when the window is too
  // narrow for both, they part just enough not to overlap.
  let startLabelX = Math.max(0, Math.min(width - LABEL_W, startX - LABEL_W / 2));
  let endLabelX = Math.max(0, Math.min(width - LABEL_W, endX - LABEL_W / 2));
  const overlap = startLabelX + LABEL_W + 4 - endLabelX;
  if (overlap > 0) {
    startLabelX = Math.max(0, startLabelX - overlap / 2);
    endLabelX = Math.min(width - LABEL_W, startLabelX + LABEL_W + 4);
  }

  const nudgeStart = (delta: number) => commit(moveStart(value, value.start + delta, duration, maxSeconds));
  const nudgeEnd = (delta: number) => commit(moveEnd(value, value.end + delta, duration, maxSeconds));

  return (
    <View style={[styles.root, disabled && styles.disabled]}>
      <View style={styles.labels}>
        <Text style={[styles.label, { left: startLabelX + THUMB / 2 }]} numberOfLines={1}>{formatClock(value.start)}</Text>
        <Text style={[styles.label, { left: endLabelX + THUMB / 2 }]} numberOfLines={1}>{formatClock(value.end)}</Text>
      </View>

      <View style={styles.trackRow}>
        <View style={styles.trackArea} onLayout={onLayout}>
          <View style={styles.track} />
          {width > 0 ? (
            <>
              <View
                {...responders.window.panHandlers}
                style={[styles.window, { left: startX, width: Math.max(0, endX - startX) }]}
                accessible
                accessibilityLabel="Selected section"
                accessibilityHint="Drag to move the section along the song"
                accessibilityValue={{ text: `${formatClock(value.start)} to ${formatClock(value.end)}` }}
              >
                <View style={styles.windowFill} />
              </View>
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
                <View style={styles.thumbDot} />
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
                <View style={styles.thumbDot} />
              </View>
            </>
          ) : null}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.edge}>0:00</Text>
        <Text style={styles.selected}>{selectedLabel(value, duration)}</Text>
        <Text style={[styles.edge, { textAlign: "right" }]}>{formatClock(duration)}</Text>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { marginTop: spacing.sm },
    disabled: { opacity: 0.5 },
    labels: { height: 18, position: "relative" },
    label: {
      position: "absolute", top: 0, width: LABEL_W, textAlign: "center",
      fontFamily: fonts.medium, fontSize: 12, color: c.accent,
    },
    // The row is padded by half a thumb each side so the thumbs at 0:00 and the end stay on screen.
    trackRow: { paddingHorizontal: THUMB / 2, height: THUMB + spacing.sm, justifyContent: "center" },
    trackArea: { height: THUMB, justifyContent: "center" },
    track: { height: TRACK, borderRadius: TRACK / 2, backgroundColor: c.border },
    window: { position: "absolute", top: 0, height: THUMB, justifyContent: "center" },
    windowFill: { height: TRACK, borderRadius: TRACK / 2, backgroundColor: c.accent },
    thumb: {
      position: "absolute", top: 0, width: THUMB, height: THUMB, borderRadius: THUMB / 2,
      backgroundColor: c.surface, borderWidth: 2, borderColor: c.accent,
      alignItems: "center", justifyContent: "center",
      shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2,
    },
    thumbDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent },
    footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
    edge: { fontFamily: fonts.regular, fontSize: 11, color: c.textFaint, minWidth: 40 },
    selected: { fontFamily: fonts.semibold, fontSize: 13, color: c.text, textAlign: "center", flex: 1 },
  });
