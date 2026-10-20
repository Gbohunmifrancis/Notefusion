/**
 * A practice mode's marked take (boards c-practice/6b, 6c): the server's score and its own summary, then the marks,
 * then what the take earned. Focused shows the number and each note's cents; Playful shows stars and a friendly word
 * and the notes coloured without numbers. Green is in tune, amber close, grey off (never red), dashed not heard.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PracticeReward } from "../../api/types";
import type { MarkTone } from "../../lib/practiceModes";
import { rewardMoment } from "../../lib/practiceProgress";
import { playfulRewardLine, starsArt, starsFor, starWord } from "../../lib/practiceTrack";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { Art } from "./Art";
import { Icon } from "../Icon";

export interface ResultMark {
  key: string | number;
  text: string;
  /** The small line under it: cents ("+6"), or "—". */
  sub?: string;
  tone: MarkTone;
}

export function ModeResult({
  score,
  summary,
  sub,
  marks,
  legend,
  reward,
  playful,
  children,
}: {
  score: number;
  summary: string;
  /** The muted line under the summary ("In tune overall", "Clean at 80%"). */
  sub?: string | null;
  marks: readonly ResultMark[];
  legend?: string | null;
  reward: PracticeReward | null | undefined;
  playful: boolean;
  /** Anything that belongs on the card under the marks (a run's two lines, "Replay my take"). */
  children?: React.ReactNode;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const stars = starsFor(score);
  const earned = playful ? playfulRewardLine(reward) : rewardMoment(reward)?.line ?? null;
  const toneColor = (t: MarkTone) => (t === "hit" ? c.success : t === "near" ? c.warning : t === "off" ? c.textMuted : c.textFaint);
  // The mark's letter is a word: the deep shade in Day; the border keeps the bright hue.
  const toneText = (t: MarkTone) => (t === "hit" ? c.successText : t === "near" ? c.warningText : t === "off" ? c.textMuted : c.textFaint);

  return (
    <View style={[styles.card, playful && styles.cardPlay]} accessibilityLiveRegion="polite">
      {playful ? (
        <View style={styles.starsBlock} accessible accessibilityRole="image" accessibilityLabel={`${stars} of 3 stars. ${starWord(stars)}. ${summary}`}>
          <Art name={starsArt(stars)} width={132} />
          <Text style={styles.word}>{starWord(stars)}</Text>
          <Text style={styles.subCenter}>{summary}</Text>
        </View>
      ) : (
        <View style={styles.scoreRow} accessible accessibilityLabel={`Score ${score}. ${summary}${sub ? ` ${sub}` : ""}`}>
          <Text style={[styles.score, { color: score >= 80 ? c.successText : score >= 50 ? c.warningText : c.textMuted }]}>{score}</Text>
          <View style={styles.scoreText}>
            <Text style={styles.summary}>{summary}</Text>
            {sub ? <Text style={styles.sub}>{sub}</Text> : null}
          </View>
        </View>
      )}
      {marks.length > 0 ? (
        <View style={[styles.marks, playful && styles.marksCenter]}>
          {marks.map((m) => {
            const color = toneColor(m.tone);
            return (
              <View
                key={m.key}
                style={[styles.mark, { borderColor: m.tone === "off" || m.tone === "missed" ? c.border : color }, m.tone === "missed" && styles.markMissed]}
                accessible
                accessibilityLabel={`${m.text}: ${m.tone === "hit" ? "in tune" : m.tone === "near" ? "close" : m.tone === "off" ? "off" : "not heard"}${!playful && m.sub ? `, ${m.sub}` : ""}`}
              >
                <Text style={[styles.markText, { color: toneText(m.tone) }, m.tone === "off" && styles.markOff]}>{m.text}</Text>
                {!playful && m.sub ? <Text style={styles.markSub}>{m.sub}</Text> : null}
              </View>
            );
          })}
        </View>
      ) : null}
      {legend ? <Text style={styles.legend}>{legend}</Text> : null}
      {children}
      {earned ? (
        <View style={[styles.earnedRow, playful && styles.earnedCenter]}>
          <Icon name="reward" size={15} color={playful ? c.play : c.icon} />
          <Text style={[styles.earned, playful && { color: c.play }]}>{earned}</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
    cardPlay: { borderColor: c.playBorder, borderWidth: 1.5, backgroundColor: c.playSoft },
    scoreRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    score: { fontFamily: fonts.bold, fontSize: 40, letterSpacing: -0.8, minWidth: 60 },
    scoreText: { flex: 1, minWidth: 0 },
    summary: { ...typography.body, color: c.text, fontSize: 15, lineHeight: 21 },
    sub: { ...typography.caption, color: c.textMuted, fontSize: 13, marginTop: 2 },
    starsBlock: { alignItems: "center", gap: 4 },
    word: { ...typography.title, color: c.text, fontSize: 24, textAlign: "center" },
    subCenter: { ...typography.body, color: c.textMuted, textAlign: "center", lineHeight: 20 },
    marks: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
    marksCenter: { justifyContent: "center" },
    // Eight to a row at 360 px: a set of pitch match, or a long run, reads on one line.
    mark: {
      minWidth: 35,
      minHeight: 44,
      paddingVertical: 5,
      paddingHorizontal: 3,
      borderRadius: 10,
      borderWidth: 1.5,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
    },
    markMissed: { borderStyle: "dashed" },
    markText: { ...typography.mono, fontSize: 17 },
    markOff: { textDecorationLine: "line-through" },
    markSub: { ...typography.mono, fontSize: 11, color: c.textFaint },
    legend: { ...typography.caption, color: c.textFaint, lineHeight: 16 },
    earnedRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    earnedCenter: { justifyContent: "center" },
    earned: { fontFamily: fonts.semibold, fontSize: 14, color: c.link },
  });
