import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { fonts, spacing, type Palette } from "../design/theme";
import { useThemedStyles } from "../lib/theme";

/**
 * A hairline rule with "or" set into it — the break between the primary action
 * and the Google alternative on login and onboarding.
 *
 * The rules flex and the word does not, so the two halves stay equal at any
 * width without hardcoding a line length.
 */
export function OrDivider({ label = "or" }: { label?: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <View style={styles.rule} />
      <Text style={styles.label}>{label}</Text>
      <View style={styles.rule} />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.lg,
      marginVertical: spacing.lg,
    },

    rule: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
    },

    label: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: c.textMuted,
    },
  });
