import React, { useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { fonts, radii, spacing, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";

interface Props {
  /** "Continue with Google" on login, "Sign in with Google" on onboarding. */
  label?: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

/**
 * Google's four-colour "G", drawn to their brand guidelines.
 *
 * Inlined as SVG rather than shipped as a PNG because Google's terms require the
 * mark to keep its exact colours and proportions at every size, which an image
 * asset scaled by React Native cannot promise.
 */
function GoogleG({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}

/**
 * Outlined "Continue with Google" button.
 *
 * Kept separate from `Button` rather than added as a variant: the label has to
 * sit centred with the mark beside it at a fixed gap, the fill is always the
 * surface colour regardless of theme accent, and the icon is multi-coloured
 * artwork rather than a tinted glyph. Folding all three into `Button` would mean
 * three new props that only ever apply to this one case.
 */
export function GoogleButton({
  label = "Continue with Google",
  onPress,
  loading = false,
  disabled = false,
  style,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const isDisabled = disabled || loading;

  const animate = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();

  return (
    <Animated.View
      style={[{ transform: [{ scale }] }, style, isDisabled && styles.disabled]}
    >
      <Pressable
        onPress={isDisabled ? undefined : onPress}
        onPressIn={() => !isDisabled && animate(0.97)}
        onPressOut={() => animate(1)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        style={styles.base}
      >
        {loading ? (
          <ActivityIndicator color={colors.textMuted} size="small" />
        ) : (
          <View style={styles.row}>
            <GoogleG />
            <Text style={styles.label}>{label}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    base: {
      height: 56,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },

    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },

    label: {
      fontSize: 16,
      fontFamily: fonts.semibold,
      color: c.text,
    },

    disabled: {
      opacity: 0.4,
    },
  });
