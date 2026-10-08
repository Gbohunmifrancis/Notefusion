import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Touchable } from "../Touchable";
import { Skeleton } from "../Skeleton";
import { useColors, useThemedStyles } from "../../lib/theme";
import { parseKey, dohPitchClass } from "../../lib/solfa";
import { confidenceColor, fonts, motion, radii, spacing, typography, type Palette } from "../../design/theme";
import type { SavedTranscription } from "../../api/types";

/** Doh names as key signatures spell them — "Bb", not "A#" — for la-based minor keys. */
const DOH_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/**
 * The letter on a sheet's doh tile. A major key keeps its own spelling; a minor key's
 * doh is its relative major's tonic (movable-do, la-based minor), so "D minor" reads F.
 */
export function dohLetter(key: string): string {
  const parsed = parseKey(key);
  if (!parsed) return "–";
  if (parsed.mode === "major") {
    const tonic = key.trim().match(/^[A-Ga-g][#♯b♭-]*/)?.[0];
    if (tonic) return tonic[0]!.toUpperCase() + tonic.slice(1).replace(/[♭-]/g, "b").replace(/♯/g, "#");
  }
  return DOH_NAMES[dohPitchClass(parsed)]!;
}

export function LibraryRow({
  item,
  subtitle,
  selecting,
  selected,
  onPress,
  onLongPress,
}: {
  item: SavedTranscription;
  subtitle: string;
  selecting: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const pct = Math.round(item.overallConfidence * 100);
  const tone = confidenceColor(item.overallConfidence, colors);
  const doh = dohLetter(item.key);

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.row}
      // Full-bleed row: a deeper press pulls it off both screen edges.
      scaleTo={motion.scale.row}
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityState={selecting ? { checked: selected } : undefined}
      accessibilityLabel={
        `${item.title}, doh is ${doh}, ${pct} percent sure${item.folder ? `, in ${item.folder}` : ""}.` +
        (selecting ? "" : " Long press to select.")
      }
    >
      {selecting && (
        <View style={[styles.check, selected && styles.checkOn]}>
          {selected && <Ionicons name="checkmark" size={14} color={colors.onInk} />}
        </View>
      )}
      <View style={styles.doh}>
        <Text style={styles.dohLetter} numberOfLines={1} adjustsFontSizeToFit>
          {doh}
        </Text>
        <Text style={styles.dohCaption}>DOH</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.score}>
        <View style={[styles.scoreDot, { backgroundColor: tone }]} />
        <Text style={[styles.scoreText, { color: tone }]}>{pct}</Text>
      </View>
    </Touchable>
  );
}

/** Loading rows drawn the way the real ones sit: hairlines on the canvas, no cards. */
export function LibraryRowSkeleton() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Skeleton width={46} height={46} radius={14} />
      <View style={styles.info}>
        <Skeleton width="60%" height={14} radius={radii.sm} />
        <Skeleton width="35%" height={11} radius={radii.sm} style={styles.skeletonGap} />
      </View>
      <Skeleton width={30} height={12} radius={radii.sm} />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingVertical: 13,
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: c.textFaint,
      alignItems: "center",
      justifyContent: "center",
    },
    checkOn: {
      backgroundColor: c.ink,
      borderColor: c.ink,
    },
    doh: {
      width: 46,
      height: 46,
      borderRadius: 14,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 3,
    },
    dohLetter: {
      fontFamily: typography.mono.fontFamily,
      fontSize: 17,
      lineHeight: 19,
      color: c.text,
    },
    dohCaption: {
      fontFamily: fonts.medium,
      fontSize: 8.5,
      letterSpacing: 0.9,
      color: c.textMuted,
      marginTop: 2,
    },
    info: { flex: 1, minWidth: 0 },
    title: {
      fontFamily: fonts.medium,
      fontSize: 15,
      letterSpacing: -0.15,
      color: c.text,
    },
    subtitle: {
      fontFamily: fonts.regular,
      fontSize: 12.5,
      color: c.textMuted,
      marginTop: 3,
    },
    score: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingLeft: spacing.xs,
    },
    scoreDot: { width: 6, height: 6, borderRadius: 3 },
    scoreText: {
      fontFamily: fonts.medium,
      fontSize: 12.5,
      fontVariant: ["tabular-nums"],
    },
    skeletonGap: { marginTop: 7 },
  });
