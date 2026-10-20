/**
 * StarGrade — a marked take as Playful shows it: one to three stars and a friendly word instead of the number, each
 * note coloured (green spot on, amber close, red try again, grey not heard) without the cents, and the line it earned.
 * The marks are the same as Focused's (`GradeMarks`); only the telling differs.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { GradeResult, NoteEvent } from "../../api/types";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { playfulRewardLine, starHint, starsArt, starsFor, starWord } from "../../lib/practiceTrack";
import { Art } from "./Art";

export function StarGrade({ grade, notes }: { grade: GradeResult; notes: readonly NoteEvent[] }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const stars = starsFor(grade.score);
  const earned = playfulRewardLine(grade.reward);

  const statusColor = (s: string) =>
    s === "hit" ? colors.success : s === "near" ? colors.warning : s === "wrong" ? colors.textMuted : colors.textFaint;
  // The letter is a word: the deep shade in Day; the ring keeps the bright hue.
  const statusText = (s: string) =>
    s === "hit" ? colors.successText : s === "near" ? colors.warningText : s === "wrong" ? colors.textMuted : colors.textFaint;

  return (
    <View style={styles.result}>
      <View accessible accessibilityRole="image" accessibilityLabel={`${stars} of 3 stars. ${starWord(stars)}`}>
        <Art name={starsArt(stars)} width={148} />
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
          return (
            <View key={g.index} style={[styles.mark, { borderColor: statusColor(g.status) }]}>
              <Text style={[styles.markSolfa, { color: statusText(g.status) }]}>{n.solfa}{n.octaveMark}</Text>
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
      backgroundColor: c.playSoft,
      borderRadius: radii.lg,
      borderWidth: 1.5,
      borderColor: c.playBorder,
      padding: spacing.md,
      gap: spacing.sm,
      alignItems: "center",
    },
    word: { ...typography.title, color: c.text, fontSize: 26, textAlign: "center" },
    hint: { ...typography.body, color: c.textMuted, textAlign: "center", lineHeight: 20 },
    marks: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: spacing.xs },
    mark: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: 2, backgroundColor: c.surface },
    markSolfa: { ...typography.mono, fontSize: 17 },
    legend: { ...typography.caption, color: c.textFaint, textAlign: "center", lineHeight: 16 },
    earned: { ...typography.label, color: c.play, fontFamily: fonts.bold, textAlign: "center", fontSize: 15 },
  });
