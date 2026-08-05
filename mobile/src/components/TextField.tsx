import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";
import { colors, radii, spacing, typography } from "../design/theme";

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  secure?: boolean;
}

/**
 * Dark-theme text field.
 *
 * Resting state : glass fill (7 % white) + subtle white border (12 %).
 * Focused state : Electric Purple border glow so the active field is
 *                 unmistakable on the pitch-black canvas.
 * Error state   : danger-red border with an inline error message below.
 *
 * PRD: honest feedback — errors are always shown inline, never silent.
 */
export function TextField({ label, error, secure, ...rest }: Props) {
  const [focused, setFocused] = useState(false);

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

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.lg,
  },

  label: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },

  input: {
    // Glass fill — 7 % white over the black canvas
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderWidth: 1,
    // Resting border — 12 % white (the "glass edge")
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    height: 52,
    // Crisp White text on dark background
    color: colors.text,
    fontSize: 16,
  },

  /** Electric Purple focus ring — unmistakable active-field indicator. */
  focused: {
    borderColor: colors.purple,
    // Soft purple glow under the field
    shadowColor: colors.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },

  inputError: {
    borderColor: colors.danger,
    shadowColor: colors.danger,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },

  error: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
});
