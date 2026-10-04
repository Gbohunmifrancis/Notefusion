/**
 * LinkScreen — paste a song link, get its lead vocal as Tonic Solfa.
 *
 * YouTube, Spotify and Apple Music links are accepted. The worker fetches the audio
 * (Spotify and Apple are DRM, so those resolve to the song on YouTube by title and
 * artist), isolates the voice from the mix, and transcribes it — which is why this
 * screen shows three stages and a song card rather than the record screen's single
 * spinner: a four-minute song takes a few minutes, and the title and artist appear
 * long before the notes do.
 *
 * Entitlement is the server's call (`SubmitLinkTranscriptionCommand`); this screen
 * only explains it: Pro gets twenty full songs a month in the fast lane, a free account
 * gets one sixty-second preview, and the refusal codes map to the upgrade sheet.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Touchable } from "../components/Touchable";
import { useJobPolling } from "../lib/useJobPolling";
import { useSubscription } from "../lib/subscription";
import { markPractisedToday } from "../lib/practiceReminder";
import { extractSongUrl, songLinkHint } from "../lib/songLink";
import { keyboardTranspose } from "../lib/keyboardTranspose";
import { fonts, radii, spacing, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { TranscriptionStage } from "../api/types";
import type { RootStackParams } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParams>;

const STAGES: { key: TranscriptionStage; label: string }[] = [
  { key: "fetching", label: "Fetching audio" },
  { key: "separating", label: "Isolating the voice" },
  { key: "transcribing", label: "Writing the solfa" },
];

const PROVIDER_LABEL = { youtube: "YouTube", spotify: "Spotify", apple_music: "Apple Music" } as const;

export function LinkScreen() {
  const nav = useNavigation<Nav>();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { state, startLink, reset } = useJobPolling();
  const { isPro, known, subscription, refresh } = useSubscription();

  const [url, setUrl] = useState("");
  // Share text ("Listen to … on Spotify: https://…") is read down to its link, the one rule the
  // worker applies (lib/songLink); only the link itself is sent.
  const found = useMemo(() => extractSongUrl(url), [url]);
  const provider = found?.provider ?? null;
  const busy = state.status === "pending" || state.status === "processing";

  const credits = subscription?.songCreditsRemaining;
  const creditsTotal = subscription?.songCreditsTotal;

  // ── Finish ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.status === "done" && state.result) {
      const result = state.result;
      reset();
      refresh();
      void markPractisedToday();
      nav.replace("Result", {
        result,
        title: result.source ? result.source.title : undefined,
      });
    }
  }, [state.status, state.result, nav, reset, refresh]);

  const stageIndex = STAGES.findIndex((s) => s.key === state.stage);
  const barWidth = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    Animated.timing(barWidth, {
      toValue: busy ? Math.max(0.03, state.progress) : 0,
      duration: 500,
      useNativeDriver: false,
    }).start();
  }, [busy, state.progress, barWidth]);

  function submit() {
    if (!found || busy) return;
    void startLink(found.url, { mode: "melody", keyboardTranspose: keyboardTranspose() || undefined });
  }

  const upgradeCodes = new Set(["BILLING_SONG_PREVIEW_USED", "BILLING_FREE_TIER_LIMIT"]);
  const wantsUpgrade = state.status === "failed" && state.errorCode !== null && upgradeCodes.has(state.errorCode);

  return (
    <Screen scroll>
      <View style={styles.headerRow}>
        <Touchable
          onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate("Tabs", { screen: "Home" }))}
          style={styles.backBtn}
          hitSlop={8}
          ripple="borderless"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Touchable>
        <Text style={styles.pageTitle}>Song from a link</Text>
        <View style={styles.backBtn} />
      </View>

      <Text style={styles.lead}>
        Paste a YouTube, Spotify or Apple Music link. We isolate the lead vocal and write it
        out as Tonic Solfa and staff notation, with the song and artist credited on the sheet.
      </Text>

      <Card style={styles.card}>
        <View style={styles.inputRow}>
          <Ionicons
            name={provider === "youtube" ? "logo-youtube" : provider ? "musical-notes" : "link-outline"}
            size={18}
            color={provider ? colors.accent : colors.textFaint}
          />
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://www.youtube.com/watch?v=…"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={submit}
            editable={!busy}
            style={styles.input}
            accessibilityLabel="Song link"
          />
          {url.length > 0 && !busy ? (
            <Touchable onPress={() => setUrl("")} hitSlop={8} ripple="borderless" accessibilityLabel="Clear">
              <Ionicons name="close-circle" size={18} color={colors.textFaint} />
            </Touchable>
          ) : null}
        </View>
        {url.trim().length > 0 && !provider ? (
          <Text style={styles.hintDanger}>{songLinkHint(url)}</Text>
        ) : provider ? (
          <Text style={styles.hint}>
            {PROVIDER_LABEL[provider]}
            {provider !== "youtube" ? " — we'll find the song on YouTube by its title and artist." : ""}
          </Text>
        ) : null}

        <Button
          label={busy ? "Transcribing…" : "Transcribe this song"}
          icon="sparkles"
          variant="primary"
          onPress={submit}
          disabled={!provider || busy}
          loading={busy}
          style={styles.submit}
        />

        {known ? (
          <View style={styles.entitlement}>
            <Ionicons name={isPro ? "star" : "information-circle-outline"} size={14} color={isPro ? colors.premiumDeep : colors.textMuted} />
            <Text style={styles.entitlementText}>
              {isPro
                ? `Pro: up to 6 minutes per song, ${credits ?? "—"} of ${creditsTotal ?? 20} songs left this month, fast lane.`
                : credits === 0
                  ? "Your free preview is used. Upgrade to Pro for full songs and downloads."
                  : "Free preview: the first 60 seconds of one song. Upgrade for full songs and the PDF."}
            </Text>
          </View>
        ) : null}
      </Card>

      {busy ? (
        <Card style={styles.card}>
          <View style={styles.song}>
            {state.source?.thumbnailUrl ? (
              <Image source={{ uri: state.source.thumbnailUrl }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]}>
                <ActivityIndicator color={colors.accent} />
              </View>
            )}
            <View style={styles.songText}>
              <Text style={styles.songTitle} numberOfLines={2}>
                {state.source?.title ?? "Reading the link…"}
              </Text>
              {state.source?.artist ? <Text style={styles.songArtist} numberOfLines={1}>{state.source.artist}</Text> : null}
            </View>
          </View>

          <View style={styles.stages}>
            {STAGES.map((s, i) => {
              const done = stageIndex > i;
              const on = stageIndex === i;
              return (
                <View key={s.key} style={[styles.stage, on && styles.stageOn, done && styles.stageDone]}>
                  <Ionicons
                    name={done ? "checkmark-circle" : on ? "ellipse" : "ellipse-outline"}
                    size={12}
                    color={done ? colors.success : on ? colors.accent : colors.textFaint}
                  />
                  <Text style={[styles.stageText, on && styles.stageTextOn, done && styles.stageTextDone]}>{s.label}</Text>
                </View>
              );
            })}
          </View>
          <View style={styles.bar}>
            <Animated.View
              style={[
                styles.barFill,
                { width: barWidth.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) },
              ]}
            />
          </View>
          <Text style={styles.progressNote}>
            A full song takes a few minutes. We'll notify you when it's ready if you leave.
          </Text>
        </Card>
      ) : null}

      {state.status === "failed" && state.error ? (
        <Card style={{ ...styles.card, ...styles.errorCard }}>
          <Text style={styles.errorTitle}>{wantsUpgrade ? "That's a Pro feature" : "Couldn't transcribe that"}</Text>
          <Text style={styles.errorText}>{state.error}</Text>
          <View style={styles.errorActions}>
            {wantsUpgrade ? (
              <Button label="See Pro plans" icon="star" variant="primary" onPress={() => nav.navigate("Upgrade")} />
            ) : (
              <Button
                label="Upload the audio instead"
                icon="folder-open-outline"
                variant="secondary"
                onPress={() => nav.navigate("Tabs", { screen: "Record", params: { autoPickAudio: true } })}
              />
            )}
            <Button label="Try again" variant="secondary" onPress={reset} />
          </View>
        </Card>
      ) : null}

      <Text style={styles.legal}>
        Transcriptions are for personal and choir rehearsal use. The song's audio is deleted the moment
        the job finishes; only the notes are kept.
      </Text>
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
    backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    pageTitle: { fontFamily: fonts.semibold, fontSize: 18, color: c.text },
    lead: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: c.textMuted, marginBottom: spacing.md },
    card: { marginBottom: spacing.md },
    inputRow: {
      flexDirection: "row", alignItems: "center", gap: spacing.sm,
      borderWidth: 1, borderColor: c.border, borderRadius: radii.md, paddingHorizontal: spacing.md,
      backgroundColor: c.surface, minHeight: 50,
    },
    input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: c.text, paddingVertical: spacing.sm },
    hint: { fontFamily: fonts.regular, fontSize: 12, color: c.textMuted, marginTop: spacing.xs },
    hintDanger: { fontFamily: fonts.regular, fontSize: 12, color: c.danger, marginTop: spacing.xs },
    submit: { marginTop: spacing.md },
    entitlement: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: spacing.md },
    entitlementText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: c.textMuted },
    song: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    thumb: { width: 64, height: 64, borderRadius: radii.md, backgroundColor: c.surfaceAlt },
    thumbEmpty: { alignItems: "center", justifyContent: "center" },
    songText: { flex: 1 },
    songTitle: { fontFamily: fonts.semibold, fontSize: 16, color: c.text },
    songArtist: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 2 },
    stages: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
    stage: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: c.surfaceAlt },
    stageOn: { backgroundColor: c.accentSoft },
    stageDone: { backgroundColor: c.surfaceAlt },
    stageText: { fontFamily: fonts.medium, fontSize: 12, color: c.textFaint },
    stageTextOn: { color: c.accent },
    stageTextDone: { color: c.success },
    bar: { height: 6, borderRadius: 3, backgroundColor: c.border, overflow: "hidden", marginTop: spacing.md },
    barFill: { height: "100%", backgroundColor: c.accent },
    progressNote: { fontFamily: fonts.regular, fontSize: 12, color: c.textMuted, marginTop: spacing.sm },
    errorCard: { borderColor: c.danger, borderWidth: 1 },
    errorTitle: { fontFamily: fonts.semibold, fontSize: 15, color: c.text, marginBottom: 4 },
    errorText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: c.textMuted },
    errorActions: { gap: spacing.sm, marginTop: spacing.md },
    legal: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: c.textFaint, textAlign: "center", marginTop: spacing.lg },
  });
