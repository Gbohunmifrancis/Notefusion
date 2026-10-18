/**
 * Doh on an empty state (board c-practice/8b): the bird holding a blank sheet, and a tap gives a tip — it squishes
 * and bounces (300 ms) and a bubble opens over it (200 ms) with one of the app's own pieces of advice
 * (`lib/dohTips`). Tap again for the next. The bubble closes by itself after 6 s, when the list scrolls
 * (`closeSignal` changes) or when the screen is left. Never on an error: errors stay plain words.
 */

import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { Doh } from "./Doh";
import { DOH_MS } from "../../lib/dohMotion";
import { DOH_TIPS, nextTip, tipLabel } from "../../lib/dohTips";
import { fonts, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";

/** The dashed ring that says the bird can be tapped sits this far outside it. */
const RING_GAP = 8;

export function DohTip({
  size = 132,
  active,
  closeSignal,
}: {
  size?: number;
  /** The screen is on show: Doh may idle, and leaving closes the bubble. */
  active: boolean;
  /** Changes when the list scrolls: the bubble closes. */
  closeSignal?: number;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const reduce = useReducedMotion();
  const [tip, setTip] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const shown = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    shown.value = withTiming(open ? 1 : 0, {
      duration: open ? DOH_MS.bubble : 150,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
    });
  }, [open, shown]);

  useEffect(() => setOpen(false), [closeSignal]);
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function nextOne() {
    setTip((t) => nextTip(t));
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), DOH_MS.bubbleFor);
  }

  const bubble = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: reduce ? 0 : (1 - shown.value) * 6 }, { scale: reduce ? 1 : 0.96 + 0.04 * shown.value }],
  }));

  const ring = size + 2 * RING_GAP;
  return (
    <View style={styles.wrap}>
      <Animated.View
        style={[styles.bubble, { bottom: ring + 10 }, bubble]}
        pointerEvents="none"
        accessibilityLiveRegion="polite"
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      >
        {tip !== null ? (
          <>
            <Text style={styles.eyebrow}>{tipLabel(tip)}</Text>
            <Text style={styles.tip}>{DOH_TIPS[tip]}</Text>
            <View style={styles.again}>
              <Ionicons name="hand-left-outline" size={13} color={c.textFaint} />
              <Text style={styles.againText}>Tap me again for another</Text>
            </View>
          </>
        ) : null}
        <View style={styles.pointer} />
      </Animated.View>

      <View style={{ width: ring, height: ring, alignItems: "center", justifyContent: "center" }}>
        <Svg width={ring} height={ring} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Circle cx={ring / 2} cy={ring / 2} r={ring / 2 - 1} stroke={c.accentGlow} strokeWidth={1.5} strokeDasharray="5 5" fill="none" />
        </Svg>
        <Doh pose="handoff" size={size} active={active} onPress={nextOne} accessibilityLabel="Doh. Tap for a recording tip" />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      alignSelf: "stretch",
      alignItems: "center",
    },
    bubble: {
      position: "absolute",
      width: "100%",
      maxWidth: 290,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 18,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.25,
      shadowRadius: 20,
      elevation: 8,
    },
    eyebrow: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      letterSpacing: 0.9,
      textTransform: "uppercase",
      color: c.link,
      marginBottom: 4,
    },
    tip: {
      fontFamily: fonts.medium,
      fontSize: 14.5,
      lineHeight: 21,
      color: c.text,
    },
    again: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 6,
    },
    againText: {
      fontFamily: fonts.regular,
      fontSize: 12.5,
      color: c.textFaint,
    },
    /** The bubble's point, toward the bird. */
    pointer: {
      position: "absolute",
      bottom: -7,
      alignSelf: "center",
      width: 14,
      height: 14,
      backgroundColor: c.surface,
      borderRightWidth: 1,
      borderBottomWidth: 1,
      borderColor: c.border,
      transform: [{ rotate: "45deg" }],
    },
  });
