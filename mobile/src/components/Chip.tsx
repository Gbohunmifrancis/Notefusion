import React from "react";
import { StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { Touchable } from "./Touchable";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useThemedStyles } from "../lib/theme";

/**
 * The one chip (board n-ux-low Q5e): a choice among a few, tapped once — Record's key, beats in a bar and keyboard
 * transpose, Song link's section and beats. 44 tall (never narrower), 16 either side, 14 px words. Selected is the
 * app's selected look, the tab bar's: the wash under the accent line with link words (8.94:1), never a fill under
 * white words, which reads as a button.
 */
export function Chip({
  label,
  selected,
  onPress,
  mono = false,
  style,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Monospaced words, for figures that should line up (the transpose's "+2"). */
  mono?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Defaults to the label. */
  accessibilityLabel?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Touchable
      onPress={onPress}
      radius={radii.pill}
      style={[styles.chip, selected && styles.chipOn, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
    >
      <Text style={[styles.text, selected && styles.textOn, mono && styles.mono]} numberOfLines={1}>
        {label}
      </Text>
    </Touchable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    chip: {
      height: 44,
      minWidth: 44,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.pill,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    chipOn: {
      backgroundColor: c.selectedWash,
      borderColor: c.accent,
    },
    text: {
      fontFamily: fonts.medium,
      fontSize: 14,
      color: c.textMuted,
    },
    mono: {
      fontFamily: typography.mono.fontFamily,
    },
    textOn: {
      fontFamily: fonts.semibold,
      color: c.link,
    },
  });
