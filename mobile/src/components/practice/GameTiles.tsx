/**
 * The Practice tab's arcade (board s-practice-fun/s1, game-coloured as the web's `arcadeSection`): the quick games as
 * chunky tiles two by two, each in its own colour on a darker lip — Which note? blue, Staff to solfa orange, Name that
 * hymn cyan, Which scale? pink — with its name, one line, and the level kept on this phone (and the best, when higher).
 * The games never end: each opens at its kept level and climbs stage after stage.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "../Icon";
import { Touchable } from "../Touchable";
import type { PracticeGameId, PracticeTrack } from "../../api/types";
import { gameTiles } from "../../lib/practiceGames";
import { tileLevelLine, type ArcadeKept, type GameTone } from "../../lib/practiceArcade";
import { gameColorsFor } from "../../design/gameColors";
import { fonts, motion, radii } from "../../design/theme";
import { useTheme, useThemedStyles } from "../../lib/theme";

const GAME_TONE: Record<PracticeGameId, GameTone> = { "which-note": "blue", staff: "orange", hymn: "cyan", "which-scale": "pink" };
const LIP = 5;

export function GameTiles({
  track,
  kept,
  onOpen,
}: {
  track: PracticeTrack | null;
  /** Each game's level kept on this phone; null until read. */
  kept: Partial<Record<PracticeGameId, ArcadeKept>> | null;
  onOpen: (game: PracticeGameId) => void;
}) {
  const { mode } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const g = gameColorsFor(mode);
  return (
    <View style={styles.grid}>
      {gameTiles(track).map((t) => {
        const tone = g.tones[GAME_TONE[t.id]];
        const level = kept?.[t.id];
        return (
          <Touchable
            key={t.id}
            onPress={() => onOpen(t.id)}
            scaleTo={motion.scale.default}
            haptic="light"
            radius={radii.lg}
            accessibilityRole="button"
            accessibilityLabel={`${t.title}. ${t.line}${level ? `. Level ${level.level}, best ${level.best}` : ""}`}
            style={styles.cell}
          >
            <View style={[styles.card, { backgroundColor: tone.fill, borderBottomColor: tone.lip }]}>
              <Icon name={t.icon} size={26} strokeWidth={2.2} color={tone.ink} />
              <Text style={[styles.title, { color: tone.ink }]} numberOfLines={2}>{t.title}</Text>
              <Text style={[styles.line, { color: tone.ink }]} numberOfLines={2}>{level ? tileLevelLine(level) : t.line}</Text>
            </View>
          </Touchable>
        );
      })}
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    /** Two a row on every phone: half the row less half the gap. */
    cell: { width: "48%", flexGrow: 1 },
    card: { minHeight: 112, padding: 12, gap: 4, borderRadius: radii.lg, borderBottomWidth: LIP },
    title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 20, marginTop: 4 },
    line: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, opacity: 0.85 },
  });
