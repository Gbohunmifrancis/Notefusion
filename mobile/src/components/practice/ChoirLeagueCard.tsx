/**
 * The choir's practice league this week (`GET /api/choirs/mine/league`): the top five and the singer's own place,
 * XP from marked takes since Monday, by the same rules as their own XP. Shown on the Practice tab to a choir's
 * director and singers while its plan runs. The web's Practice view has the same card (`practice-view.js` leagueCard).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "../Card";
import type { ChoirLeague } from "../../api/types";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useThemedStyles } from "../../lib/theme";
import { leagueHeadline, leagueRows } from "../../lib/practiceProgress";

export function ChoirLeagueCard({ league }: { league: ChoirLeague }) {
  const styles = useThemedStyles(makeStyles);
  const resets = new Date(league.resetsAtUtc);
  const when = `${resets.toLocaleDateString(undefined, { weekday: "long" })} at ${resets.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">Choir league</Text>
        <Text style={styles.choir} numberOfLines={1}>{league.choirName}</Text>
      </View>
      <Text style={styles.headline}>{leagueHeadline(league.entries)}</Text>
      {leagueRows(league.entries, 5).map(({ entry, gapBefore }) => (
        <View key={`${entry.rank}-${entry.name}-${entry.isYou}`}>
          {gapBefore ? <Text style={styles.gap} accessibilityElementsHidden importantForAccessibility="no">⋯</Text> : null}
          <View
            style={[styles.row, entry.isYou && styles.rowYou]}
            accessible
            accessibilityLabel={`Place ${entry.rank}: ${entry.isYou ? "you" : entry.name}, ${entry.xp} XP`}
          >
            <Text style={styles.rank}>{entry.rank}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {entry.isYou ? "You" : entry.name}
              {entry.isDirector ? <Text style={styles.director}> · director</Text> : null}
            </Text>
            <Text style={styles.xp}>{entry.xp} XP</Text>
          </View>
        </View>
      ))}
      <Text style={styles.note}>Marked takes since Monday, by the same rules as your XP. A new week starts {when}.</Text>
    </Card>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { marginBottom: spacing.md, gap: spacing.sm },
    head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
    title: { ...typography.heading, color: c.text },
    choir: { ...typography.caption, color: c.textMuted, flexShrink: 1 },
    headline: { fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: c.surfaceAlt },
    rowYou: { backgroundColor: c.accentSoft, borderWidth: 2, borderColor: c.accent },
    rank: { width: 24, fontFamily: fonts.bold, fontSize: 15, color: c.textMuted, fontVariant: ["tabular-nums"] },
    name: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    director: { fontFamily: fonts.regular, color: c.textMuted },
    xp: { fontFamily: fonts.bold, fontSize: 15, color: c.text, fontVariant: ["tabular-nums"] },
    gap: { textAlign: "center", color: c.textMuted, marginVertical: -2 },
    note: { ...typography.caption, color: c.textFaint },
  });
