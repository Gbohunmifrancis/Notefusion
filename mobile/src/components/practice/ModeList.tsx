/**
 * "More ways to practise" (board c-practice/6a): one quiet grouped list of the modes the server says are live, each a
 * tile, a name and a line, and a chevron; or, `grid`, two columns of an icon and the name (board s-practice-fun/s1). A list, never a wall of tiles: the path card stays the hero above it.
 * Playful's tiles take the warm play colour; Focused's are neutral with ink icons (e-icons board 05): the blue stays
 * on the one thing to press. Each mode is drawn as what you do in it.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "../Icon";
import { Touchable } from "../Touchable";
import type { PracticeModeId, PracticeTrack } from "../../api/types";
import type { ModeRow } from "../../lib/practiceModes";
import { fonts, motion, spacing, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";

export const MODE_ICON: Record<PracticeModeId, IconName> = {
  "warm-up": "warm-up",
  "pitch-match": "pitch",
  scales: "scales",
  runs: "runs",
  intervals: "intervals",
  harmony: "harmony",
  rhythm: "rhythm",
};

export function ModeList({
  rows,
  track,
  onOpen,
  grid = false,
}: {
  rows: readonly ModeRow[];
  track: PracticeTrack | null;
  onOpen: (id: PracticeModeId) => void;
  /** Two columns of small tiles, an icon and the name (board s-practice-fun/s1): the Practice tab's compact form. */
  grid?: boolean;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const playful = track === "playful";
  if (grid) {
    return (
      <View style={styles.grid}>
        {rows.map((r) => (
          <Touchable
            key={r.id}
            onPress={() => onOpen(r.id)}
            scaleTo={motion.scale.row}
            haptic="light"
            radius={14}
            accessibilityRole="button"
            accessibilityLabel={[r.title, r.subtitle, r.value].filter(Boolean).join(". ")}
            style={styles.cell}
          >
            <View style={styles.cellInner}>
              <Icon name={MODE_ICON[r.id]} size={20} color={playful ? c.play : c.icon} />
              <Text style={styles.cellTitle} numberOfLines={1}>{r.title}</Text>
            </View>
          </Touchable>
        ))}
      </View>
    );
  }
  return (
    <View style={styles.group}>
      {rows.map((r, i) => (
        <Touchable
          key={r.id}
          onPress={() => onOpen(r.id)}
          scaleTo={motion.scale.row}
          haptic="light"
          accessibilityRole="button"
          accessibilityLabel={[r.title, r.subtitle, r.value].filter(Boolean).join(". ")}
        >
          <View style={styles.row}>
            {i > 0 ? <View style={styles.rule} /> : null}
            <View style={[styles.tile, playful && styles.tilePlay]}>
              <Icon name={MODE_ICON[r.id]} size={22} color={playful ? c.play : c.icon} />
            </View>
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={1}>{r.title}</Text>
              <Text style={styles.subtitle} numberOfLines={2}>{r.subtitle}</Text>
            </View>
            {r.value ? <Text style={styles.value}>{r.value}</Text> : null}
            <Icon name="chevron" size={16} color={c.textFaint} />
          </View>
        </Touchable>
      ))}
    </View>
  );
}

const TILE = 40;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    group: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 16, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 64, paddingHorizontal: 14, paddingVertical: 10 },
    rule: { position: "absolute", top: 0, right: 0, left: 14 + TILE + 14, height: StyleSheet.hairlineWidth, backgroundColor: c.border },
    tile: { width: TILE, height: TILE, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: c.sheetTile },
    tilePlay: { backgroundColor: c.playSoft },
    text: { flex: 1, minWidth: 0 },
    title: { fontFamily: fonts.semibold, fontSize: 16, color: c.text },
    subtitle: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19, color: c.textMuted, marginTop: 2 },
    value: { fontFamily: fonts.medium, fontSize: 13, color: c.textFaint, marginRight: spacing.xs },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    cell: { width: "48%", flexGrow: 1 },
    cellInner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 52,
      paddingHorizontal: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    cellTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: c.text },
  });
