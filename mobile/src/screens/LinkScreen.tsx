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
 *
 * As soon as the pasted text holds a link we can read, the link is looked up
 * (`/api/transcriptions/link/info`): the song's title, artist, artwork and length appear
 * under the field, and a two-thumb picker chooses which section to transcribe — the
 * first of the allowance by default, the whole song when it fits. The section travels
 * with the job as `startSeconds`/`endSeconds`; the credit on the sheet names it.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { RangePicker } from "../components/RangePicker";
import { useJobPolling } from "../lib/useJobPolling";
import { useSubscription } from "../lib/subscription";
import { markPractisedToday } from "../lib/practiceReminder";
import { extractSongUrl, songLinkHint } from "../lib/songLink";
import { defaultRange, fitsWhole, formatClock, isWholeSong, sectionLabel, type ClipRange } from "../lib/clipRange";
import { toApiError } from "../api/client";
import { transcriptionsApi } from "../api/endpoints";
import { OFFLINE_LINE, STALLED_LINE, percentLabel, stageLabel } from "../lib/jobProgress";
import { keyboardTranspose } from "../lib/keyboardTranspose";
import { fonts, radii, spacing, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { LinkInfo, TranscriptionStage } from "../api/types";
import type { RootStackParams } from "../navigation/types";

type Nav = NativeStackNavigationProp<RootStackParams>;

const STAGES: { key: TranscriptionStage; label: string }[] = [
  { key: "queued", label: "Waiting in line" },
  { key: "fetching", label: "Fetching audio" },
  { key: "separating", label: "Isolating the voice" },
  { key: "transcribing", label: "Writing the solfa" },
];

const PROVIDER_LABEL = { youtube: "YouTube", spotify: "Spotify", apple_music: "Apple Music" } as const;

/** How long to wait after the last keystroke before looking the link up. */
const INFO_DEBOUNCE_MS = 500;

/** The song's length when the service knew it; null (so no picker) for a missing, zero or broken figure. */
function knownLength(seconds: number | null | undefined): number | null {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function LinkScreen() {
  const nav = useNavigation<Nav>();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { state, startLink, retry, reset } = useJobPolling();
  const { isPro, known, subscription, refresh } = useSubscription();

  const [url, setUrl] = useState("");
  // Share text ("Listen to … on Spotify: https://…") is read down to its link, the one rule the
  // worker applies (lib/songLink); only the link itself is sent.
  const found = useMemo(() => extractSongUrl(url), [url]);
  const provider = found?.provider ?? null;
  const busy = state.status === "pending" || state.status === "processing";

  // ── The song behind the link, and the section of it to take ─────────────
  // `info` is keyed by the link it was fetched for, so a changed field never shows the
  // previous song; the sequence number drops a lookup that finishes after the next began.
  const [info, setInfo] = useState<{ url: string; data: LinkInfo } | null>(null);
  const [infoBusy, setInfoBusy] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [range, setRange] = useState<ClipRange | null>(null);
  const lookupSeq = useRef(0);
  const foundUrl = found?.url ?? null;

  useEffect(() => {
    const seq = ++lookupSeq.current;
    if (!foundUrl) {
      setInfo(null);
      setInfoError(null);
      setInfoBusy(false);
      setRange(null);
      return;
    }
    setInfoError(null);
    setInfoBusy(true);
    const timer = setTimeout(async () => {
      try {
        const data = await transcriptionsApi.linkInfo(foundUrl);
        if (lookupSeq.current !== seq) return;
        setInfo({ url: foundUrl, data });
        const length = knownLength(data.durationSeconds);
        setRange(length != null ? defaultRange(length, data.maxSeconds) : null);
      } catch (e) {
        if (lookupSeq.current !== seq) return;
        // A plain sentence from the API, or the client's own; never a server detail.
        setInfoError(toApiError(e).message);
        setInfo(null);
        setRange(null);
      } finally {
        if (lookupSeq.current === seq) setInfoBusy(false);
      }
    }, INFO_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [foundUrl]);

  const song = info && info.url === foundUrl ? info.data : null;
  const duration = song ? knownLength(song.durationSeconds) : null;
  const maxSeconds = song?.maxSeconds ?? null;
  // The section to send: only when the song's length is known, so the thumbs mean something.
  const section = song && duration != null && maxSeconds != null && range ? range : null;

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

  // While the link is being read the button waits, so the song and the picker are seen before
  // anything is transcribed; a lookup that failed leaves it enabled and the server has the final say.
  const canSubmit = found !== null && !busy && !infoBusy;

  function submit() {
    if (!found || !canSubmit) return;
    void startLink(found.url, {
      mode: "melody",
      keyboardTranspose: keyboardTranspose() || undefined,
      startSeconds: section?.start,
      endSeconds: section?.end,
    });
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

      {!busy && (
      <Text style={styles.lead}>
        Paste a YouTube, Spotify or Apple Music link. We isolate the lead vocal and write it
        out as Tonic Solfa and staff notation, with the song and artist credited on the sheet.
      </Text>
      )}

      {!busy && (
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

        {provider && !busy ? (
          song ? (
            <View style={styles.infoBlock}>
              <View style={styles.song}>
                {song.thumbnailUrl ? (
                  <Image source={{ uri: song.thumbnailUrl }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty]}>
                    <Ionicons name="musical-notes" size={22} color={colors.textMuted} />
                  </View>
                )}
                <View style={styles.songText}>
                  <Text style={styles.songTitle} numberOfLines={2}>
                    {song.title}
                    {song.artist ? <Text style={styles.songArtistInline}> · {song.artist}</Text> : null}
                  </Text>
                  <Text style={styles.songArtist}>
                    {duration != null ? `Total length ${formatClock(duration)}` : "Length not known"}
                  </Text>
                </View>
              </View>

              {duration != null && maxSeconds != null && range ? (
                <>
                  <Text style={styles.pickTitle}>Choose the part to transcribe</Text>
                  <RangePicker duration={duration} maxSeconds={maxSeconds} value={range} onChange={setRange} />
                  <View style={styles.chips}>
                    <Touchable
                      onPress={() => setRange(defaultRange(duration, maxSeconds))}
                      style={styles.chip}
                      radius={radii.pill}
                      accessibilityLabel="From the start"
                    >
                      <Ionicons name="play-skip-back-outline" size={13} color={colors.accent} />
                      <Text style={styles.chipText}>From the start</Text>
                    </Touchable>
                    {fitsWhole(duration, maxSeconds) ? (
                      <Touchable
                        onPress={() => setRange({ start: 0, end: Math.floor(duration) })}
                        style={styles.chip}
                        radius={radii.pill}
                        disabled={isWholeSong(range, duration)}
                        accessibilityLabel="Whole song"
                        accessibilityState={{ disabled: isWholeSong(range, duration) }}
                      >
                        <Ionicons name="musical-note-outline" size={13} color={colors.accent} />
                        <Text style={styles.chipText}>Whole song</Text>
                      </Touchable>
                    ) : null}
                  </View>
                  <Text style={styles.hint}>
                    {isPro
                      ? `Up to ${formatClock(maxSeconds)} at a time on Pro.`
                      : `Up to ${formatClock(maxSeconds)} on the free preview — Pro takes up to 6:00 of any song.`}
                  </Text>
                </>
              ) : (
                <Text style={styles.hint}>
                  We couldn't read how long this song is, so we'll transcribe the first{" "}
                  {maxSeconds != null ? formatClock(maxSeconds) : "part"}.
                </Text>
              )}
            </View>
          ) : infoBusy ? (
            <View style={styles.infoRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.hint}>Reading the link…</Text>
            </View>
          ) : infoError ? (
            <Text style={styles.hintDanger}>{infoError}</Text>
          ) : null
        ) : null}

        <Button
          label={busy ? "Transcribing…" : "Transcribe this song"}
          icon="sparkles"
          variant="primary"
          onPress={submit}
          disabled={!canSubmit}
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
      )}

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
              {section && duration != null && !isWholeSong(section, duration) ? (
                <Text style={styles.songArtist}>{sectionLabel(section.start, section.end, duration)}</Text>
              ) : null}
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
                  <Text style={[styles.stageText, on && styles.stageTextOn, done && styles.stageTextDone]}>
                    {on ? stageLabel(s.key, state.queuePosition) : s.label}
                  </Text>
                </View>
              );
            })}
          </View>
          <View style={styles.barRow}>
            <View style={styles.bar}>
              <Animated.View
                style={[
                  styles.barFill,
                  { width: barWidth.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) },
                ]}
              />
            </View>
            <Text style={styles.barPct}>{percentLabel(state.progress)}</Text>
          </View>
          <Text style={styles.progressNote}>
            A full song takes a few minutes. We'll notify you when it's ready if you leave.
          </Text>
          {/* The wait explained in plain words: a busy server and an unreachable one are different
              things, and neither is the job failing. Server text never reaches this card. */}
          {state.stalled ? <Text style={styles.progressWarn}>{STALLED_LINE}</Text> : null}
          {state.offline ? <Text style={styles.progressWarn}>{OFFLINE_LINE}</Text> : null}
          {state.canRetry ? (
            <Button
              label="Try again"
              icon="refresh-outline"
              variant="secondary"
              onPress={() => void retry()}
              style={styles.submit}
            />
          ) : null}
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
    infoBlock: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: c.borderLight },
    infoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
    pickTitle: { fontFamily: fonts.medium, fontSize: 13, color: c.text, marginTop: spacing.md },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
    chip: {
      flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 7, paddingHorizontal: 12,
      borderRadius: radii.pill, backgroundColor: c.accentSoft,
    },
    chipText: { fontFamily: fonts.medium, fontSize: 12, color: c.accent },
    song: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    thumb: { width: 64, height: 64, borderRadius: radii.md, backgroundColor: c.surfaceAlt },
    thumbEmpty: { alignItems: "center", justifyContent: "center" },
    songText: { flex: 1 },
    songTitle: { fontFamily: fonts.semibold, fontSize: 16, color: c.text },
    songArtistInline: { fontFamily: fonts.regular, fontSize: 15, color: c.textMuted },
    songArtist: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 2 },
    stages: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
    stage: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: c.surfaceAlt },
    stageOn: { backgroundColor: c.accentSoft },
    stageDone: { backgroundColor: c.surfaceAlt },
    stageText: { fontFamily: fonts.medium, fontSize: 12, color: c.textFaint },
    stageTextOn: { color: c.accent },
    stageTextDone: { color: c.success },
    barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
    bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: c.border, overflow: "hidden" },
    barFill: { height: "100%", backgroundColor: c.accent },
    barPct: { fontFamily: fonts.semibold, fontSize: 12, color: c.accent, minWidth: 38, textAlign: "right", fontVariant: ["tabular-nums"] },
    progressNote: { fontFamily: fonts.regular, fontSize: 12, color: c.textMuted, marginTop: spacing.sm },
    progressWarn: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, color: c.warning, marginTop: spacing.sm },
    errorCard: { borderColor: c.danger, borderWidth: 1 },
    errorTitle: { fontFamily: fonts.semibold, fontSize: 15, color: c.text, marginBottom: 4 },
    errorText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: c.textMuted },
    errorActions: { gap: spacing.sm, marginTop: spacing.md },
    legal: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: c.textFaint, textAlign: "center", marginTop: spacing.lg },
  });
