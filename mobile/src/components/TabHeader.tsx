import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { HeaderAvatar } from "./HeaderAvatar";
import { spacing, typography, type Palette } from "../design/theme";
import { useThemedStyles } from "../lib/theme";

/**
 * A tab's header (board a-core/04): the tab's name on the left, under a small line when it has one ("628 hymns
 * and tunes · offline"), and the account's avatar on the right, which opens Profile. No back button: a tab is
 * a place, not a step. `children` sit just before the avatar (Practice's style pill).
 */
export function TabHeader({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string | null;
  children?: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <View style={styles.titleBlock}>
        {eyebrow ? (
          <Text style={styles.eyebrow} numberOfLines={1}>
            {eyebrow}
          </Text>
        ) : null}
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      </View>
      <View style={styles.actions}>
        {children}
        <HeaderAvatar />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 48,
      marginTop: spacing.sm,
      marginBottom: spacing.lg,
      gap: spacing.md,
    },
    titleBlock: { flex: 1 },
    eyebrow: {
      ...typography.caption,
      color: c.textFaint,
      textTransform: "uppercase",
      letterSpacing: 1,
      fontSize: 10,
    },
    title: { ...typography.title, color: c.text, fontSize: 22, letterSpacing: -0.4, marginTop: 1 },
    actions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  });
