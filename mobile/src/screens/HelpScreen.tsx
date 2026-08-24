import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Touchable } from "../components/Touchable";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { RootStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "Help">;

/** Static answers — every one describes behaviour the app actually has. */
const FAQ: { icon: keyof typeof Ionicons.glyphMap; q: string; a: string }[] = [
  {
    icon: "mic-outline",
    q: "What should I record?",
    a: "A single melodic line — hum, sing, or play a few bars close to the mic. One voice at a time transcribes far better than chords or a full mix.",
  },
  {
    icon: "sparkles-outline",
    q: "How does transcription work?",
    a: "Your recording is uploaded and analysed for pitch and timing, then labelled as Tonic Solfa and engraved as staff notation. It usually takes a few seconds.",
  },
  {
    icon: "speedometer-outline",
    q: "What does the confidence score mean?",
    a: "How sure the analysis is about the notes it found. Green is high, amber is worth a review, red means double-check it. Low-confidence notes are outlined so nothing is quietly wrong.",
  },
  {
    icon: "swap-horizontal-outline",
    q: "Can I change the key afterwards?",
    a: "Yes. Solfa is movable-doh, so picking a new key re-labels the syllables without re-transcribing — the pitches never move, only the names do.",
  },
  {
    icon: "document-text-outline",
    q: "How do I get sheet music out?",
    a: "Open a transcription and tap Export MusicXML. The file goes to your share sheet, ready to open in MuseScore, Sibelius, or Finale.",
  },
  {
    icon: "trash-outline",
    q: "How do I delete my account?",
    a: "Profile → Settings → Danger zone. It asks for your password, then removes the account and every saved transcription for good.",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * HelpScreen — static FAQ behind Profile's "FAQ & Help" row.
 *
 * Deliberately content-only: there is no support inbox or ticketing behind the
 * app, so this answers the questions the transcription flow actually raises
 * rather than pretending to offer a channel that does not exist.
 */
export function HelpScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <Screen scroll contentStyle={styles.screen}>
      {/* ── Header row ───────────────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <Touchable
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          hitSlop={8}
          ripple="borderless"
        >
          <View style={styles.backCircle}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </View>
        </Touchable>

        <View style={styles.titleBlock}>
          <Text style={styles.titleLabel}>Support</Text>
          <Text style={styles.titleMain}>FAQ &amp; Help</Text>
        </View>
      </View>

      {/* ── Questions ────────────────────────────────────────────────────── */}
      {FAQ.map((item) => (
        <Card key={item.q} style={styles.card}>
          <View style={styles.qRow}>
            <View
              style={[styles.iconCircle, { backgroundColor: colors.accentSoft }]}
            >
              <Ionicons name={item.icon} size={15} color={colors.purple} />
            </View>
            <Text style={styles.question}>{item.q}</Text>
          </View>
          <Text style={styles.answer}>{item.a}</Text>
        </Card>
      ))}
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: {
      paddingBottom: spacing.xxxl,
    },

    // ── Header ──────────────────────────────────────────────────────────────

    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: spacing.sm,
      marginBottom: spacing.xl,
    },

    backCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },

    titleBlock: {
      flex: 1,
      marginHorizontal: spacing.md,
    },

    titleLabel: {
      ...typography.caption,
      color: c.textFaint,
      textTransform: "uppercase",
      letterSpacing: 1,
      fontSize: 10,
    },

    titleMain: {
      ...typography.title,
      color: c.text,
      fontSize: 22,
      letterSpacing: -0.4,
      marginTop: 1,
    },

    // ── Question cards ──────────────────────────────────────────────────────

    card: {
      marginBottom: spacing.md,
    },

    qRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing.sm,
    },

    iconCircle: {
      width: 30,
      height: 30,
      borderRadius: radii.sm,
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.md,
    },

    question: {
      ...typography.label,
      color: c.text,
      flex: 1,
      fontSize: 15,
      fontFamily: fonts.bold,
    },

    answer: {
      ...typography.body,
      color: c.textMuted,
      fontSize: 13,
      lineHeight: 20,
    },
  });
