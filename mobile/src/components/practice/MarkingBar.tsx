import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { type Palette } from "../../design/theme";
import { useThemedStyles } from "../../lib/theme";

/** The moving segment's share of the bar, and one sweep across it. */
const SEGMENT = 0.3;
const SWEEP_MS = 1400;
/** Reduce Motion: one fade out and back, held mid-bar. */
const FADE_MS = 1200;

/**
 * The bar under a take being marked (board m-ux-medium P5a), wherever a take is marked: the drill, Sing it on Result,
 * Learn my part and the modes. Marking can take up to a minute and the server reports no progress for it, so the bar
 * is indeterminate on purpose — a filling bar would be a guess: a 30% segment in the accent slides across the full
 * width every 1.4 s, eased in and out. Transform and opacity only, on the native driver, so it ships over the air. With
 * Reduce Motion the segment stays mid-bar and fades 100% → 45% → 100% every 1.2 s. The button above it says what is
 * happening, so screen readers skip it.
 */
export function MarkingBar({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    t.setValue(0);
    const ease = Easing.inOut(Easing.ease);
    const loop = reduceMotion
      ? Animated.loop(
          Animated.sequence([
            Animated.timing(t, { toValue: 1, duration: FADE_MS / 2, easing: ease, useNativeDriver: true }),
            Animated.timing(t, { toValue: 0, duration: FADE_MS / 2, easing: ease, useNativeDriver: true }),
          ]),
        )
      : Animated.loop(Animated.timing(t, { toValue: 1, duration: SWEEP_MS, easing: ease, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, t]);

  const segment = width * SEGMENT;
  // From just off the left edge to just off the right, so it is mid-bar at its fastest.
  const motion = reduceMotion
    ? {
        opacity: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }),
        transform: [{ translateX: (width - segment) / 2 }],
      }
    : { transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-segment, width] }) }] };

  return (
    <View
      style={[styles.track, style]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {width > 0 ? <Animated.View style={[styles.segment, { width: segment }, motion]} /> : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    track: { alignSelf: "stretch", height: 4, borderRadius: 2, backgroundColor: c.surfaceAlt, overflow: "hidden" },
    segment: { position: "absolute", top: 0, left: 0, height: 4, borderRadius: 2, backgroundColor: c.accent },
  });
