import React from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { fonts, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { AuthStackParams } from "../navigation/types";

/**
 * A guest's way to an account (board l-ux-high/07): what an account adds and the two ways to one — create a free
 * account (primary) or sign in (text). The preview's "Keep this sheet" card, and the plain card when this phone has
 * had its free preview. Signed out only: the buttons open Register and Login in the signed-out stack, and the
 * account either one ends in claims the preview this phone keeps (`lib/previewClaim`).
 */
export function GuestAccountCard({
  title,
  message,
  primary,
  style,
  onLayout,
}: {
  /** With the bookmark beside it; none for a plain card. */
  title?: string;
  message: string;
  /** The primary button's words, e.g. "Create a free account to keep it". */
  primary: string;
  style?: StyleProp<ViewStyle>;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const nav = useNavigation<NativeStackNavigationProp<AuthStackParams>>();
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.card, style]} onLayout={onLayout}>
      {title ? (
        <View style={styles.head}>
          <Icon name="save" size={20} color={c.text} />
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
        </View>
      ) : null}
      <Text style={[styles.message, !title && styles.messagePlain]}>{message}</Text>
      <View style={styles.actions}>
        <Button label={primary} onPress={() => nav.navigate("Register")} />
        <Button label="Sign in" variant="text" onPress={() => nav.navigate("Login")} />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 18,
      paddingTop: 16,
      paddingBottom: 14,
    },
    head: { flexDirection: "row", alignItems: "center", gap: 10 },
    title: { ...typography.heading, color: c.text, flexShrink: 1 },
    message: {
      ...typography.body,
      fontSize: 14,
      lineHeight: 20,
      color: c.textMuted,
      marginTop: spacing.sm,
    },
    messagePlain: { marginTop: 0, color: c.text, fontFamily: fonts.medium },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.md,
    },
  });
