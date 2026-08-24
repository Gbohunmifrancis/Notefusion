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
import {
  fonts,
  gradients,
  radii,
  spacing,
  typography,
  type Palette,
} from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import * as haptics from "../lib/haptics";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dangerSolid";

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Which side of the label the icon sits on. Defaults to leading. */
  iconPosition?: "left" | "right";
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

/**
 * Unified button component.
 *
 * primary     — "The Fusion" gradient (blue), white label, tactile
 *               spring-scale on press.
 * secondary   — Raised surface + hairline border; body-coloured label.
 * ghost       — Transparent, and genuinely quieter: a lighter face at a smaller
 *               size, because a "ghost" that matches `primary`'s 17px semibold
 *               is only quieter in colour and ends up competing with whatever
 *               heading sits above it (this is what made dialog cancels shout).
 * danger      — Danger-tinted wash; danger label. For a destructive action that
 *               is *not* the main event on screen.
 * dangerSolid — Filled danger, white label. For a destructive action that IS the
 *               primary action — a confirmation dialog's "Sign out". A 12 % tint
 *               reads hollow in that position, as if the app were hedging.
 *
 * All variants share the same spring-scale press animation powered by
 * React Native's built-in Animated API (no extra dependencies needed).
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  iconPosition = "left",
  loading = false,
  disabled = false,
  style,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const isDisabled = disabled || loading;
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

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
      case "dangerSolid":
        return colors.onAccent;
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
  const glyph = icon && (
    <Ionicons
      name={icon}
      size={18}
      color={textColor}
      style={iconPosition === "right" ? styles.iconRight : styles.icon}
    />
  );

  const content = loading ? (
    <ActivityIndicator color={textColor} size="small" />
  ) : (
    <>
      {iconPosition === "left" && glyph}
      <Text
        style={[
          styles.label,
          variant === "ghost" && styles.ghostLabel,
          { color: textColor },
        ]}
      >
        {label}
      </Text>
      {iconPosition === "right" && glyph}
    </>
  );

  // ── Primary — LinearGradient background ───────────────────────────────────
  const primaryInner = (
    <LinearGradient
      colors={gradients.brand} // #1D4ED8 → #3B82F6
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
        variant === "dangerSolid" && styles.dangerSolid,
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
        onPressIn={() => {
          if (isDisabled) return;
          animate(0.96);
          // Both destructive variants are the ones that sign you out or delete
          // something, so they get the warning pattern rather than the tick.
          haptics.play(
            variant === "danger" || variant === "dangerSolid"
              ? "warning"
              : "light",
          );
        }}
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
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

    /** Raised surface + hairline border. */
    secondary: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },

    /** Transparent — for low-hierarchy / skip actions. */
    ghost: {
      backgroundColor: "transparent",
    },

    /** Danger-tinted wash — secondary destructive actions. Both the tint and the
     *  label now come from the same palette, so dark mode stops painting a
     *  light-mode maroon fill under a lightened salmon label. */
    danger: {
      backgroundColor: c.dangerSoft,
      borderWidth: 1,
      borderColor: c.dangerBorder,
    },

    /** Filled danger — the destructive action that is also the primary one. */
    dangerSolid: {
      backgroundColor: c.danger,
    },

    /** Applied when disabled or loading — preserves layout, fades visually. */
    disabled: {
      opacity: 0.4,
    },

    label: {
      ...typography.label,
      fontSize: 16,
    },

    /** Ghost only: a step down in size and weight, not just in colour. */
    ghostLabel: {
      fontFamily: fonts.medium,
      fontSize: 15,
    },

    icon: {
      marginRight: spacing.sm,
    },

    iconRight: {
      marginLeft: spacing.md,
    },
  });
