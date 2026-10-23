/**
 * The Practice tab's "Quick games" row (board s-practice-fun/s1): three tiles side by side, each the game's icon on its
 * tile, its name and one line. Playful's tiles take the warm play colour; Focused's are neutral with ink icons, as the
 * modes' list is: the blue stays on the one thing to press, the drill.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "../Icon";
import { Touchable } from "../Touchable";
import type { PracticeGameId, PracticeTrack } from "../../api/types";
import { gameTiles } from "../../lib/practiceGames";
import { fonts, motion, radii, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";

export function GameTiles({ track, onOpen }: { track: PracticeTrack | null; onOpen: (game: PracticeGameId) => void }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const playful = track === "playful";
  return (
    <View style={styles.row}>
      {gameTiles(track).map((g) => (
        <Touchable
          key={g.id}
          onPress={() => onOpen(g.id)}
          scaleTo={motion.scale.row}
          haptic="light"
          radius={radii.lg}
          accessibilityRole="button"
          accessibilityLabel={`${g.title}. ${g.line}`}
          style={styles.cell}
        >
          <View style={[styles.card, playful && styles.cardPlay]}>
            <View style={[styles.tile, playful && styles.tilePlay]}>
              <Icon name={g.icon} size={22} color={playful ? c.play : c.icon} />
            </View>
            <Text style={styles.title} numberOfLines={2}>{g.title}</Text>
            <Text style={styles.line} numberOfLines={2}>{g.line}</Text>
          </View>
        </Touchable>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: "row", gap: 10 },
    cell: { flex: 1 },
    card: { flex: 1, minHeight: 128, padding: 12, gap: 6, borderRadius: radii.lg, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
    cardPlay: { borderColor: c.playBorder },
    tile: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: c.sheetTile },
    tilePlay: { backgroundColor: c.playSoft },
    title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 19, color: c.text },
    line: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 17, color: c.textMuted },
  });
