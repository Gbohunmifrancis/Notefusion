import React, { useCallback, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import { fonts, type Palette } from "../../design/theme";
import { useThemedStyles } from "../../lib/theme";
import { balanceValueText, clampBalance, louderEnd, stepBalance } from "../../lib/backingSync";

/** The thumb's size; its touch is the 40 px row and 2 px either side (44). */
const THUMB = 22;
/** How often a drag re-sets the two volumes (each one re-draws the sheet around the dock). */
const LIVE_EVERY_MS = 100;

/**
 * The Solfa · Backing balance (board O1c): one slider, no numbers on screen. All the way to Solfa is the piano alone,
 * the middle mark even, all the way to Backing the band alone; the louder end's word is in the text colour. Dragged
 * like the scrubber (PanResponder, the thumb under the finger); the drag's end is what is remembered. A screen reader
 * hears "Balance, backing 40 percent" and steps it by ten.
 */
export function BalanceSlider({
  value,
  onChange,
  onCommit,
}: {
  /** 0 (the solfa alone) to 1 (the backing alone). */
  value: number;
  /** While the thumb moves. */
  onChange: (value: number) => void;
  /** Where it was let go (or a screen reader's step): the value to keep. */
  onCommit: (value: number) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const width = useRef(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = clampBalance(dragging ?? value);
  const louder = louderEnd(shown);

  const handlers = useRef({ onChange, onCommit, value });
  handlers.current = { onChange, onCommit, value };
  /** The value under the finger while it is down, for a drag taken away mid-way. */
  const held = useRef<number | null>(null);

  const at = (x: number) =>
    width.current > THUMB ? clampBalance((x - THUMB / 2) / (width.current - THUMB)) : handlers.current.value;
  /** When the volumes last followed the finger: the thumb moves every frame, the mix about ten times a second. */
  const lastLive = useRef(0);
  const move = (v: number) => {
    held.current = v;
    setDragging(v);
    const now = Date.now();
    if (now - lastLive.current >= LIVE_EVERY_MS) {
      lastLive.current = now;
      handlers.current.onChange(v);
    }
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Rehearse scrolls around it; a drag that has started keeps the finger.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => move(at(e.nativeEvent.locationX)),
      onPanResponderMove: (e) => move(at(e.nativeEvent.locationX)),
      onPanResponderRelease: (e) => {
        const v = at(e.nativeEvent.locationX);
        held.current = null;
        setDragging(null);
        handlers.current.onCommit(v);
      },
      // Taken away mid-drag (a system gesture): it stays where the finger left it.
      onPanResponderTerminate: () => {
        const v = held.current;
        held.current = null;
        setDragging(null);
        if (v !== null) handlers.current.onCommit(v);
      },
    }),
  ).current;

  const step = useCallback(
    (direction: 1 | -1) => handlers.current.onCommit(stepBalance(value, direction)),
    [value],
  );

  return (
    <View style={styles.row}>
      <Text style={[styles.end, louder === "solfa" && styles.endLoud]}>Solfa</Text>
      <View
        style={styles.rail}
        onLayout={(e) => {
          width.current = e.nativeEvent.layout.width;
        }}
        hitSlop={{ top: 2, bottom: 2 }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Balance"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100), text: balanceValueText(shown) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === "increment" ? 1 : -1)}
        {...pan.panHandlers}
      >
        <View style={styles.line} pointerEvents="none" />
        <View style={styles.mid} pointerEvents="none" />
        <View
          style={[styles.thumb, { left: `${shown * 100}%`, transform: [{ translateX: -shown * THUMB }] }]}
          pointerEvents="none"
        />
      </View>
      <Text style={[styles.end, louder === "backing" && styles.endLoud]}>Backing</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 10, height: 40 },
    end: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted },
    /** The louder end says so in the text colour. */
    endLoud: { fontFamily: fonts.semibold, color: c.text },
    rail: { flex: 1, height: 40, justifyContent: "center" },
    line: { position: "absolute", left: 0, right: 0, top: 18, height: 4, borderRadius: 2, backgroundColor: c.border },
    /** Even: the middle mark. */
    mid: {
      position: "absolute",
      left: "50%",
      top: 14,
      width: 2,
      height: 12,
      marginLeft: -1,
      borderRadius: 1,
      backgroundColor: c.textFaint,
      opacity: 0.7,
    },
    /** White on Night, ink on Day: the text colour, as the scrubber's thumb. */
    thumb: {
      position: "absolute",
      top: 9,
      width: THUMB,
      height: THUMB,
      borderRadius: THUMB / 2,
      backgroundColor: c.text,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 3,
    },
  });
