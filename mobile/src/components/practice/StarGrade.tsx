/**
 * StarGrade — a marked take as Playful shows it: one to three stars and a friendly word instead of the number, each
 * note told by shape as well as colour (lib/markShape: ✓ spot on, ~ close in ink on a dashed ink ring, struck through
 * try again, dashed grey not heard) without the cents, and the line it earned. Amber is left to the problem sign. The
 * marks are the same as Focused's (`GradeMarks`); only the telling differs.
 */

import React from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

import type { GradeResult, NoteEvent } from "../../api/types";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { playfulRewardLine, starHint, starsArt, starsFor, starWord } from "../../lib/practiceTrack";
import { PLAYFUL_MARK_LEGEND, markGlyph, markLabel } from "../../lib/markShape";
import { Art } from "./Art";
import { useMarkReveal } from "./useMarkReveal";

export function StarGrade({
  grade,
  notes,
  showEarned = true,
  fresh = false,
}: {
  grade: GradeResult;
  notes: readonly NoteEvent[];
  /** False when the screen has already said the line it earned (Practice's reward toast): it is said once. */
  showEarned?: boolean;
  /** A mark that has just come back: its notes land one by one, then the stars and the word (`useMarkReveal`). */
  fresh?: boolean;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const stars = starsFor(grade.score);
  const earned = showEarned ? playfulRewardLine(grade.reward) : null;
  const reveal = useMarkReveal(grade, notes, fresh);
  // The stars and the word wait for the notes, in their place, so nothing below them moves when they come.
  const after = { opacity: reveal.done ? 1 : 0 };

  const statusColor = (s: string) =>
    s === "hit" ? colors.success : s === "near" ? colors.text : s === "wrong" ? colors.textMuted : colors.textFaint;
  // The letter is a word: the deep shade in Day; the ring keeps the bright hue.
  const statusText = (s: string) =>
    s === "hit" ? colors.successText : s === "near" ? colors.text : s === "wrong" ? colors.textMuted : colors.textFaint;

  return (
    <View style={styles.result}>
      <View style={after} accessible accessibilityRole="image" accessibilityLabel={`${stars} of 3 stars. ${starWord(stars)}`}>
        <Art name={starsArt(stars)} width={148} />
      </View>
      <Text style={[styles.word, after]}>{starWord(stars)}</Text>
      <Text style={[styles.hint, after]}>{starHint(grade, stars)}</Text>
      {grade.octaveShift !== 0 ? (
        <Text style={styles.hint}>You sang it {grade.octaveShift > 0 ? "higher up" : "lower down"}. That's fine!</Text>
      ) : null}
      <View style={styles.marks}>
        {grade.notes.map((g, i) => {
          const n = notes[g.index];
          if (!n) return null;
          const glyph = markGlyph(g.status);
          return (
            <Animated.View
              key={g.index}
              style={[styles.mark, { borderColor: statusColor(g.status) }, (g.status === "missed" || g.status === "near") && styles.markDashed, reveal.markStyle(i)]}
              accessible
              accessibilityLabel={markLabel(`${n.solfa}${n.octaveMark}`, g.status, g.cents, true)}
            >
              <View style={styles.markRow}>
                <Text style={[styles.markSolfa, { color: statusText(g.status) }, g.status === "wrong" && styles.markOff]}>
                  {n.solfa}{n.octaveMark}
                </Text>
                {glyph ? <Text style={[styles.markGlyph, { color: statusText(g.status) }]}>{glyph}</Text> : null}
              </View>
            </Animated.View>
          );
        })}
      </View>
      <Text style={styles.legend}>{PLAYFUL_MARK_LEGEND}</Text>
      {earned && reveal.done ? <Text style={styles.earned}>{earned}</Text> : null}
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
    mark: { minWidth: 44, minHeight: 44, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: 2, backgroundColor: c.surface },
    markDashed: { borderStyle: "dashed" },
    markRow: { flexDirection: "row", alignItems: "baseline", gap: 2 },
    markSolfa: { ...typography.mono, fontSize: 17 },
    markOff: { textDecorationLine: "line-through" },
    markGlyph: { fontFamily: fonts.bold, fontSize: 12 },
    legend: { ...typography.caption, color: c.textFaint, textAlign: "center", fontSize: 13, lineHeight: 18 },
    earned: { ...typography.label, color: c.play, fontFamily: fonts.bold, textAlign: "center", fontSize: 15 },
  });
