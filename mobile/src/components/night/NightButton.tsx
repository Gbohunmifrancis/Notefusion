import React, { useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { night, nightFonts } from "../../design/theme";

type Variant = "white" | "blue" | "ghost";

interface Props {
  label: string;
  onPress?: () => void;
  /**
   * `white` is the primary on the dark canvas, `blue` the commit action (sign in,
   * verify, the last onboarding card), `ghost` the secondary choice beside them.
   */
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  /** Drawn before the label, e.g. Google's "G". */
  icon?: React.ReactNode;
  /** A small trailing chip, e.g. "Last used". */
  badge?: string;
  style?: StyleProp<ViewStyle>;
}

/** The 54px pill every night screen uses for its actions. */
export function NightButton({
  label,
  onPress,
  variant = "white",
  loading = false,
  disabled = false,
  icon,
  badge,
  style,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const inactive = disabled || loading;
  const spring = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

  const textColor = variant === "white" ? night.onWhite : night.text;

  return (
    <Animated.View style={[{ transform: [{ scale }] }, inactive && !loading && styles.disabled, style]}>
      <Pressable
        onPress={inactive ? undefined : onPress}
        onPressIn={() => !inactive && spring(0.97)}
        onPressOut={() => spring(1)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inactive, busy: loading }}
        style={[styles.base, styles[variant]]}
      >
        {loading ? (
          <ActivityIndicator color={textColor} size="small" />
        ) : (
          <View style={styles.row}>
            {icon}
            <Text style={[styles.label, { color: textColor }]}>{label}</Text>
            {badge ? (
              <View style={[styles.badge, variant === "white" && styles.badgeOnWhite]}>
                <Text style={[styles.badgeText, variant === "white" && styles.badgeTextOnWhite]}>
                  {badge}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  white: { backgroundColor: "#FFFFFF" },
  blue: {
    backgroundColor: night.blue,
    shadowColor: night.blue,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 8,
  },
  ghost: {
    backgroundColor: night.surface2,
    borderWidth: 1,
    borderColor: night.line2,
  },
  disabled: { opacity: 0.45 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { fontSize: 15.5, fontFamily: nightFonts.semibold },
  badge: {
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 999,
    justifyContent: "center",
    backgroundColor: night.blueSoft,
  },
  badgeOnWhite: { backgroundColor: "rgba(47, 123, 255, 0.12)" },
  badgeText: { fontSize: 11, fontFamily: nightFonts.semibold, color: night.ice },
  badgeTextOnWhite: { color: night.blueDeep },
});
