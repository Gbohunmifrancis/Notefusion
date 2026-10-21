/**
 * A practice mode's top bar (boards c-practice/6b–6d): the round back button, the mode's name small above the step's
 * title, and one thing on the right ("Doh is D", "3 min", "1 of 2").
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Icon, type IconName } from "../Icon";
import { Touchable } from "../Touchable";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";

export function ModeHeader({
  eyebrow,
  title,
  pill,
  pillIcon,
  onBack,
}: {
  eyebrow: string;
  title: string;
  pill?: string | null;
  pillIcon?: IconName;
  /** Instead of leaving the screen (a step inside it, such as the range finder back to the routine). */
  onBack?: () => void;
}) {
  const nav = useNavigation();
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Touchable
        onPress={() => (onBack ? onBack() : nav.canGoBack() ? nav.goBack() : undefined)}
        hitSlop={4}
        radius={22}
        accessibilityLabel="Go back"
        style={styles.back}
      >
        <Icon name="back" size={20} color={c.text} />
      </Touchable>
      <View style={styles.text}>
        <Text style={styles.eyebrow} numberOfLines={1}>{eyebrow}</Text>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{title}</Text>
      </View>
      {pill ? (
        <View style={styles.pill}>
          {pillIcon ? <Icon name={pillIcon} size={14} color={c.textMuted} /> : null}
          <Text style={styles.pillText}>{pill}</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm, marginBottom: spacing.md, minHeight: 48 },
    back: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    text: { flex: 1, minWidth: 0 },
    eyebrow: { ...typography.caption, color: c.textFaint, textTransform: "uppercase", letterSpacing: 1, fontSize: 12 },
    title: { fontFamily: fonts.semibold, fontSize: 22, letterSpacing: -0.3, color: c.text, marginTop: 2 },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 36,
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    pillText: { fontFamily: fonts.semibold, fontSize: 13, color: c.text },
  });
