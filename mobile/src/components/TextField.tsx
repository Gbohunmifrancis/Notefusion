import React, { useState } from "react";
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";

interface Props extends Omit<TextInputProps, "style"> {
  label?: string;
  error?: string;
  secure?: boolean;
  /** Leading glyph inside the field — a mail envelope, a padlock, and so on. */
  icon?: keyof typeof Ionicons.glyphMap;
  /**
   * Applied to the whole field — label, box, and inline error — so callers can
   * adjust its place in a form (dropping the last field's bottom margin, say).
   *
   * `style` is deliberately taken off `TextInputProps` and pointed here: the
   * field's chrome lives on the wrapper, and a caller-supplied `style` used to
   * land on the bare `TextInput` after `styles.input`, silently replacing its
   * flex, colour, and font rather than nudging the layout.
   */
  style?: StyleProp<ViewStyle>;
}

/**
 * Text field.
 *
 * Resting state : raised surface fill + hairline border.
 * Focused state : Primary Blue border glow so the active field is
 *                 unmistakable on the canvas.
 * Error state   : danger-red border with an inline error message below.
 *
 * A `secure` field grows an eye toggle on the right. It exists because these
 * are typed on a phone keyboard where a mistyped password is invisible and the
 * only feedback is a failed sign-in; revealing the text is the cheapest fix.
 * The toggle is local state and never leaves the component — nothing upstream
 * needs to know the password is currently visible.
 *
 * PRD: honest feedback — errors are always shown inline, never silent.
 */
export function TextField({ label, error, secure, icon, style, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.wrap, style]}>
      {label && <Text style={styles.label}>{label}</Text>}

      <View
        style={[
          styles.field,
          focused && styles.focused,
          !!error && styles.fieldError,
        ]}
      >
        {icon && (
          <Ionicons
            name={icon}
            size={20}
            // Blue once focused, slate at rest: the icon reinforces which field
            // is active rather than sitting inert next to the border glow.
            color={focused ? colors.accent : colors.textFaint}
            style={styles.icon}
          />
        )}

        <TextInput
          style={styles.input}
          placeholderTextColor={colors.textFaint}
          secureTextEntry={secure && !revealed}
          autoCapitalize="none"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />

        {secure && (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            // The glyph is 22 px; the slop brings the tap target up to roughly
            // the 44 px minimum without pushing the field taller.
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
          >
            <Ionicons
              name={revealed ? "eye-off-outline" : "eye-outline"}
              size={22}
              color={colors.textFaint}
            />
          </Pressable>
        )}
      </View>

      {/* Inline error — PRD requires honest, visible failure states */}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      marginBottom: spacing.lg,
    },

    label: {
      ...typography.label,
      color: c.text,
      marginBottom: spacing.sm,
    },

    /** The bordered row. The border lives here, not on the TextInput, so the
     *  icon and eye toggle sit inside the same outline as the text. */
    field: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.md,
      paddingHorizontal: spacing.lg,
      height: 56,
    },

    icon: {
      marginRight: spacing.md,
    },

    input: {
      flex: 1,
      color: c.text,
      fontSize: 16,
      fontFamily: fonts.regular,
      // Android centres text oddly in a fixed-height row without this.
      paddingVertical: 0,
    },

    /** Primary Blue focus ring — unmistakable active-field indicator. */
    focused: {
      borderColor: c.purple,
      // Soft blue glow under the field
      shadowColor: c.purple,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.35,
      shadowRadius: 8,
      elevation: 4,
    },

    fieldError: {
      borderColor: c.danger,
      shadowColor: c.danger,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 3,
    },

    error: {
      ...typography.caption,
      color: c.danger,
      marginTop: spacing.xs,
    },
  });
