/**
 * A practice mode as a path (Duolingo-like), the web's mode path mirrored (assets/practice-mode-view.js): each unit a
 * coloured banner, its exercises as stops snaking down with their stars, then the unit's chest, open once every stop
 * has a star. A unit is locked until the one before is starred; its first stop says "Jump here". The arithmetic is
 * `lib/practiceModes` `modePath`, read off the best marks the server lists.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "../Icon";
import { Touchable } from "../Touchable";
import type { ModePath as Path, PathStop, PathTone, PathUnit } from "../../lib/practiceModes";
import { fonts, spacing, type Palette } from "../../design/theme";
import { useTheme, useThemedStyles } from "../../lib/theme";

/** The game colours (web practice-view.css `--gg-*`): a fill, its darker lip and the ink on it. Never Pro gold, violet or red. */
const TONES: Record<"light" | "dark", Record<PathTone | "locked", { fill: string; lip: string; ink: string }>> = {
  light: {
    green: { fill: "#1FB874", lip: "#138A54", ink: "#04261A" },
    blue: { fill: "#2F6FED", lip: "#1E4FB5", ink: "#FFFFFF" },
    orange: { fill: "#FF9640", lip: "#CC6A16", ink: "#2A1300" },
    cyan: { fill: "#1FB6D6", lip: "#12819A", ink: "#032A33" },
    pink: { fill: "#FF6FAE", lip: "#CF4886", ink: "#3A0A20" },
    locked: { fill: "#E6EAF2", lip: "#C9D1DF", ink: "#7A869E" },
  },
  dark: {
    green: { fill: "#3DDC97", lip: "#22A06E", ink: "#04261A" },
    blue: { fill: "#4C8DFF", lip: "#2B5FD0", ink: "#FFFFFF" },
    orange: { fill: "#FF9F43", lip: "#D9771E", ink: "#2A1300" },
    cyan: { fill: "#2EC5E6", lip: "#1B95B3", ink: "#032A33" },
    pink: { fill: "#FF6FAE", lip: "#D44A86", ink: "#3A0A20" },
    locked: { fill: "#232C44", lip: "#161D30", ink: "#6E7A96" },
  },
};

export function ModePath({ path, onOpen }: { path: Path; onOpen: (index: number) => void }) {
  return (
    <View>
      {path.units.map((u) => (
        <Unit key={u.eyebrow} unit={u} onOpen={onOpen} />
      ))}
    </View>
  );
}

function Unit({ unit, onOpen }: { unit: PathUnit; onOpen: (index: number) => void }) {
  const { mode } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tones = TONES[mode === "dark" ? "dark" : "light"];
  const tone = unit.open ? tones[unit.tone] : tones.locked;
  return (
    <View style={styles.unit} accessibilityLabel={`${unit.eyebrow}: ${unit.title}. ${unit.stars} of ${unit.maxStars} stars.${unit.open ? "" : " Locked."}`}>
      <View style={[styles.banner, { backgroundColor: tone.fill, shadowColor: tone.lip, borderBottomColor: tone.lip }]}>
        <View style={styles.bannerText}>
          <Text style={[styles.eyebrow, { color: tone.ink }]}>{unit.eyebrow}</Text>
          <Text style={[styles.unitTitle, { color: tone.ink }]} numberOfLines={2}>{unit.title}</Text>
        </View>
        <View style={styles.bannerStars}>
          <Text style={[styles.bannerStarsText, { color: tone.ink }]}>{unit.open ? `★ ${unit.stars}/${unit.maxStars}` : "Locked"}</Text>
        </View>
      </View>
      <View style={styles.road}>
        {unit.stops.map((s) => (
          <Stop key={s.index} stop={s} tone={tones[unit.tone]} locked={tones.locked} onOpen={onOpen} />
        ))}
        <View style={styles.chest} accessible={false}>
          <Icon name="reward" size={34} color={unit.complete ? tones.orange.fill : tones.locked.ink} />
        </View>
      </View>
    </View>
  );
}

function Stop({
  stop,
  tone,
  locked,
  onOpen,
}: {
  stop: PathStop;
  tone: { fill: string; lip: string; ink: string };
  locked: { fill: string; lip: string; ink: string };
  onOpen: (index: number) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const shut = stop.state === "locked" || stop.state === "jump";
  const fill = stop.state === "done" || stop.state === "current" ? tone.fill : stop.state === "open" ? "transparent" : locked.fill;
  const lip = shut ? locked.lip : tone.lip;
  const ink = stop.state === "open" ? tone.lip : shut ? locked.ink : tone.ink;
  const big = stop.state === "current";
  const label = `${stop.title}${shut ? (stop.state === "jump" ? ", jump ahead to this unit" : ", locked") : `, ${stop.stars} of 3 stars`}`;
  return (
    <View style={[styles.stop, { transform: [{ translateX: stop.offset * 0.8 }] }]}>
      {big || stop.state === "jump" ? (
        <View style={styles.tag}>
          <Text style={[styles.tagText, big && { color: tone.lip }]}>{big ? "START" : "JUMP HERE"}</Text>
        </View>
      ) : null}
      <Touchable
        onPress={() => onOpen(stop.index)}
        disabled={stop.state === "locked"}
        scaleTo={0.94}
        radius={36}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <View
          style={[
            styles.button,
            big && styles.buttonBig,
            { backgroundColor: fill, borderBottomColor: lip },
            stop.state === "open" && { borderColor: tone.fill, borderWidth: 3, borderBottomWidth: 6 },
          ]}
        >
          <Icon name={stop.state === "done" ? "check" : shut ? "lock" : "mic"} size={big ? 28 : 24} color={ink} />
        </View>
      </Touchable>
      {!shut ? (
        <Text style={styles.stars} accessible={false}>
          {[0, 1, 2].map((k) => (
            <Text key={k} style={k < stop.stars ? styles.starOn : styles.starOff}>★</Text>
          ))}
        </Text>
      ) : null}
      <Text style={[styles.name, (big || stop.state === "done") && styles.nameOn]} numberOfLines={2}>{stop.title}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    unit: { marginTop: spacing.lg },
    banner: {
      flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 14,
      borderRadius: 18, borderBottomWidth: 5,
    },
    bannerText: { flex: 1, minWidth: 0, gap: 3 },
    eyebrow: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1, opacity: 0.85 },
    unitTitle: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 24 },
    bannerStars: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.28)" },
    bannerStarsText: { fontFamily: fonts.bold, fontSize: 14 },
    road: { alignItems: "center", gap: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
    stop: { alignItems: "center", gap: 6, maxWidth: 170 },
    tag: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, borderWidth: 2, borderColor: c.border, backgroundColor: c.surface },
    tagText: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.8, color: c.textMuted },
    button: { width: 68, height: 62, borderRadius: 31, alignItems: "center", justifyContent: "center", borderBottomWidth: 6 },
    buttonBig: { width: 78, height: 70, borderRadius: 35 },
    stars: { fontSize: 15, letterSpacing: 1 },
    starOn: { color: "#FF9F43" },
    starOff: { color: c.textFaint },
    name: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, color: c.textMuted, textAlign: "center" },
    nameOn: { color: c.text },
    chest: { paddingTop: spacing.xs },
  });
