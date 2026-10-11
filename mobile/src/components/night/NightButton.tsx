import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { night, nightFonts } from "../../design/theme";
import { Touchable } from "../Touchable";

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

/**
 * The 54px pill every night screen uses for its actions. It presses through `Touchable`,
 * so it shares the app's one press spring (no overshoot), haptic tick and ripple.
 */
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
  const inactive = disabled || loading;
  const textColor = variant === "white" ? night.onWhite : night.text;

  return (
    <Touchable
      // Loading keeps full opacity (the spinner is the cue) but takes no presses.
      onPress={inactive ? undefined : onPress}
      disabled={disabled}
      haptic={loading ? "none" : "light"}
      // The blue pill casts a glow; clipping it for the ripple would cut that off.
      radius={variant === "blue" ? undefined : 27}
      accessibilityLabel={label}
      accessibilityState={{ busy: loading }}
      style={[styles.base, styles[variant], style]}
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
    </Touchable>
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
