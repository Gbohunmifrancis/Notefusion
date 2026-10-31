/**
 * The day's three quests (the game-coloured Practice, as the web's `questsCard`): each with its bar, and the chest they
 * open — its XP on top of the day's cap — shut until all three are done, then open, "Chest opened!". Read off the
 * server's `progress.quests`; the phone reports nothing.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "../Card";
import { Chest } from "./GameGlyphs";
import type { DailyQuests } from "../../api/types";
import { gameColorsFor, toneText } from "../../design/gameColors";
import { fonts, spacing, typography, type Palette } from "../../design/theme";
import { useTheme, useThemedStyles } from "../../lib/theme";
import { chestWords, questProgress } from "../../lib/practiceArcade";

export function QuestsCard({ quests }: { quests: DailyQuests }) {
  const { mode, palette: c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const g = gameColorsFor(mode);
  const open = quests.chestOpened;
  const words = chestWords(quests);
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">Daily quests</Text>
        <View style={styles.chest} accessible accessibilityLabel={open ? `Chest opened, ${quests.chestXp} XP` : `Chest: ${quests.chestXp} XP for all three`}>
          <Chest open={open} width={30} color={open ? g.tones.green.fill : g.tones.orange.fill} />
          <Text style={[styles.chestText, { color: open ? c.successText : toneText(mode, "orange") }]}>{words.chest}</Text>
        </View>
      </View>
      {quests.quests.map((q) => {
        const pr = questProgress(q);
        return (
          <View key={q.code} style={styles.quest} accessible accessibilityLabel={`${q.title}: ${pr.text}${q.done ? ", done" : ""}`}>
            <View style={styles.row}>
              <Text style={styles.questTitle}>{q.title}</Text>
              <Text style={[styles.count, q.done && { color: c.successText }]}>{q.done ? "Done" : pr.text}</Text>
            </View>
            <View style={styles.track}>
              {pr.fraction > 0 ? (
                <View style={[styles.fill, { width: `${Math.round(pr.fraction * 100)}%`, backgroundColor: q.done ? g.tones.green.fill : g.tones.orange.fill }]}>
                  <View style={styles.shine} />
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
      <Text style={[styles.note, open && styles.noteOpen]} accessibilityLiveRegion="polite">{words.note}</Text>
    </Card>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { marginBottom: spacing.md, gap: spacing.md },
    head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    title: { ...typography.heading, color: c.text },
    chest: { flexDirection: "row", alignItems: "center", gap: 6 },
    chestText: { fontFamily: fonts.bold, fontSize: 14 },
    quest: { gap: 6 },
    row: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
    questTitle: { fontFamily: fonts.semibold, fontSize: 15, color: c.text, flexShrink: 1 },
    count: { fontFamily: fonts.bold, fontSize: 13, color: c.textMuted },
    track: { height: 14, borderRadius: 7, backgroundColor: c.surfaceAlt, overflow: "hidden" },
    fill: { height: 14, borderRadius: 7, overflow: "hidden" },
    /** The chunky fill's highlight along its top, as the web's inset. */
    shine: { position: "absolute", left: 6, right: 6, top: 3, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.35)" },
    note: { ...typography.caption, color: c.textMuted, fontSize: 13, lineHeight: 18 },
    noteOpen: { color: c.text, fontFamily: fonts.semibold },
  });
