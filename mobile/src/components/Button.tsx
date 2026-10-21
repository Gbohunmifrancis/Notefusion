import React, { useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Icon, type IconName } from "./Icon";
import { fonts, radii, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import * as haptics from "../lib/haptics";

/**
 * The four buttons. One `primary` on a screen or in a sheet; everything else is `secondary`
 * or `text`. `destructive` is the secondary pill with its word in red, for a loss that cannot
 * be undone (delete, discard, remove, leave): danger is the word, never the paint.
 */
export type ButtonVariant = "primary" | "secondary" | "text" | "destructive";

/** Height says the weight: 48 for the actions of a screen or sheet, 40 inside rows and cards. */
export type ButtonSize = "md" | "sm";

interface Props {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Screen-wide. Only for the single main action at the bottom of a flow (Sign in, Transcribe,
   * Continue at checkout), never two stacked.
   */
  block?: boolean;
  icon?: IconName;
  /** Drawn before the label in place of `icon`, for a mark that is not an icon (Google's G). */
  leading?: React.ReactNode;
  /** Which side of the label the icon sits on. Defaults to leading. */
  iconPosition?: "left" | "right";
  /** A small chip after the label, e.g. "Last used". */
  badge?: string;
  /**
   * A 1 px edge inside the pill, in this colour: for a quiet pill on a canvas as dark as its own fill, where the
   * fill alone shows no edge (the first-run screens' `NightButton`). The pill keeps its height.
   */
  edgeColor?: string;
  /** A spinner replaces the word; the pill keeps its width. */
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Defaults to the label. */
  accessibilityLabel?: string;
}

const HEIGHT = { md: 48, sm: 40 } as const;
const PAD = { md: 22, sm: 16 } as const;
/** A text button needs less room either side: it has no fill to frame. */
const TEXT_PAD = 12;
/** Press timing: 120 ms, no bounce. */
const PRESS_MS = 120;

/**
 * The app's one button.
 *
 * Pressed is a 0.97 scale and a 10 % darker face over 120 ms with no overshoot, and a light
 * haptic tick (a warning tick on `destructive`). Disabled is 40 %. Loading swaps the word for a
 * spinner while the word still holds the width, so the row around it does not jump.
 *
 * It hugs its word: the parent decides the width, except `block`, which fills it. At `sm` the
 * 40 px pill keeps a 48 px touch target through `hitSlop`.
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  block = false,
  icon,
  leading,
  iconPosition = "left",
  badge,
  edgeColor,
  loading = false,
  disabled = false,
  style,
  accessibilityLabel,
}: Props) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const pressed = useRef(new Animated.Value(0)).current;
  const inactive = disabled || loading;

  const animate = (to: number) =>
    Animated.timing(pressed, {
      toValue: to,
      duration: PRESS_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

  const textColor =
    variant === "primary"
      ? c.onAccent
      : variant === "destructive"
        ? c.dangerText
        : variant === "text"
          ? c.link
          : c.text;

  // Red is the word, never the icon: a destructive button's icon stays grey (the bin beside "Delete").
  const glyph = icon ? (
    <Icon name={icon} size={size === "sm" ? 16 : 18} color={variant === "destructive" ? c.textMuted : textColor} />
  ) : null;

  const scale = pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] });
  const shade = pressed.interpolate({ inputRange: [0, 1], outputRange: [0, 0.1] });

  return (
    <Animated.View
      style={[
        variant === "primary" && !inactive && styles.lift,
        block && styles.block,
        { transform: [{ scale }] },
        style,
        disabled && styles.disabled,
      ]}
    >
      <Pressable
        onPress={inactive ? undefined : onPress}
        onPressIn={() => {
          if (inactive) return;
          animate(1);
          haptics.play(variant === "destructive" ? "warning" : "light");
        }}
        onPressOut={() => animate(0)}
        hitSlop={size === "sm" ? { top: 4, bottom: 4 } : undefined}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: inactive, busy: loading }}
        style={[
          styles.base,
          { height: HEIGHT[size], paddingHorizontal: variant === "text" ? TEXT_PAD : PAD[size] },
          variant === "primary" && styles.primary,
          (variant === "secondary" || variant === "destructive") && styles.quiet,
          edgeColor ? { borderWidth: 1, borderColor: edgeColor } : null,
        ]}
      >
        {/* The pressed face: 10 % darker on a fill, a faint blue pill under a text button. */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: variant === "text" ? c.link : "#000000", opacity: shade },
          ]}
        />
        <View style={[styles.row, loading && styles.hidden]}>
          {leading}
          {iconPosition === "left" && glyph}
          <Text
            style={[styles.label, size === "sm" && styles.labelSm, { color: textColor }]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {iconPosition === "right" && glyph}
          {badge ? (
            <View style={[styles.badge, variant === "primary" && styles.badgeOnPrimary]}>
              <Text style={[styles.badgeText, variant === "primary" && styles.badgeTextOnPrimary]}>
                {badge}
              </Text>
            </View>
          ) : null}
        </View>
        {loading ? (
          <View style={styles.spinner} pointerEvents="none">
            <ActivityIndicator color={textColor} size="small" />
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    base: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.pill,
      overflow: "hidden",
    },
    primary: {
      backgroundColor: c.primary,
    },
    /** Secondary and destructive share the quiet pill; only the word's colour differs. */
    quiet: {
      backgroundColor: c.surfaceAlt,
    },
    /** The primary's soft glow, on the wrapper so the pill's clip does not cut it off. */
    lift: {
      borderRadius: radii.pill,
      shadowColor: c.primary,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.3,
      shadowRadius: 9,
    },
    block: {
      alignSelf: "stretch",
    },
    disabled: {
      opacity: 0.4,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    hidden: {
      opacity: 0,
    },
    spinner: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    label: {
      fontFamily: fonts.semibold,
      fontSize: 16,
    },
    labelSm: {
      fontSize: 15,
    },
    badge: {
      height: 22,
      paddingHorizontal: 8,
      borderRadius: radii.pill,
      justifyContent: "center",
      backgroundColor: c.accentSoft,
    },
    /** A fainter wash than it was (0.18), so the white words keep 4.65:1 on Night's blue (3.99 before). */
    badgeOnPrimary: {
      backgroundColor: "rgba(255, 255, 255, 0.10)",
    },
    badgeText: {
      fontFamily: fonts.semibold,
      // The app's smallest words: 12, never under.
      fontSize: 12,
      color: c.link,
    },
    badgeTextOnPrimary: {
      color: c.onAccent,
    },
  });
