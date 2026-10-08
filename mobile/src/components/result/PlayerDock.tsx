import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Touchable } from "../Touchable";
import { motion, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { clamp, formatTime, useSeekDrag, type Practice } from "./usePractice";

/** How much the sheet's scroll content must leave clear under the dock. */
export const DOCK_CLEARANCE = 112;

/**
 * The player docked over the bottom of the sheet: play, a scrubber with mono times,
 * and the way into Rehearse. The audio is always the piano rendering of the notes —
 * the only source a sheet on the phone has — so there is no source switch.
 */
export function PlayerDock({
  practice,
  onRehearse,
}: {
  practice: Practice;
  onRehearse: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { panResponder, dragFraction, onTrackWidth } = useSeekDrag(practice);
  const { ready, isLoading, isPlaying, position, duration, error } = practice;

  const played = dragFraction ?? (duration > 0 ? clamp(position / duration, 0, 1) : 0);

  return (
    <View style={[styles.dock, { bottom: insets.bottom + 10 }]}>
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
            <Ionicons
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

        <Touchable
          onPress={onRehearse}
          style={styles.rehearse}
          radius={20}
          accessibilityRole="button"
          accessibilityLabel="Rehearse: loop, slow down and choose the parts"
        >
          <Ionicons name="expand-outline" size={18} color={colors.text} />
        </Touchable>
      </View>
      {/* The hook's error can be a platform message; the dock says it plainly instead. */}
      {error ? <Text style={styles.error}>This sheet could not be played. Try closing it and opening it again.</Text> : null}
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
    rehearse: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    error: { fontFamily: typography.caption.fontFamily, fontSize: 12, color: c.danger, marginTop: 8 },
  });
