/**
 * GradeMarks — a marked take, as Sing it and the daily drill show it: the score, the one-line verdict, every
 * note green (in tune), amber (close), red (wrong) or grey (not sung) with its cents off, and — when the
 * server recorded the take as practice — the one line it earned (XP, streak, a badge or a level).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { GradeResult, NoteEvent } from "../api/types";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { rewardMoment } from "../lib/practiceProgress";

export function GradeMarks({ grade, notes }: { grade: GradeResult; notes: readonly NoteEvent[] }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const earned = rewardMoment(grade.reward);

  const statusColor = (s: string) =>
    s === "hit" ? colors.success : s === "near" ? colors.warning : s === "wrong" ? colors.textMuted : colors.textFaint;

  return (
    <View style={styles.result}>
      <View style={styles.scoreRow}>
        <Text style={[styles.score, { color: grade.score >= 80 ? colors.success : grade.score >= 50 ? colors.warning : colors.textMuted }]}>{grade.score}</Text>
        <View style={styles.scoreText}>
          <Text style={styles.summary}>{grade.summary}</Text>
          {grade.octaveShift !== 0 ? (
            <Text style={styles.meta}>Sung {grade.octaveShift > 0 ? "an octave up" : "an octave down"} — that's fine.</Text>
          ) : null}
        </View>
      </View>
      <View style={styles.marks}>
        {grade.notes.map((g) => {
          const n = notes[g.index];
          if (!n) return null;
          return (
            <View key={g.index} style={[styles.mark, { borderColor: statusColor(g.status) }]}>
              <Text style={[styles.markSolfa, { color: statusColor(g.status) }]}>{n.solfa}{n.octaveMark}</Text>
              <Text style={styles.markCents}>
                {g.status === "missed" ? "—" : g.cents == null ? "" : `${g.cents > 0 ? "+" : ""}${Math.round(g.cents)}`}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.legend}>Green in tune · amber close · grey off the note · — not sung. Numbers are cents off.</Text>
      {earned ? <Text style={styles.earned}>{earned.line}</Text> : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    result: { marginTop: spacing.xs, backgroundColor: c.surfaceAlt, borderRadius: radii.md, padding: spacing.md, gap: spacing.sm },
    scoreRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    score: { ...typography.display, minWidth: 64, textAlign: "center" },
    scoreText: { flex: 1 },
    summary: { ...typography.body, color: c.text, lineHeight: 20 },
    meta: { ...typography.caption, color: c.textMuted, marginTop: 2 },
    marks: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    mark: { minWidth: 40, alignItems: "center", paddingVertical: 4, paddingHorizontal: 6, borderRadius: radii.sm, borderWidth: 1.5, backgroundColor: c.surface },
    markSolfa: { ...typography.mono, fontSize: 15 },
    markCents: { ...typography.caption, color: c.textFaint, fontSize: 10 },
    legend: { ...typography.caption, color: c.textFaint, lineHeight: 16 },
    earned: { ...typography.label, color: c.accent, fontFamily: fonts.semibold },
  });
