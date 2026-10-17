/**
 * TrackPicker — "How do you like to practise?": Playful or Focused, asked on the first visit to Practice and shown
 * again whenever the singer taps to change. A style, never an age. Choosing calls back; the screen saves it
 * (`PUT /api/practice/track`) and reloads today's drill, which is the track's own.
 */

import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Card } from "../Card";
import { Touchable } from "../Touchable";
import type { PracticeTrack } from "../../api/types";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { TRACK_OPTIONS, TRACK_QUESTION } from "../../lib/practiceTrack";

const ICONS: Record<PracticeTrack, keyof typeof Ionicons.glyphMap> = {
  playful: "happy",
  focused: "musical-notes",
};

interface Props {
  current: PracticeTrack | null;
  /** The track being saved, while it is. */
  saving: PracticeTrack | null;
  error?: string | null;
  onPick: (track: PracticeTrack) => void;
  /** Shown when changing an existing choice: keep it as it is. */
  onCancel?: () => void;
}

export function TrackPicker({ current, saving, error, onPick, onCancel }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <Card style={styles.card}>
      <Text style={styles.question} accessibilityRole="header">{TRACK_QUESTION}</Text>
      <Text style={styles.sub}>Your XP, streak and badges stay the same whichever you pick. Change it any time.</Text>
      {TRACK_OPTIONS.map((o) => {
        const on = current === o.track;
        return (
          <Touchable
            key={o.track}
            onPress={() => !saving && onPick(o.track)}
            disabled={!!saving}
            radius={radii.md}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, busy: saving === o.track }}
            accessibilityLabel={`${o.title}. ${o.blurb}`}
          >
            <View style={[styles.option, on && styles.optionOn, o.track === "playful" && styles.optionPlayful]}>
              <View style={[styles.icon, o.track === "playful" ? styles.iconPlayful : styles.iconFocused]}>
                <Ionicons name={ICONS[o.track]} size={22} color={o.track === "playful" ? colors.premium : colors.accent} />
              </View>
              <View style={styles.text}>
                <Text style={styles.title}>{o.title}</Text>
                <Text style={styles.blurb}>{o.blurb}</Text>
              </View>
              {saving === o.track ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Ionicons name={on ? "checkmark-circle" : "chevron-forward"} size={20} color={on ? colors.success : colors.textFaint} />
              )}
            </View>
          </Touchable>
        );
      })}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {onCancel ? (
        <Touchable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Keep my practice style" style={styles.cancel}>
          <Text style={styles.cancelText}>Keep it as it is</Text>
        </Touchable>
      ) : null}
    </Card>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { marginBottom: spacing.md, gap: spacing.sm },
    question: { ...typography.heading, color: c.text },
    sub: { ...typography.caption, color: c.textMuted, lineHeight: 17, marginBottom: spacing.xs },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      minHeight: 64,
      padding: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1.5,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
    },
    optionPlayful: { borderStyle: "dashed" },
    optionOn: { borderColor: c.accent, borderStyle: "solid", backgroundColor: c.accentSoft },
    icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1 },
    iconPlayful: { backgroundColor: c.premiumSoft, borderColor: c.premiumBorder },
    iconFocused: { backgroundColor: c.accentSoft, borderColor: c.border },
    text: { flex: 1, gap: 2 },
    title: { ...typography.label, color: c.text, fontSize: 16, fontFamily: fonts.bold },
    blurb: { ...typography.caption, color: c.textMuted, lineHeight: 17 },
    error: { ...typography.caption, color: c.danger },
    cancel: { alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md },
    cancelText: { ...typography.label, color: c.textMuted },
  });
