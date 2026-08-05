import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import { colors, radii, shadow, spacing } from "../design/theme";

/**
 * Glassmorphism card surface.
 *
 * In the luxury dark-mode theme every "raised" block sits on a
 * semi-transparent white fill (5 %) framed by a 10 % white border —
 * the standard glassmorphism recipe — with a faint purple shadow for
 * depth.  No solid white backgrounds anywhere.
 */
export function Card({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
}) {
  return (
    <View style={[styles.card, padded && styles.padded, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // Glass fill — 5 % white over the black canvas
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    // 10 % white border — the "glass edge"
    borderWidth: 1,
    borderColor: colors.border,
    // Subtle purple halo lifts the card off the black background
    ...shadow.card,
  },
  padded: { padding: spacing.lg },
});
