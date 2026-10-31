/**
 * The Practice tab's top bar (the game-coloured Practice, as the web's `topBar`): the level's emblem and name, the
 * streak's flame and days, the XP with its gem, and the day's quests as a chip. The first three open "Your progress"
 * (`PracticeProgress`: the stat cards, the week and the badges); the chip takes the singer to the quests card. Every
 * number is the server's progress.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Touchable } from "../Touchable";
import { Art } from "./Art";
import { Chest, Gem } from "./GameGlyphs";
import type { PracticeProgress } from "../../api/types";
import { gameColorsFor, toneText } from "../../design/gameColors";
import { fonts, radii, spacing, type Palette } from "../../design/theme";
import { useTheme, useThemedStyles } from "../../lib/theme";
import { flameArt, levelArt } from "../../lib/practiceTrack";
import { progressStrip } from "../../lib/practiceModes";
import { questsChip } from "../../lib/practiceArcade";

export function PracticeTopBar({
  progress,
  onOpenProgress,
  onOpenQuests,
}: {
  progress: PracticeProgress;
  onOpenProgress: () => void;
  onOpenQuests: () => void;
}) {
  const { mode, palette: c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const g = gameColorsFor(mode);
  const strip = progressStrip(progress);
  const chip = questsChip(progress.quests);
  const streakOn = progress.streak.current > 0;
  const week = progress.weeklyGoal;
  return (
    <View style={styles.bar}>
      <Touchable
        onPress={onOpenProgress}
        radius={radii.md}
        style={styles.stats}
        accessibilityRole="button"
        accessibilityLabel={`${strip.label} ${week.daysDone} of ${week.target} days this week. Your progress`}
      >
        <View style={styles.statsRow}>
          <View style={[styles.item, styles.level]}>
            <Art name={levelArt(progress.level.index)} width={28} />
            <Text style={styles.levelName} numberOfLines={1}>{progress.level.name}</Text>
          </View>
          <View style={styles.item}>
            <Art name={flameArt(progress.streak)} width={24} />
            <Text style={[styles.value, streakOn && { color: toneText(mode, "orange") }]}>{progress.streak.current}</Text>
          </View>
          <View style={[styles.item, styles.xp]}>
            <Gem color={g.gem} size={20} />
            <Text style={[styles.value, { color: toneText(mode, "cyan") }]} numberOfLines={1}>{strip.xp}</Text>
          </View>
        </View>
      </Touchable>
      {chip ? (
        <Touchable
          onPress={onOpenQuests}
          radius={radii.pill}
          accessibilityRole="button"
          accessibilityLabel={`${chip.label}${chip.open ? ". Chest opened" : ""}. Show the quests`}
        >
          <View style={styles.chip}>
            <Chest open={chip.open} width={24} color={chip.open ? g.tones.green.fill : g.tones.orange.fill} />
            <Text style={[styles.value, { color: c.text }]}>{chip.done}/{chip.total}</Text>
          </View>
        </Touchable>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingBottom: spacing.sm,
      marginBottom: spacing.md,
      borderBottomWidth: 2,
      borderBottomColor: c.border,
    },
    stats: { flex: 1, minWidth: 0 },
    statsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, minHeight: 48, paddingRight: 4 },
    item: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 },
    level: { flexShrink: 1 },
    xp: { flexShrink: 1 },
    levelName: { fontFamily: fonts.bold, fontSize: 16, color: c.text, flexShrink: 1 },
    value: { fontFamily: fonts.bold, fontSize: 16, color: c.text },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 44,
      paddingHorizontal: 10,
      borderRadius: radii.pill,
      borderWidth: 2,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
  });
