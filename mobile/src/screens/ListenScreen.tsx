/**
 * ListenScreen — "Find the key", the Shazam-style listener.
 *
 * Start it, switch to Spotify or YouTube and play the song out loud: the doh and the key appear here
 * and in an ongoing notification, and keep updating while the app is in the background (Android — a
 * microphone foreground service in modules/notefusion-listen). The key is worked out on the phone by
 * `lib/keyDetect`; nothing is uploaded and no credit is spent.
 *
 * Reached from Home, from the Quick Settings tile and the home-screen widget, and from the notification
 * itself (notefusion://listen — `useListenDeepLink` only opens the screen; the user taps Start).
 */

import React, { useEffect } from "react";
import { AppState, Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Touchable } from "../components/Touchable";
import { showDialog } from "../lib/dialog";
import { useKeyListener } from "../lib/useKeyListener";
import { requestAddTile } from "../../modules/notefusion-listen";
import { fonts, radii, spacing, typography, type Palette, type Shadows } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { RootStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "Listen">;

const CAN_ADD_TILE = Platform.OS === "android" && Number(Platform.Version) >= 33;

export function ListenScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const listener = useKeyListener();
  const { available, running, starting, hearing, silenced, doh, keyName, confidence, chord, error, start, stop } = listener;

  // Leaving the screen ends listening. Backgrounding the app does not unmount it — that is the case
  // the service exists for — so the check only guards an unmount while the app is not in front.
  useEffect(
    () => () => {
      if (AppState.currentState === "active") stop();
    },
    [stop],
  );

  async function addTile() {
    const result = await requestAddTile();
    if (result === "declined") return;
    showDialog({
      title: result === "added" || result === "already_added" ? "In your Quick Settings" : "Add it yourself",
      message:
        result === "added"
          ? "Pull down from the top of the screen and tap Find the key whenever a song is playing."
          : result === "already_added"
            ? "Find the key is already there: pull down from the top of the screen and tap it."
            : "Pull down your Quick Settings, tap the pencil to edit, and drag Find the key in.",
      icon: "flash-outline",
    });
  }

  const statusLine = !running
    ? available
      ? "Tap Start, then play a song out loud — on this phone or anywhere near it."
      : null
    : silenced
      ? "Another app is using the microphone right now. Close it and the key will come back."
      : !hearing
        ? "Can't hear anything — play the music out loud."
        : doh
          ? "Listening — the key updates as the song goes on."
          : "Listening… the key shows after a few seconds of music.";

  return (
    <Screen scroll>
      <View style={styles.headerRow}>
        <Touchable
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Tabs", { screen: "Home" }))}
          style={styles.backBtn}
          hitSlop={8}
          ripple="borderless"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Touchable>
        <Text style={styles.pageTitle}>Find the key</Text>
        <View style={styles.backBtn} />
      </View>

      <Card style={styles.stage}>
        <Text style={styles.stageLabel}>{doh ? "Doh is" : running ? "Listening for the doh" : "Doh"}</Text>
        <Text style={[styles.doh, !doh && styles.dohEmpty]} accessibilityLabel={doh ? `Doh is ${doh}` : "No key yet"}>
          {doh ?? "—"}
        </Text>
        <Text style={styles.keyName}>{keyName ?? (running ? "…" : "The key appears here")}</Text>

        <View style={styles.confidenceTrack} accessibilityLabel={`Confidence ${Math.round(confidence * 100)} percent`}>
          <View style={[styles.confidenceFill, { width: `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%` }]} />
        </View>
        <Text style={styles.confidenceText}>{doh ? `${Math.round(confidence * 100)}% sure` : "Confidence"}</Text>

        {running ? (
          <View style={styles.chordRow}>
            <Text style={styles.chordLabel}>Now</Text>
            <Text style={styles.chordValue}>{chord ?? "—"}</Text>
          </View>
        ) : null}

        {statusLine ? <Text style={[styles.status, running && !hearing && styles.statusWarn]}>{statusLine}</Text> : null}

        {available ? (
          <Button
            label={running ? "Stop" : starting ? "Starting…" : "Start listening"}
            icon={running ? "stop-circle-outline" : "radio-outline"}
            variant={running ? "secondary" : "primary"}
            onPress={running ? stop : () => void start()}
            loading={starting}
            style={styles.mainButton}
          />
        ) : null}
      </Card>

      {error ? (
        <Card style={{ ...styles.card, ...styles.errorCard }}>
          <Text style={styles.errorText}>{error}</Text>
        </Card>
      ) : null}

      {available ? (
        <Card style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="phone-portrait-outline" size={18} color={colors.accent} />
            <Text style={styles.rowText}>
              It keeps listening while you use other apps. The key sits in your notifications and updates as the
              song goes on; tap Stop there when you are done.
            </Text>
          </View>
          <View style={styles.row}>
            <Ionicons name="volume-high-outline" size={18} color={colors.accent} />
            <Text style={styles.rowText}>
              It hears through the microphone, so the music has to play out loud — not through headphones.
            </Text>
          </View>
          {CAN_ADD_TILE ? (
            <Button
              label="Add to Quick Settings"
              icon="flash-outline"
              variant="secondary"
              onPress={() => void addTile()}
              style={styles.tileButton}
            />
          ) : null}
        </Card>
      ) : (
        <Card style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="information-circle-outline" size={18} color={colors.accent} />
            <Text style={styles.rowText}>
              Background listening is on Android for now. On this phone, record or import a clip to find its key.
            </Text>
          </View>
        </Card>
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette, s: Shadows) =>
  StyleSheet.create({
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
    backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    pageTitle: { fontFamily: fonts.semibold, fontSize: 18, color: c.text },
    card: { marginBottom: spacing.md },

    stage: { alignItems: "center", paddingVertical: spacing.xl, marginBottom: spacing.md },
    stageLabel: { ...typography.caption, color: c.textMuted, textTransform: "uppercase", letterSpacing: 1 },
    /** The hero: one letter, as large as the card allows. System font — Poppins has no glyph this size. */
    doh: {
      fontSize: 112,
      lineHeight: 124,
      fontWeight: "800",
      color: c.accent,
      textShadowColor: c.accentGlow,
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 18,
    },
    dohEmpty: { color: c.textFaint, textShadowRadius: 0 },
    keyName: { ...typography.heading, color: c.text, marginTop: -spacing.xs },

    confidenceTrack: {
      width: "70%",
      height: 6,
      borderRadius: 3,
      backgroundColor: c.border,
      overflow: "hidden",
      marginTop: spacing.lg,
    },
    confidenceFill: { height: "100%", backgroundColor: c.accent },
    confidenceText: { ...typography.caption, color: c.textFaint, marginTop: spacing.xs },

    chordRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.md,
      backgroundColor: c.surfaceAlt,
      borderRadius: radii.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
    },
    chordLabel: { ...typography.caption, color: c.textMuted },
    chordValue: { ...typography.mono, color: c.text, fontSize: 16 },

    status: { ...typography.body, color: c.textMuted, textAlign: "center", marginTop: spacing.lg, lineHeight: 21 },
    statusWarn: { color: c.warning },
    mainButton: { marginTop: spacing.lg, alignSelf: "stretch", ...s.glow },

    row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginBottom: spacing.sm },
    rowText: { ...typography.body, color: c.textMuted, flex: 1, lineHeight: 21 },
    tileButton: { marginTop: spacing.xs },

    errorCard: { borderColor: c.danger, borderWidth: 1 },
    errorText: { ...typography.body, color: c.text, lineHeight: 21 },
  });
