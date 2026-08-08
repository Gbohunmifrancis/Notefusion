import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";
import { radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  secure?: boolean;
}

/**
 * Text field.
 *
 * Resting state : raised surface fill + hairline border.
 * Focused state : Primary Blue border glow so the active field is
 *                 unmistakable on the canvas.
 * Error state   : danger-red border with an inline error message below.
 *
 * PRD: honest feedback — errors are always shown inline, never silent.
 */
export function TextField({ label, error, secure, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.wrap}>
      {label && <Text style={styles.label}>{label}</Text>}

      <TextInput
        style={[
          styles.input,
          focused && styles.focused,
          !!error && styles.inputError,
        ]}
        placeholderTextColor={colors.textFaint}
        secureTextEntry={secure}
        autoCapitalize="none"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...rest}
      />

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
      color: c.textMuted,
      marginBottom: spacing.sm,
    },

    input: {
      // Raised fill over the canvas
      backgroundColor: c.surface,
      borderWidth: 1,
      // Resting hairline border
      borderColor: c.border,
      borderRadius: radii.md,
      paddingHorizontal: spacing.lg,
      height: 52,
      color: c.text,
      fontSize: 16,
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

    inputError: {
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
