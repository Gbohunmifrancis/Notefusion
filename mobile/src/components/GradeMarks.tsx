/**
 * GradeMarks — a marked take, as Sing it and the daily drill show it: the score, the one-line verdict, every
 * note with its cents off, told by shape as well as colour (lib/markShape): ✓ green in tune, ~ amber close,
 * struck through grey off the note, dashed with – not sung — and, when the server recorded the take as
 * practice, the one line it earned (XP, streak, a badge or a level).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { GradeResult, NoteEvent } from "../api/types";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { rewardMoment } from "../lib/practiceProgress";
import { FOCUSED_MARK_LEGEND, markGlyph, markLabel } from "../lib/markShape";

export function GradeMarks({ grade, notes }: { grade: GradeResult; notes: readonly NoteEvent[] }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const earned = rewardMoment(grade.reward);

  const statusColor = (s: string) =>
    s === "hit" ? colors.success : s === "near" ? colors.warning : s === "wrong" ? colors.textMuted : colors.textFaint;
  // The letter is a word: the deep shade in Day; the border keeps the bright hue.
  const statusText = (s: string) =>
    s === "hit" ? colors.successText : s === "near" ? colors.warningText : s === "wrong" ? colors.textMuted : colors.textFaint;

  return (
    <View style={styles.result}>
      <View style={styles.scoreRow}>
        <Text style={[styles.score, { color: grade.score >= 80 ? colors.successText : grade.score >= 50 ? colors.warningText : colors.textMuted }]}>{grade.score}</Text>
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
          const glyph = markGlyph(g.status);
          return (
            <View
              key={g.index}
              style={[styles.mark, { borderColor: statusColor(g.status) }, g.status === "missed" && styles.markMissed]}
              accessible
              accessibilityLabel={markLabel(`${n.solfa}${n.octaveMark}`, g.status, g.cents)}
            >
              <View style={styles.markRow}>
                <Text style={[styles.markSolfa, { color: statusText(g.status) }, g.status === "wrong" && styles.markOff]}>
                  {n.solfa}{n.octaveMark}
                </Text>
                {glyph ? <Text style={[styles.markGlyph, { color: statusText(g.status) }]}>{glyph}</Text> : null}
              </View>
              <Text style={styles.markCents}>
                {g.status === "missed" ? "—" : g.cents == null ? "" : `${g.cents > 0 ? "+" : ""}${Math.round(g.cents)}`}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.legend}>{FOCUSED_MARK_LEGEND}</Text>
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
    markMissed: { borderStyle: "dashed" },
    markRow: { flexDirection: "row", alignItems: "baseline", gap: 2 },
    markSolfa: { ...typography.mono, fontSize: 15 },
    markOff: { textDecorationLine: "line-through" },
    markGlyph: { fontFamily: fonts.bold, fontSize: 11 },
    markCents: { ...typography.caption, color: c.textFaint, fontSize: 10 },
    legend: { ...typography.caption, color: c.textFaint, fontSize: 13, lineHeight: 18 },
    earned: { ...typography.label, color: c.accent, fontFamily: fonts.semibold },
  });
