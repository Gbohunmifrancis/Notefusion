import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { confidenceColor, confidenceLabel, radii, spacing, typography } from '../design/theme';

/**
 * A confidence chip. The PRD is explicit that low confidence must be shown, not
 * hidden — the color and label make an honest claim about how much to trust the
 * transcription.
 */
export function ConfidenceBadge({ value, compact = false }: { value: number; compact?: boolean }) {
  const color = confidenceColor(value);
  const pct = Math.round(value * 100);

  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}22` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]}>
        {compact ? `${pct}%` : `${pct}% · ${confidenceLabel(value)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  text: { ...typography.caption },
});
