import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Icon } from "../Icon";
import { Touchable } from "../Touchable";
import { Skeleton } from "../Skeleton";
import { useColors, useThemedStyles } from "../../lib/theme";
import { dohLetter } from "../../lib/solfa";
import { confidenceColor, fonts, motion, radii, spacing, typography, type Palette } from "../../design/theme";
import type { SavedTranscription } from "../../api/types";
import { solfaOpening } from "../../lib/solfaOpening";
import { confidenceA11y, confidenceLevel } from "../../lib/confidence";
import { autoSavedLine, isUnopened } from "../../lib/savedSheet";

export function LibraryRow({
  item,
  subtitle,
  selecting,
  selected,
  onPress,
  onLongPress,
  offline = null,
  opening = false,
}: {
  item: SavedTranscription;
  subtitle: string;
  selecting: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  /**
   * The sheet's offline copy: "kept" (pinned, or keep-all) shows a small mark; "missing" — offline
   * with no copy on the phone — dims the row, since it cannot open until the connection is back.
   */
  offline?: "kept" | "missing" | null;
  /** Tapped and still loading (board m-ux-medium P2b): a soft tint, "Opening…" and a spinner until Result opens. */
  opening?: boolean;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  // No percentage on a row: a tone dot, and only when the sheet is worth a second look.
  const doubtful = confidenceLevel(item.overallConfidence) !== "clear";
  const tone = confidenceColor(item.overallConfidence, colors);
  const doh = dohLetter(item.key);
  const solfa = solfaOpening(item.preview ?? item.notes, item.timeSignature);
  // Filed by the server as its job finished and not opened yet (board 12): a blue dot and the line that says so.
  const unopened = isUnopened(item);

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.row, offline === "missing" && styles.rowMissing, opening && styles.rowOpening]}
      // Full-bleed row: a deeper press pulls it off both screen edges.
      scaleTo={motion.scale.row}
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityState={selecting ? { checked: selected } : opening ? { busy: true } : undefined}
      accessibilityLabel={
        `${unopened ? "New. " : ""}${item.title}, doh is ${doh}${doubtful ? `, ${confidenceA11y(item.overallConfidence)}` : ""}${item.folder ? `, in ${item.folder}` : ""}.` +
        (unopened ? ` ${autoSavedLine(item.createdAtUtc)}.` : "") +
        (offline === "kept" ? " Kept offline." : offline === "missing" ? " Not on this phone while offline." : "") +
        (selecting ? "" : " Long press to select.")
      }
    >
      {selecting && (
        <View style={[styles.check, selected && styles.checkOn]}>
          {selected && <Icon name="check" size={14} strokeWidth={2.25} color={colors.onInk} />}
        </View>
      )}
      <View style={styles.doh}>
        <Text style={styles.dohLetter} numberOfLines={1} adjustsFontSizeToFit>
          {doh}
        </Text>
        <Text style={styles.dohCaption}>DOH</Text>
      </View>
      <View style={styles.info}>
        <View style={styles.titleRow}>
          {unopened ? <View style={styles.unopenedDot} /> : null}
          <Text style={[styles.title, styles.titleFlex]} numberOfLines={1}>
            {item.title}
          </Text>
        </View>
        {/* The song's opening in solfa when the list carries it, so a row is
            recognisable by how it starts; the date and folder otherwise. */}
        {opening ? (
          <Text style={styles.openingText} numberOfLines={1}>
            Opening…
          </Text>
        ) : solfa ? (
          <Text style={styles.solfa} numberOfLines={1}>
            {solfa.first}
            {solfa.rest ? ` │ ${solfa.rest}` : ""}
          </Text>
        ) : (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
        {unopened && !opening ? (
          <View style={styles.savedRow}>
            <Icon name="check" size={13} color={colors.success} />
            <Text style={styles.savedText} numberOfLines={1}>
              {autoSavedLine(item.createdAtUtc)}
            </Text>
          </View>
        ) : null}
      </View>
      {opening ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <>
          {offline ? (
            <Icon name={offline === "kept" ? "kept" : "offline"} size={15} color={colors.textFaint} />
          ) : null}
          {doubtful ? (
            <View style={styles.score}>
              <View style={[styles.scoreDot, { backgroundColor: tone }]} />
            </View>
          ) : null}
        </>
      )}
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
    rowMissing: {
      opacity: 0.5,
    },
    /** The row's pressed colour, held while it opens; it steps out to the gutter so its words stay put. */
    rowOpening: {
      backgroundColor: c.surfaceAlt,
      marginHorizontal: -8,
      paddingHorizontal: 8,
      borderRadius: 14,
    },
    openingText: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 3 },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
    titleFlex: { flexShrink: 1 },
    unopenedDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.link },
    savedRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
    savedText: { fontFamily: fonts.regular, fontSize: 12, color: c.textMuted, flexShrink: 1 },
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
    solfa: {
      marginTop: 3,
      fontSize: 13,
      letterSpacing: 0.4,
      fontFamily: typography.mono.fontFamily,
      color: c.accent,
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
    skeletonGap: { marginTop: 7 },
  });
