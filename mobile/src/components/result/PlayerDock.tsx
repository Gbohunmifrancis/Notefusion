import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Icon } from "../Icon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Touchable } from "../Touchable";
import { fonts, motion, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { clamp, formatTime, useSeekDrag, type Practice } from "./usePractice";
import { ProblemNote } from "../ProblemNote";

/** How much the sheet's scroll content must leave clear under the dock. */
export const DOCK_CLEARANCE = 112;

/**
 * The player docked over the bottom of the sheet: play, a scrubber with mono times,
 * and the sheet's one labelled next step, Practise (board m-ux-medium P1a): Learn my part when the sheet has
 * parts, else Rehearse's loop — what the first-open toast offers, kept on screen after it goes. The audio is
 * always the piano rendering of the notes — the only source a sheet on the phone has — so there is no source switch.
 */
export function PlayerDock({
  practice,
  onPractise,
  lift = 0,
  onHeight,
}: {
  practice: Practice;
  /** Learn my part, or Rehearse for a sheet without parts (ResultScreen `practiseNow`). */
  onPractise: () => void;
  /** Raised this far above its place, over a card pinned under it (a guest's "Keep this sheet"). */
  lift?: number;
  /** The dock's height as laid out, for what floats over it (an unsaved sheet's Save to Library). */
  onHeight?: (height: number) => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { panResponder, dragFraction, onTrackWidth } = useSeekDrag(practice);
  const { ready, isLoading, isPlaying, position, duration, error } = practice;

  const played = dragFraction ?? (duration > 0 ? clamp(position / duration, 0, 1) : 0);

  return (
    <View
      style={[styles.dock, { bottom: insets.bottom + 10 + lift }]}
      onLayout={onHeight ? (e) => onHeight(Math.round(e.nativeEvent.layout.height)) : undefined}
    >
      <View style={styles.row}>
        <Touchable
          onPress={() => void practice.togglePlay()}
          disabled={!ready || isLoading}
          style={[styles.play, !ready && styles.playIdle]}
          scaleTo={motion.scale.large}
          radius={22}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause playback" : "Play melody"}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.bg} />
          ) : (
            <Icon
              name={isPlaying ? "pause" : "play"}
              size={20}
              color={ready ? colors.bg : colors.textFaint}
              style={isPlaying ? undefined : styles.playGlyph}
            />
          )}
        </Touchable>

        <View style={styles.progress}>
          <View
            style={styles.track}
            onLayout={(e) => onTrackWidth(e.nativeEvent.layout.width)}
            accessibilityRole="adjustable"
            accessibilityLabel="Playback position"
            accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(position) }}
            {...panResponder.panHandlers}
          >
            <View style={styles.rail}>
              <View style={[styles.fill, { width: `${played * 100}%` }]} />
            </View>
            <View style={[styles.thumb, { left: `${played * 100}%` }]} pointerEvents="none" />
          </View>
          <View style={styles.times}>
            <Text style={styles.time}>{formatTime(position)}</Text>
            <Text style={styles.time}>{formatTime(duration)}</Text>
          </View>
        </View>

        {/* Button's secondary look at 44 px, in the dock's glass; the scrubber gives up the room and keeps its drag. */}
        <Touchable
          onPress={onPractise}
          style={styles.practise}
          radius={22}
          accessibilityRole="button"
          accessibilityLabel="Practise this tune"
        >
          <Icon name="rehearse" size={18} color={colors.text} />
          <Text style={styles.practiseLabel}>Practise</Text>
        </Touchable>
      </View>
      {/* The hook's error can be a platform message; the dock says it plainly instead. */}
      {error ? <ProblemNote>This sheet could not be played. Try closing it and opening it again.</ProblemNote> : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    dock: {
      position: "absolute",
      left: 14,
      right: 14,
      backgroundColor: c.glass,
      borderRadius: 26,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: 12,
      paddingHorizontal: 14,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.35,
      shadowRadius: 24,
      elevation: 12,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    /** The text colour as a fill: white on night, ink on day — the board's white button either way round. */
    play: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.text,
      alignItems: "center",
      justifyContent: "center",
    },
    playIdle: { backgroundColor: c.surfaceAlt },
    /** The play triangle's optical centre sits left of its box. */
    playGlyph: { marginLeft: 2 },
    progress: { flex: 1 },
    track: { height: 22, justifyContent: "center" },
    rail: { height: 3, borderRadius: 2, backgroundColor: c.border, overflow: "hidden" },
    fill: { height: "100%", backgroundColor: c.text, borderRadius: 2 },
    thumb: {
      position: "absolute",
      top: "50%",
      width: 12,
      height: 12,
      borderRadius: 6,
      marginTop: -6,
      marginLeft: -6,
      backgroundColor: c.text,
    },
    times: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
    time: { fontFamily: typography.mono.fontFamily, fontSize: 11, color: c.textMuted },
    practise: {
      height: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      paddingLeft: 13,
      paddingRight: 16,
      borderRadius: 22,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    practiseLabel: { fontFamily: fonts.semibold, fontSize: 15, color: c.text },
  });
