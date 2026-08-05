import React, { useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { colors, gradients, radii, spacing, typography } from "../design/theme";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

/**
 * Unified button component for the luxury dark-mode design system.
 *
 * primary   — "The Fusion" gradient (Electric Purple → Warm Gold), bold white
 *             label, tactile spring-scale on press.
 * secondary — Glass surface (8 % white) + 14 % white border; muted label.
 * ghost     — Transparent; Soft Ash label for low-hierarchy actions.
 * danger    — Red-tinted glass; danger-red label for destructive actions.
 *
 * All variants share the same spring-scale press animation powered by
 * React Native's built-in Animated API (no extra dependencies needed).
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  loading = false,
  disabled = false,
  style,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const isDisabled = disabled || loading;

  /** Spring-snap on press-in, snap back on release. */
  const animate = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();

  // ── Label / icon colour per variant ───────────────────────────────────────
  const getTextColor = (): string => {
    switch (variant) {
      case "primary":
        return "#FFFFFF";
      case "danger":
        return colors.danger;
      case "ghost":
        return colors.textMuted;
      default:
        return colors.text;
    }
  };

  const textColor = getTextColor();

  // ── Inner content (shared across variants) ────────────────────────────────
  const content = loading ? (
    <ActivityIndicator color={textColor} size="small" />
  ) : (
    <>
      {icon && (
        <Ionicons name={icon} size={18} color={textColor} style={styles.icon} />
      )}
      <Text style={[styles.label, { color: textColor }]}>{label}</Text>
    </>
  );

  // ── Primary — LinearGradient background ───────────────────────────────────
  const primaryInner = (
    <LinearGradient
      colors={gradients.brand} // #A855F7 → #F59E0B
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.base}
    >
      {content}
    </LinearGradient>
  );

  // ── All other variants — plain View background ─────────────────────────────
  const otherInner = (
    <Animated.View
      style={[
        styles.base,
        variant === "secondary" && styles.secondary,
        variant === "ghost" && styles.ghost,
        variant === "danger" && styles.danger,
      ]}
    >
      {content}
    </Animated.View>
  );

  return (
    <Animated.View
      style={[{ transform: [{ scale }] }, style, isDisabled && styles.disabled]}
    >
      <Pressable
        onPress={isDisabled ? undefined : onPress}
        onPressIn={() => !isDisabled && animate(0.96)}
        onPressOut={() => animate(1)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        // overflow:hidden clips the gradient to the pill shape on Android
        style={styles.pressable}
      >
        {variant === "primary" ? primaryInner : otherInner}
      </Pressable>
    </Animated.View>
  );
}

// ─── Standalone GradientButton ────────────────────────────────────────────────
// Convenience alias — keeps the sample-prompt API and is re-exported so screens
// can import either name without changing existing usages of <Button>.
export { Button as GradientButton };

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  /** Clips the LinearGradient to the pill shape on Android & iOS. */
  pressable: {
    borderRadius: radii.pill,
    overflow: "hidden",
  },

  /** Shared geometry — all variants render at this size. */
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 54,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
  },

  /** Glass surface — 8 % white fill, 14 % white border. */
  secondary: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
  },

  /** Transparent — for low-hierarchy / skip actions. */
  ghost: {
    backgroundColor: "transparent",
  },

  /** Red-tinted glass — destructive / sign-out actions. */
  danger: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
  },

  /** Applied when disabled or loading — preserves layout, fades visually. */
  disabled: {
    opacity: 0.4,
  },

  label: {
    ...typography.label,
    fontSize: 15,
    fontWeight: "600",
  },

  icon: {
    marginRight: spacing.sm,
  },
});
