/**
 * "Your progress" (board s-practice-fun/s1): the streak and the level, the week and the badges — the cards the
 * Practice tab used to end on, now a page of their own that the tab's top line opens, so the tab is the next thing to
 * sing and the games. Every number is the server's (`GET /api/practice/progress`). Playful's badges are its sticker
 * book; Focused's a plain list; with no track yet, tiles.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { Icon } from "../Icon";
import { Card } from "../Card";
import { Art } from "./Art";
import type { PracticeBadge, PracticeDay, PracticeProgress, WeeklyGoal } from "../../api/types";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { levelFraction, nextLevelLine, sortBadges, streakLabel, streakLine, weekdayLetter, xpAmount } from "../../lib/practiceProgress";
import { badgeArt, flameArt, levelArt, stickerTilt } from "../../lib/practiceTrack";

export function ProgressCards({ progress }: { progress: PracticeProgress }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const playful = progress.track === "playful";
  const focused = progress.track === "focused";
  return (
    <>
      {/* ── Streak and level ───────────────────────────────────────────── */}
      <View style={styles.statsRow}>
        <Card style={styles.statCard}>
          <View style={styles.statHead}>
            <Art name={flameArt(progress.streak)} width={32} />
            <Text style={styles.statBig} accessibilityLabel={streakLabel(progress.streak.current, progress.streak.best)}>
              {progress.streak.current}
            </Text>
          </View>
          <Text style={styles.statLabel}>day streak</Text>
          <Text style={styles.statSub}>{streakLine(progress.streak)}</Text>
          {/* A freeze keeps a streak: with none running there is nothing for it to keep. */}
          {progress.streak.current > 0 ? (
            <View style={styles.footRow}>
              <Art name="freeze" width={16} style={!progress.streak.freezeAvailable && styles.spent} />
              <Text style={[styles.statFoot, styles.footText]}>
                {progress.streak.freezeAvailable ? "Streak freeze ready this week" : "Freeze used this week"}
              </Text>
            </View>
          ) : null}
        </Card>

        <Card style={styles.statCard}>
          <View style={styles.levelHead}>
            <Art name={levelArt(progress.level.index)} width={44} />
            <View style={styles.levelText}>
              <Text style={[styles.levelName, progress.level.name.length > 6 && styles.levelNameLong]} numberOfLines={2}>
                {progress.level.name}
              </Text>
              <Text style={styles.statLabel}>level {progress.level.index + 1} of 8</Text>
            </View>
          </View>
          <View style={styles.barRow}>
            <View
              style={styles.barTrack}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={`${xpAmount(progress.xp)}. ${nextLevelLine(progress.level)}`}
            >
              <View style={[styles.barFill, { width: `${Math.round(levelFraction(progress.level, progress.xp) * 100)}%` }]} />
            </View>
            {progress.level.nextName ? <Art name={levelArt(progress.level.index + 1)} width={22} /> : null}
          </View>
          <Text style={styles.statSub}>{xpAmount(progress.xp)}</Text>
          <Text style={styles.statFoot}>{nextLevelLine(progress.level)}</Text>
        </Card>
      </View>

      {/* ── This week ────────────────────────────────────────────────── */}
      <Card style={styles.card}>
        <View style={styles.weekRow}>
          <GoalRing goal={progress.weeklyGoal} styles={styles} colors={colors} />
          <View style={styles.weekText}>
            <Text style={styles.cardTitle}>
              {progress.weeklyGoal.daysDone} of {progress.weeklyGoal.target} days this week
            </Text>
            <Text style={styles.weekLine}>
              {progress.weeklyGoal.daysDone >= progress.weeklyGoal.target ? "Weekly goal met." : "Practise five days a week to meet the goal."}
            </Text>
          </View>
        </View>
        <View style={styles.days}>
          {progress.lastSevenDays.map((d) => (
            <DayDot key={d.date} day={d} styles={styles} colors={colors} />
          ))}
        </View>
        {/* The rule the hub's old footnote told, after the day's XP (board n-ux-low Q2b e). */}
        <Text style={styles.meta}>
          {progress.xpToday} of {progress.dailyXpCap} XP today · {playful ? "every singing game counts" : "every marked take counts"}
        </Text>
      </Card>

      {/* ── Badges: stickers on Playful, a plain list on Focused ──────── */}
      <Text style={styles.sectionTitle} accessibilityRole="header">{playful ? "My stickers" : "Badges"}</Text>
      {playful ? (
        <View style={styles.stickerGrid}>
          {sortBadges(progress.badges).map((b) => (
            <Sticker key={b.code} badge={b} styles={styles} />
          ))}
        </View>
      ) : focused ? (
        <Card style={styles.badgeList} padded={false}>
          {sortBadges(progress.badges).map((b, i) => (
            <BadgeRow key={b.code} badge={b} first={i === 0} styles={styles} colors={colors} />
          ))}
        </Card>
      ) : (
        <View style={styles.badgeGrid}>
          {sortBadges(progress.badges).map((b) => (
            <BadgeTile key={b.code} badge={b} styles={styles} />
          ))}
        </View>
      )}

    </>
  );
}

