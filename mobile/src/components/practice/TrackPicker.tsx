/**
 * TrackPicker — "How do you like to practise?": Playful or Focused, asked on the first visit to Practice and shown
 * again whenever the singer taps to change. A style, never an age. Doh hands the choice over; each option is its
 * picture first (Playful's sunburst, Focused's tuner), so the difference reads before any words. Choosing calls back;
 * the screen saves it (`PUT /api/practice/track`) and reloads today's drill, which is the track's own.
 */

import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Card } from "../Card";
import { Touchable } from "../Touchable";
import type { PracticeTrack } from "../../api/types";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { TRACK_OPTIONS, TRACK_QUESTION, mascotArt, trackArt } from "../../lib/practiceTrack";
import { Art, artRatio } from "./Art";

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
  // The scenes fill the option's width: measured once laid out, so each is drawn at its exact size.
  const [pictureWidth, setPictureWidth] = useState(0);

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Art name={mascotArt("handoff")} width={64} />
        <View style={styles.headText}>
          <Text style={styles.question} accessibilityRole="header">{TRACK_QUESTION}</Text>
          <Text style={styles.sub}>Your XP, streak and badges stay the same whichever you pick. Change it any time.</Text>
        </View>
      </View>
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
            <View style={[styles.option, o.track === "playful" && styles.optionPlayful, on && styles.optionOn]}>
              <View
                style={[styles.picture, { aspectRatio: 1 / artRatio(trackArt(o.track)) }]}
                onLayout={(e) => setPictureWidth(Math.round(e.nativeEvent.layout.width))}
              >
                {pictureWidth > 0 ? <Art name={trackArt(o.track)} width={pictureWidth} /> : null}
              </View>
              <View style={styles.row}>
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
    card: { marginBottom: spacing.md, gap: spacing.md },
    head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    headText: { flex: 1, gap: 4 },
    question: { ...typography.heading, color: c.text },
    sub: { ...typography.caption, color: c.textMuted, lineHeight: 17 },
    option: {
      gap: spacing.sm,
      padding: spacing.xs + 2,
      paddingBottom: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1.5,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
    },
    optionPlayful: { borderColor: c.playBorder },
    optionOn: { borderColor: c.accent, backgroundColor: c.accentSoft },
    picture: { width: "100%" },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.sm },
    text: { flex: 1, gap: 2 },
    title: { ...typography.label, color: c.text, fontSize: 16, fontFamily: fonts.bold },
    blurb: { ...typography.caption, color: c.textMuted, lineHeight: 17 },
    error: { ...typography.caption, color: c.danger },
    cancel: { alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md },
    cancelText: { ...typography.label, color: c.textMuted },
  });
