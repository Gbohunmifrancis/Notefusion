import React, { useRef, useState } from "react";
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
import { ProblemNote } from "./ProblemNote";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";

interface Props extends Omit<TextInputProps, "style"> {
  label?: string;
  error?: string;
  secure?: boolean;
  /** Leading glyph inside the field — a mail envelope, a padlock, and so on. */
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}

/**
 * Text field component.
 *
 * Android focus drop fix:
 * Dynamic elevation changes on a parent View when TextInput gains focus cause Android
 * to re-layer the native View tree, which immediately forces onBlur and dismisses the keyboard.
 * Shadows/glows use shadowColor/shadowOpacity (iOS only) while Android gets a clean border outline.
 */
export function TextField({ label, error, secure, icon, style, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.wrap, style]}>
      {label && <Text style={styles.label}>{label}</Text>}

      <Pressable
        onPress={() => inputRef.current?.focus()}
        // A field with a problem keeps its own edge: the words under it say what is wrong (board 7c).
        style={[styles.field, focused && styles.focused]}
      >
        {icon && (
          <Ionicons
            name={icon}
            size={20}
            color={focused ? colors.accent : colors.textFaint}
            style={styles.icon}
          />
        )}

        <TextInput
          ref={inputRef}
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
      </Pressable>

      {error ? <ProblemNote style={styles.error}>{error}</ProblemNote> : null}
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
      paddingVertical: 0,
    },

    focused: {
      borderColor: c.purple,
      borderWidth: 1.5,
      shadowColor: c.purple,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.35,
      shadowRadius: 8,
    },

    error: {
      marginTop: spacing.xs + 2,
    },
  });