type Styles = ReturnType<typeof makeStyles>;

/**
 * The weekly goal as the art draws it: one arc per practice day of the goal, lit as the days are sung, and a ticked
 * disc in the middle once the week is met.
 */
function GoalRing({ goal, styles, colors }: { goal: WeeklyGoal; styles: Styles; colors: Palette }) {
  const size = 64;
  const stroke = 7;
  const c = size / 2;
  const r = c - stroke / 2 - 1;
  const n = Math.max(1, Math.min(7, goal.target));
  const done = Math.min(goal.daysDone, n);
  const met = goal.daysDone >= goal.target && goal.target > 0;
  const seg = 360 / n;
  const gap = n > 1 ? 14 : 0;
  const at = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  };
  return (
    <View
      style={styles.ring}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Weekly goal: ${goal.daysDone} of ${goal.target} days${met ? ", met" : ""}`}
    >
      <Svg width={size} height={size}>
        {n === 1 ? (
          <Circle cx={c} cy={c} r={r} stroke={done ? colors.success : colors.surfaceAlt} strokeWidth={stroke} fill="none" />
        ) : (
          Array.from({ length: n }, (_, i) => (
            <Path
              key={i}
              d={`M${at(i * seg + gap / 2)}A${r} ${r} 0 0 1 ${at((i + 1) * seg - gap / 2)}`}
              stroke={i < done ? colors.success : colors.surfaceAlt}
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
            />
          ))
        )}
        {met ? <Circle cx={c} cy={c} r={r - 9} fill={colors.success} /> : null}
      </Svg>
      {met ? <Icon name="check" size={22} strokeWidth={2.25} color={colors.bg} style={styles.ringTick} /> : null}
    </View>
  );
}

const DAY_A11Y: Record<PracticeDay["status"], string> = {
  done: "practised",
  frozen: "missed, kept by the streak freeze",
  missed: "missed",
  today: "today, not practised yet",
  none: "before your first practice",
};

function DayDot({ day, styles, colors }: { day: PracticeDay; styles: Styles; colors: Palette }) {
  return (
    <View style={styles.day} accessible accessibilityLabel={`${day.date}: ${DAY_A11Y[day.status]}`}>
      <View
        style={[
          styles.dayDot,
          // Practised in mint, as the ring beside it, with the tick in the canvas colour (board n-ux-low Q2a d).
          day.status === "done" && { backgroundColor: colors.success, borderColor: colors.success },
          day.status === "frozen" && { borderColor: "transparent" },
          day.status === "today" && { borderColor: colors.text, borderStyle: "dashed" },
          day.status === "none" && { opacity: 0.4 },
        ]}
      >
        {day.status === "done" ? <Icon name="check" size={14} strokeWidth={2.25} color={colors.bg} /> : null}
        {day.status === "frozen" ? <Art name="freeze" width={26} /> : null}
      </View>
      <Text style={styles.dayLetter}>{weekdayLetter(day.date)}</Text>
    </View>
  );
}

function badgeLabel(badge: PracticeBadge, sticker = false): string {
  return `${badge.title}${sticker ? " sticker" : ""}. ${badge.description} ${badge.earned ? "Earned." : `${badge.progress} of ${badge.target}.`}`;
}

/**
 * No track chosen yet: the badges as tiles under the picker. A locked one fades its picture only (board m-ux-medium
 * P5b), and its title goes muted: what it takes and how far along it is stay at full strength, to be read.
 */
function BadgeTile({ badge, styles }: { badge: PracticeBadge; styles: Styles }) {
  const locked = !badge.earned;
  return (
    <View style={styles.badge} accessible accessibilityLabel={badgeLabel(badge)}>
      <Art name={badgeArt(badge.code, badge.earned)} width={40} style={locked && styles.badgeArtLocked} />
      <Text style={[styles.badgeTitle, locked && styles.badgeTitleLocked]} numberOfLines={1}>{badge.title}</Text>
      <Text style={styles.badgeDesc} numberOfLines={2}>{badge.description}</Text>
      {locked ? (
        <View style={styles.badgeProgressRow}>
          <View style={styles.badgeTrack}>
            <View style={[styles.badgeFill, { width: `${Math.round((badge.progress / Math.max(1, badge.target)) * 100)}%` }]} />
          </View>
          <Text style={styles.badgeCount}>{badge.progress}/{badge.target}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Playful's sticker book: each badge its own die-cut sticker, tilted as if stuck by hand; locked ones grey and flat. */
function Sticker({ badge, styles }: { badge: PracticeBadge; styles: Styles }) {
  return (
    <View style={styles.sticker} accessible accessibilityLabel={badgeLabel(badge, true)}>
      <Art
        name={badgeArt(badge.code, badge.earned)}
        width={76}
        style={badge.earned ? { transform: [{ rotate: `${stickerTilt(badge.code)}deg` }] } : undefined}
      />
      <Text style={[styles.stickerTitle, !badge.earned && { color: styles.badgeDesc.color }]} numberOfLines={2}>{badge.title}</Text>
      {!badge.earned ? <Text style={styles.badgeCount}>{badge.progress}/{badge.target}</Text> : null}
    </View>
  );
}

/** Focused's badges: the same stickers, small and flat, in a plain list. */
function BadgeRow({ badge, first, styles, colors }: { badge: PracticeBadge; first: boolean; styles: Styles; colors: Palette }) {
  return (
    <View style={[styles.badgeRow, !first && styles.badgeRowRule]} accessible accessibilityLabel={badgeLabel(badge)}>
      <Art name={badgeArt(badge.code, badge.earned)} width={34} />
      <View style={styles.badgeRowText}>
        <Text style={[styles.badgeTitle, !badge.earned && { color: colors.textMuted }]}>{badge.title}</Text>
        <Text style={styles.badgeDesc} numberOfLines={1}>{badge.description}</Text>
      </View>
      <Text style={styles.badgeRowCount}>{badge.earned ? "Earned" : `${badge.progress}/${badge.target}`}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { marginBottom: spacing.md, gap: spacing.sm },
    cardTitle: { ...typography.label, color: c.text, fontSize: 16, fontFamily: fonts.bold },
    meta: { ...typography.caption, color: c.textMuted, fontSize: 13, lineHeight: 18 },
    sectionTitle: { ...typography.heading, color: c.text, marginTop: spacing.sm, marginBottom: spacing.sm },

    statsRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
    statCard: { flex: 1, gap: 2 },
    statHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    statBig: { ...typography.title, color: c.text, fontSize: 30 },
    levelName: { ...typography.title, color: c.text, fontSize: 24 },
    /** "Choir-ready" beside its emblem in half a phone's width: smaller, and free to break at the hyphen. */
    levelNameLong: { fontSize: 18, lineHeight: 21 },
    statLabel: { ...typography.caption, color: c.textMuted },
    statSub: { ...typography.label, color: c.text, fontSize: 13, marginTop: spacing.xs },
    statFoot: { ...typography.caption, color: c.textFaint, fontSize: 12 },
    footRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
    footText: { flex: 1 },
    spent: { opacity: 0.4 },
    levelHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    levelText: { flex: 1, minWidth: 0 },
    barRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
    barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: "hidden" },
    // The bars are read, never pressed: ink, not blue (board n-ux-low Q2a c).
    barFill: { height: 8, borderRadius: 4, backgroundColor: c.text },

    weekRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    weekText: { flex: 1, gap: 2 },
    weekLine: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, color: c.textMuted },
    ring: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
    ringTick: { position: "absolute" },
    days: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs },
    day: { alignItems: "center", gap: 4 },
    dayDot: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    dayLetter: { ...typography.caption, color: c.textFaint, fontSize: 12 },

    badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    badge: {
      width: "48%",
      flexGrow: 1,
      backgroundColor: c.surface,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
      gap: 4,
    },
    /** A locked tile: the sticker (already the grey "-locked" art) at half strength, never the words. */
    badgeArtLocked: { opacity: 0.5 },
    badgeTitle: { ...typography.label, color: c.text, fontSize: 13 },
    badgeTitleLocked: { color: c.textMuted },
    badgeDesc: { ...typography.caption, color: c.textMuted, fontSize: 12, lineHeight: 16 },
    badgeProgressRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: 2 },
    badgeTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.surfaceAlt, overflow: "hidden" },
    badgeFill: { height: 4, borderRadius: 2, backgroundColor: c.textMuted },
    badgeCount: { ...typography.caption, color: c.textFaint, fontSize: 12 },

    stickerGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.md },
    sticker: { width: "33.33%", paddingHorizontal: spacing.xs, alignItems: "center", gap: 6 },
    stickerTitle: { ...typography.caption, color: c.text, textAlign: "center", fontFamily: fonts.semibold, lineHeight: 15 },

    badgeList: { overflow: "hidden" },
    badgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minHeight: 48 },
    badgeRowRule: { borderTopWidth: 1, borderTopColor: c.border },
    badgeRowText: { flex: 1 },
    badgeRowCount: { ...typography.caption, color: c.textFaint, fontFamily: fonts.medium },
  });
