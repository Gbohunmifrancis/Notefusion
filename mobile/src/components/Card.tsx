import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import { radii, spacing, type Palette, type Shadows } from "../design/theme";
import { useThemedStyles } from "../lib/theme";

/**
 * Card surface.
 *
 * In the light blue theme every "raised" block sits on a solid white fill
 * framed by a slate hairline border, with a faint blue shadow for depth
 * against the Mist canvas. In dark mode the same structure holds — a lighter
 * navy fill over the deep navy canvas.
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
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.card, padded && styles.padded, style]}>
      {children}
    </View>
  );
}

const makeStyles = (c: Palette, s: Shadows) =>
  StyleSheet.create({
    card: {
      // Raised fill over the canvas
      backgroundColor: c.surface,
      borderRadius: radii.lg,
      // Hairline border
      borderWidth: 1,
      borderColor: c.border,
      // Subtle halo lifts the card off the canvas
      ...s.card,
    },
    padded: { padding: spacing.lg },
  });
