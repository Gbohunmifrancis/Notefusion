import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  confidenceColor,
  confidenceLabel,
  fonts,
  radii,
  spacing,
  typography,
} from "../design/theme";
import { useColors } from "../lib/theme";

/**
 * Confidence chip — PRD requires honest visibility of low confidence,
 * never hiding it. The colour-coded dot + border make the trust level
 * immediately legible on white card surfaces.
 *
 *  ≥ 75 %  →  green  (High confidence)
 *  ≥ 50 %  →  amber  (Fair — worth a review)
 *   < 50 %  →  red    (Low — please double-check)
 */
export function ConfidenceBadge({
  value,
  compact = false,
}: {
  value: number;
  compact?: boolean;
}) {
  const colors = useColors();
  const color = confidenceColor(value, colors);
  const pct = Math.round(value * 100);

  return (
    <View
      style={[
        styles.badge,
        {
          // 30 % opacity border is visible on glass cards
          borderColor: `${color}4D`,
          // 15 % opacity fill — tinted but not overwhelming
          backgroundColor: `${color}26`,
        },
      ]}
    >
      {/* Glowing dot — brighter on dark surfaces */}
      <View
        style={[
          styles.dot,
          {
            backgroundColor: color,
            // Simulate a soft glow with shadow
            shadowColor: color,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.9,
            shadowRadius: 6,
            elevation: 4,
          },
        ]}
      />
      <Text style={[styles.text, { color }]}>
        {compact ? `${pct}%` : `${pct}% · ${confidenceLabel(value)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  text: {
    ...typography.caption,
    fontFamily: fonts.semibold,
  },
});
