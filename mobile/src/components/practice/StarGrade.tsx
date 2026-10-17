/**
 * StarGrade — a marked take as Playful shows it: one to three stars and a friendly word instead of the number, each
 * note coloured (green spot on, amber close, red try again, grey not heard) without the cents, and the line it earned.
 * The marks are the same as Focused's (`GradeMarks`); only the telling differs.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { GradeResult, NoteEvent } from "../../api/types";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { playfulRewardLine, starHint, starsFor, starWord } from "../../lib/practiceTrack";

export function StarGrade({ grade, notes }: { grade: GradeResult; notes: readonly NoteEvent[] }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const stars = starsFor(grade.score);
  const earned = playfulRewardLine(grade.reward);

  const statusColor = (s: string) =>
    s === "hit" ? colors.success : s === "near" ? colors.warning : s === "wrong" ? colors.danger : colors.textFaint;

  return (
    <View style={styles.result}>
      <View style={styles.stars} accessible accessibilityLabel={`${stars} of 3 stars. ${starWord(stars)}`}>
        {[1, 2, 3].map((i) => (
          <Ionicons
            key={i}
            name={i <= stars ? "star" : "star-outline"}
            size={i === 2 ? 52 : 42}
            color={i <= stars ? colors.premium : colors.textFaint}
            style={i === 2 ? styles.middleStar : undefined}
          />
        ))}
      </View>
      <Text style={styles.word}>{starWord(stars)}</Text>
      <Text style={styles.hint}>{starHint(grade, stars)}</Text>
      {grade.octaveShift !== 0 ? (
        <Text style={styles.hint}>You sang it {grade.octaveShift > 0 ? "higher up" : "lower down"}. That's fine!</Text>
      ) : null}
      <View style={styles.marks}>
        {grade.notes.map((g) => {
          const n = notes[g.index];
          if (!n) return null;
          const color = statusColor(g.status);
          return (
            <View key={g.index} style={[styles.mark, { borderColor: color }]}>
              <Text style={[styles.markSolfa, { color }]}>{n.solfa}{n.octaveMark}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.legend}>Green spot on · amber close · red try again · grey not heard</Text>
      {earned ? <Text style={styles.earned}>{earned}</Text> : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    result: {
      marginTop: spacing.xs,
      backgroundColor: c.premiumSoft,
      borderRadius: radii.lg,
      borderWidth: 1.5,
      borderColor: c.premiumBorder,
      padding: spacing.md,
      gap: spacing.sm,
      alignItems: "center",
    },
    stars: { flexDirection: "row", alignItems: "flex-end", gap: spacing.xs },
    middleStar: { marginBottom: 6 },
    word: { ...typography.title, color: c.text, fontSize: 26, textAlign: "center" },
    hint: { ...typography.body, color: c.textMuted, textAlign: "center", lineHeight: 20 },
    marks: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: spacing.xs },
    mark: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: 2, backgroundColor: c.surface },
    markSolfa: { ...typography.mono, fontSize: 17 },
    legend: { ...typography.caption, color: c.textFaint, textAlign: "center", lineHeight: 16 },
    earned: { ...typography.label, color: c.premium, fontFamily: fonts.bold, textAlign: "center", fontSize: 15 },
  });
