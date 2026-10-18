import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, spacing, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";

/** How long a toast stays, entrance to exit. */
export const TOAST_MS = 2500;
const IN_MS = 220;
const OUT_MS = 180;
/** It rises this far as it arrives. */
const RISE = 16;
/**
 * The floating tab bar's height (`navigation/TabNavigator`), so the toast clears it by 16 px.
 * On a screen without the bar it sits at the same height, which keeps it off a player dock too.
 */
const TAB_BAR = 64;

/**
 * One toast (board 7c): a mint tick and a few words, centred above the tab bar. It arrives, waits
 * and leaves on its own, and never takes a tap — the screen under it stays usable.
 */
export function Toast({
  message,
  icon = "checkmark-circle",
  onDone,
}: {
  message: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onDone: () => void;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const run = Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: IN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(TOAST_MS - IN_MS - OUT_MS),
      Animated.timing(t, { toValue: 0, duration: OUT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]);
    run.start(({ finished }) => {
      if (finished) done.current();
    });
    return () => run.stop();
  }, [t]);

  const bottom = Math.max(insets.bottom, spacing.sm) + spacing.xs + TAB_BAR + 16;
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : RISE, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.toast, { bottom, opacity: t, transform: [{ translateY }] }]}
    >
      <Ionicons name={icon} size={20} color={c.success} />
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
    </Animated.View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    toast: {
      position: "absolute",
      alignSelf: "center",
      maxWidth: "88%",
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingLeft: 12,
      paddingRight: 16,
      paddingVertical: 10,
      borderRadius: 14,
      backgroundColor: c.toast,
      borderWidth: 1,
      borderColor: c.border,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.25,
      shadowRadius: 18,
      elevation: 10,
    },
    text: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: c.text,
    },
  });
