import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Icon } from "../Icon";
import { Touchable } from "../Touchable";
import { Skeleton } from "../Skeleton";
import { useColors, useThemedStyles } from "../../lib/theme";
import { dohLetter } from "../../lib/solfa";
import { fonts, motion, radii, spacing, typography, type Palette } from "../../design/theme";
import type { SavedTranscription } from "../../api/types";
import { solfaOpening } from "../../lib/solfaOpening";
import { confidenceA11y, confidenceLevel } from "../../lib/confidence";
import { autoSavedLine, autoSavedRowLine, isUnopened } from "../../lib/savedSheet";
import { libraryRowLine } from "../../lib/sheetMeta";

/**
 * One saved sheet, in the Library and on Home's Recent (board n-ux-low Q4d): the doh tile, the title (16), the
 * opening in solfa (14, the text colour) and under it the day, folder and tempo, or "Saved automatically" on a sheet
 * filed and not yet opened (Q4g). A sheet worth a second listen ends in the amber problem sign (Q4a).
 */
export function LibraryRow({
  item,
  withFolder = true,
  brief = false,
  selecting,
  selected,
  onPress,
  onLongPress,
  offline = null,
  opening = false,
  active = false,
  onMore,
}: {
  item: SavedTranscription;
  /** On "All" the line names the sheet's folder; inside a folder it would repeat the tab. */
  withFolder?: boolean;
  /**
   * Home's Recent: the title and one line, the opening (else the day line), and no "Saved automatically" line; the
   * Library shows both lines.
   */
  brief?: boolean;
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
  /** Its actions are open (board a-core/11): the same tint, so it is plain which sheet they act on. */
  active?: boolean;
  /**
   * The sheet's actions (board m-ux-medium P2c): Home's ⋯ at the row's end, opening the same sheet of actions. Not
   * drawn while selecting, when the row is a tick box.
   */
  onMore?: () => void;
}) {
  const more = !!onMore && !selecting;
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  // No percentage on a row: the problem sign, and only when the sheet is worth a second look.
  const doubtful = confidenceLevel(item.overallConfidence) !== "clear";
  const doh = dohLetter(item.key);
  const solfa = solfaOpening(item.preview ?? item.notes, item.timeSignature);
  // Filed by the server as its job finished and not opened yet (board 12): a blue dot and the line that says so.
  const unopened = isUnopened(item);
  const dayLine = libraryRowLine(item, withFolder, new Date());
  // Under the opening, the day line; on a filed, unopened sheet the "Saved automatically" line, naming the folder
  // when the line above does not (it does when there is no opening and the day line takes its place).
  const third = brief ? null : unopened ? "saved" : solfa ? "day" : null;

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.row, offline === "missing" && styles.rowMissing, (opening || active) && styles.rowOpening]}
      // Full-bleed row: a deeper press pulls it off both screen edges.
      scaleTo={motion.scale.row}
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityState={selecting ? { checked: selected } : opening ? { busy: true } : undefined}
      accessibilityLabel={
        `${unopened ? "New. " : ""}${item.title}, doh is ${doh}${doubtful ? `, ${confidenceA11y(item.overallConfidence)}` : ""}${item.folder ? `, in ${item.folder}` : ""}.` +
        (unopened ? ` ${autoSavedLine(item.createdAtUtc)}.` : "") +
        (offline === "kept" ? " Kept offline." : offline === "missing" ? " Not on this phone while offline." : "") +
        // Home's long press opens the actions (a row action below), the Library's selects.
        (selecting || brief ? "" : " Long press to select.")
      }
      // VoiceOver never reaches the ⋯ inside the row, so its sheet is one of the row's own actions (as on Home).
      accessibilityActions={more ? [{ name: "more", label: `More for ${item.title}` }] : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "more") onMore?.();
      }}
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
        {/* The song's opening in solfa when the list carries it, so a row is recognisable by how it starts; the
            day line otherwise. "Opening…" takes this line's place while the sheet loads; the one under it stays. */}
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
            {dayLine}
          </Text>
        )}
        {third === "saved" ? (
          <View style={styles.savedRow}>
            <Icon name="check" size={13} color={colors.success} />
            <Text style={styles.savedText} numberOfLines={1}>
              {autoSavedRowLine(item, withFolder && !!solfa)}
            </Text>
          </View>
        ) : third === "day" ? (
          <Text style={[styles.subtitle, styles.lineGap]} numberOfLines={1}>
            {dayLine}
          </Text>
        ) : null}
      </View>
      {opening ? (
        <View style={more ? styles.more : null}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : (
        <>
          {offline ? (
            <Icon name={offline === "kept" ? "kept" : "offline"} size={15} color={colors.textFaint} />
          ) : null}
          {/* Worth a look: the app's problem sign, a shape as well as a colour (board n-ux-low Q4a); its words are in
              the row's label. */}
          {doubtful ? (
            <View style={styles.score}>
              <Icon name="problem" size={16} color={colors.warning} />
            </View>
          ) : null}
          {more ? (
            <Touchable
              onPress={onMore}
              style={styles.more}
              hitSlop={2}
              ripple="borderless"
              accessibilityLabel={`More for ${item.title}`}
            >
              <Icon name="more" size={20} color={colors.textMuted} />
            </Touchable>
          ) : null}
        </>
      )}
    </Touchable>
  );
}

/** Loading rows drawn the way the real ones sit: hairlines on the canvas, no cards. `brief` as the row's. */
export function LibraryRowSkeleton({ brief = false }: { brief?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Skeleton width={46} height={46} radius={14} />
      <View style={styles.info}>
        <Skeleton width="60%" height={15} radius={radii.sm} />
        <Skeleton width="38%" height={12} radius={radii.sm} style={styles.skeletonGap} />
        {brief ? null : <Skeleton width="48%" height={12} radius={radii.sm} style={styles.skeletonGap} />}
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
    // The app's sizes for what is read and what supports it (board n-ux-low Q4c): titles 16, their lines 14, the
    // "Saved automatically" line 13.
    openingText: { fontFamily: fonts.regular, fontSize: 14, color: c.textMuted, marginTop: 3 },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
    titleFlex: { flexShrink: 1 },
    unopenedDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.link },
    savedRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
    savedText: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, flexShrink: 1 },
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
      fontSize: 16,
      letterSpacing: -0.15,
      color: c.text,
    },
    // The opening reads in the text colour, not a link's blue (board n-ux-low Q4f): nothing in a row is a link.
    solfa: {
      marginTop: 3,
      fontSize: 14,
      letterSpacing: 0.4,
      fontFamily: typography.mono.fontFamily,
      color: c.text,
    },
    subtitle: {
      fontFamily: fonts.regular,
      fontSize: 14,
      color: c.textMuted,
      marginTop: 3,
    },
    lineGap: { marginTop: 2 },
    score: {
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: spacing.xs,
    },
    /** The ⋯ at the row's end, as on Home: a 44 px target, flush with the screen's edge. */
    more: {
      width: 44,
      height: 44,
      marginRight: -12,
      alignItems: "center",
      justifyContent: "center",
    },
    skeletonGap: { marginTop: 7 },
  });
