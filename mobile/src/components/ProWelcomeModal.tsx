import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "./Button";
import {
  fonts,
  gradients,
  radii,
  spacing,
  typography,
  type Palette,
  type Shadows,
} from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { PRO_FEATURES } from "../lib/proFeatures";
import type { Subscription } from "../api/types";

export interface ProWelcome {
  subscription: Subscription;
  /** The account was already Pro and this payment added time to it. */
  extended: boolean;
  /** `song` for a one-song purchase: one more transcription, nothing about Pro. Default `pro`. */
  kind?: "pro" | "song";
}

/** The same entrance as AppDialog's card. `withSpring` follows the system reduce-motion setting. */
const ENTER_SPRING = { damping: 18, stiffness: 240, mass: 0.7 } as const;

/** "Pro until Nov 3, 2026", or "Pro for life": a lifetime end date is a far-future sentinel. */
function untilLine(sub: Subscription): string | null {
  if (sub.isLifetime) return "Pro for life";
  if (!sub.currentPeriodEndUtc) return null;
  const date = new Date(sub.currentPeriodEndUtc).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `Pro until ${date}`;
}

/**
 * The one moment a payment is acknowledged. Mounted by SubscriptionProvider, so it shows over
 * whatever screen the user is on when the payment lands — the checkout browser may have closed
 * minutes earlier and they have moved on.
 *
 * Gold rather than the brand blue: this is the premium treatment, the same amber as the Pro ring.
 */
export function ProWelcomeModal({
  welcome,
  onClose,
}: {
  welcome: ProWelcome | null;
  onClose: () => void;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);

  // Retained through the exit fade, as AppDialog does, so the card fades out looking like itself.
  const [shown, setShown] = useState<ProWelcome | null>(welcome);
  useEffect(() => {
    if (welcome) setShown(welcome);
  }, [welcome]);

  const enter = useSharedValue(0);
  useEffect(() => {
    if (!welcome) return;
    enter.value = 0;
    enter.value = withSpring(1, ENTER_SPRING);
  }, [welcome, enter]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: Math.min(enter.value, 1),
    transform: [
      { scale: 0.94 + enter.value * 0.06 },
      { translateY: (1 - enter.value) * 12 },
    ],
  }));

  const sub = shown?.subscription;
  const song = shown?.kind === "song";
  const until = sub && !song ? untilLine(sub) : null;

  return (
    <Modal
      visible={welcome !== null && shown !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Animated.View style={[styles.cardWrap, cardStyle]}>
          {/* Swallows taps on the card so they don't reach the dismissing backdrop. */}
          <Pressable style={styles.card} onPress={() => undefined}>
            <LinearGradient
              colors={gradients.premium}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.medallion}
            >
              <Ionicons name={song ? "musical-note" : "star"} size={30} color={c.onAccent} />
            </LinearGradient>

            <Text style={styles.title} accessibilityRole="header">
              {song
                ? "Your song is paid for"
                : shown?.extended
                  ? "More Pro time added"
                  : "Welcome to NoteFusion Pro"}
            </Text>

            {song ? (
              <View style={styles.planBox}>
                <Text style={styles.planName}>One more transcription</Text>
                <Text style={styles.until}>
                  Record, upload, or paste a song link. It never expires.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.planBox}>
                  <Text style={styles.planName}>{sub?.planName || "NoteFusion Pro"}</Text>
                  {until ? <Text style={styles.until}>{until}</Text> : null}
                </View>

                <View style={styles.perks}>
                  {PRO_FEATURES.map((f) => (
                    <View key={f.text} style={styles.perkRow}>
                      <View style={styles.perkIcon}>
                        <Ionicons name={f.icon} size={14} color={c.premiumDeep} />
                      </View>
                      <Text style={styles.perkText}>{f.text}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            <View style={styles.actions}>
              <Button
                label={song ? "Transcribe it" : "Start using Pro"}
                icon="arrow-forward"
                iconPosition="right"
                onPress={onClose}
              />
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: Palette, s: Shadows) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.xl,
    },
    cardWrap: {
      width: "100%",
      maxWidth: 400,
    },
    card: {
      backgroundColor: c.bgElevated,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: c.premiumBorder,
      paddingTop: spacing.xl,
      paddingBottom: spacing.lg,
      paddingHorizontal: spacing.xl,
      alignItems: "center",
    },
    medallion: {
      width: 68,
      height: 68,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      ...s.premiumGlow,
    },
    title: {
      fontSize: 22,
      fontFamily: fonts.display,
      color: c.text,
      textAlign: "center",
      letterSpacing: -0.3,
      marginTop: spacing.lg,
    },
    planBox: {
      alignSelf: "stretch",
      alignItems: "center",
      backgroundColor: c.premiumSoft,
      borderWidth: 1,
      borderColor: c.premiumBorder,
      borderRadius: radii.lg,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      marginTop: spacing.md,
    },
    planName: {
      ...typography.label,
      color: c.text,
      textAlign: "center",
    },
    until: {
      ...typography.caption,
      fontFamily: fonts.semibold,
      color: c.premiumDeep,
      marginTop: 2,
    },
    perks: {
      alignSelf: "stretch",
      marginTop: spacing.lg,
      gap: spacing.sm + 2,
    },
    perkRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    perkIcon: {
      width: 26,
      height: 26,
      borderRadius: radii.sm,
      backgroundColor: c.premiumSoft,
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.md,
    },
    perkText: {
      ...typography.body,
      color: c.text,
      fontSize: 14,
      lineHeight: 19,
      flex: 1,
    },
    actions: {
      alignSelf: "stretch",
      marginTop: spacing.xl,
    },
  });
