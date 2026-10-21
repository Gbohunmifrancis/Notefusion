import React, { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { fonts, type Palette } from "../design/theme";
import { useThemedStyles } from "../lib/theme";
import { railGeometry, railIndexAt } from "../lib/letterIndex";
import * as haptics from "../lib/haptics";

/** The strip's width: one long target down the screen's edge, not a row of small ones. */
export const RAIL_WIDTH = 28;
/** A letter's slot at most; a short screen shares its height out smaller. */
const MAX_SLOT = 18;

/**
 * A letter rail (board n-ux-low Q4l): the letters that have something under them, 12 px in link blue, down a 28 px
 * strip. A tap or a drag anywhere on the strip picks the letter under the finger, and `onPick` is told each new one
 * (a light tick each time). A screen reader moves it a letter at a time (swipe up or down) and hears which. JS only:
 * a PanResponder over the strip.
 */
export function LetterRail({
  letters,
  onPick,
  style,
}: {
  letters: readonly string[];
  onPick: (index: number) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  const [height, setHeight] = useState(0);
  const geometry = railGeometry(height, letters.length, MAX_SLOT);
  /** The letter a screen reader is on, and the last one a finger picked. */
  const [current, setCurrent] = useState(0);

  // The responder is made once; what it reads changes, so it reads it through a ref.
  const live = useRef({ geometry, count: letters.length, onPick, last: -1, top: 0 });
  live.current.geometry = geometry;
  live.current.count = letters.length;
  live.current.onPick = onPick;

  const responder = useMemo(() => {
    const pick = (y: number) => {
      const r = live.current;
      const i = railIndexAt(y, r.geometry, r.count);
      if (i === r.last) return;
      r.last = i;
      haptics.play("light");
      setCurrent(i);
      r.onPick(i);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // A drag down the rail is the rail's, not the list's scroll.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        // The strip's top on the screen, from the touch that started on it (its letters take no touches).
        live.current.top = e.nativeEvent.pageY - e.nativeEvent.locationY;
        live.current.last = -1;
        pick(e.nativeEvent.locationY);
      },
      onPanResponderMove: (_e, g) => pick(g.moveY - live.current.top),
      onPanResponderRelease: () => {
        live.current.last = -1;
      },
      onPanResponderTerminate: () => {
        live.current.last = -1;
      },
    });
  }, []);

  function step(by: number) {
    const i = Math.max(0, Math.min(letters.length - 1, current + by));
    if (i === current) return;
    setCurrent(i);
    onPick(i);
  }

  return (
    <View
      style={[styles.rail, style]}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Jump to a letter"
      accessibilityValue={{ text: letters[current] ?? "" }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === "increment" ? 1 : -1)}
      {...responder.panHandlers}
    >
      <View pointerEvents="none" style={[styles.letters, { paddingTop: geometry.top }]}>
        {letters.map((l) => (
          <View key={l} style={[styles.slot, { height: geometry.slot }]}>
            <Text style={styles.letter} allowFontScaling={false} numberOfLines={1}>
              {l}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    rail: { width: RAIL_WIDTH },
    letters: { flex: 1 },
    slot: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
    // A strip of index letters: they keep their 12 px with large text, as the strip's height is fixed.
    letter: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 14, color: c.link },
  });
