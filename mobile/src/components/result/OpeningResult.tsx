import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Skeleton } from "../Skeleton";
import { fonts, radii, spacing, type Palette } from "../../design/theme";
import { useThemedStyles } from "../../lib/theme";

/**
 * The Result screen's shape while a transcription is fetched to be opened: a "ready" push tapped, or a sheet on its
 * way opened from the Library. It covers whatever was on screen (Home, on a cold start) from the tap until Result
 * slides up, so the tap reads as "opening it" rather than as the app going to Home and then jumping somewhere else.
 * It takes no taps; a failure is said by the opener's own sheet, which it gives way to.
 */
export function OpeningResult({ visible }: { visible: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [shown, setShown] = useState(visible);

  useEffect(() => {
    // In at once (anything else would let the screen beneath show through), out over a beat as Result arrives.
    if (visible) {
      setShown(true);
      opacity.setValue(1);
      return;
    }
    const fade = Animated.timing(opacity, { toValue: 0, duration: reduceMotion ? 0 : 180, useNativeDriver: true });
    fade.start(({ finished }) => finished && setShown(false));
    return () => fade.stop();
  }, [visible, opacity, reduceMotion]);

  if (!shown) return null;

  return (
    <Animated.View
      style={[styles.cover, { opacity, paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}
      pointerEvents={visible ? "auto" : "none"}
      accessibilityViewIsModal
      accessibilityLiveRegion="polite"
      accessibilityLabel="Opening your transcription"
    >
      <View style={styles.header}>
        <Skeleton width={36} height={36} radius={radii.pill} />
        <Skeleton width="55%" height={22} />
      </View>
      <View style={styles.chips}>
        <Skeleton width={96} height={28} radius={radii.pill} />
        <Skeleton width={72} height={28} radius={radii.pill} />
        <Skeleton width={84} height={28} radius={radii.pill} />
      </View>
      <View style={styles.score}>
        {[0.92, 0.78, 0.88, 0.64, 0.84, 0.7].map((w, i) => (
          <Skeleton key={i} width={`${w * 100}%`} height={18} />
        ))}
      </View>
      <Text style={styles.caption}>Opening your transcription…</Text>
      <View style={styles.dock}>
        <Skeleton width="100%" height={64} radius={radii.lg} />
      </View>
    </Animated.View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    cover: {
      ...StyleSheet.absoluteFill,
      backgroundColor: c.bg,
      paddingHorizontal: spacing.lg,
      gap: spacing.lg,
    },
    header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    chips: { flexDirection: "row", gap: spacing.sm },
    score: { gap: spacing.md, marginTop: spacing.md },
    caption: {
      marginTop: spacing.lg,
      textAlign: "center",
      color: c.textMuted,
      fontFamily: fonts.medium,
      fontSize: 14,
    },
    dock: { marginTop: "auto" },
  });
