import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fonts, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";

/**
 * A problem in plain words with a small amber icon (board 7c, "field error"): under a field, a
 * player or a form. Never red — red is kept for the one word that deletes.
 */
export function ProblemNote({
  children,
  center = false,
  style,
}: {
  children: React.ReactNode;
  /** Centred under a centred block (a player, a dialog's form). */
  center?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.row, center && styles.center, style]} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={15} color={c.warning} style={styles.icon} />
      <Text style={[styles.text, center && styles.textCenter]}>{children}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 6,
      marginTop: 8,
    },
    center: {
      justifyContent: "center",
    },
    icon: {
      marginTop: 1,
    },
    text: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      lineHeight: 18,
      color: c.textMuted,
    },
    textCenter: {
      textAlign: "center",
    },
  });
