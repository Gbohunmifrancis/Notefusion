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
 * (`/api/transcriptions/link/info`): the song's cover, title, artist and length appear
 * under the field, and a window over a waveform chooses which section to transcribe — the
 * first of the allowance by default, the whole song when it fits. The section travels
 * with the job as `startSeconds`/`endSeconds`; the credit on the sheet names it.
 *
 * The screen has three faces: ready (nothing readable pasted yet — the field and the
 * services a link can come from), found (the song and its section picker), and refused (a
 * link the API turned away by code, in its own plain sentence, beside the links that never
 * work). The app has no clipboard module, so there is no paste button: the field is
 * pasted into by hand.
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
import { Icon } from "../components/Icon";

import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Touchable } from "../components/Touchable";
import { RangePicker } from "../components/RangePicker";
import { Mark, Wordmark } from "../components/night/NightUI";
import { ProviderMark, SourceTiles } from "../components/link/SourceTiles";
import { PROVIDER_LABEL, SongCover } from "../components/link/SongCover";
import { NoticeCard, PillAction, RefusedLinks, linkRefusal } from "../components/link/LinkRefusal";
import { useJobPolling } from "../lib/useJobPolling";
import { useSubscription } from "../lib/subscription";
import { markPractisedToday } from "../lib/practiceReminder";
import { extractSongUrl, songLinkHint } from "../lib/songLink";
import { defaultRange, fitsWhole, formatClock, isWholeSong, sectionLabel, type ClipRange } from "../lib/clipRange";
import { toApiError } from "../api/client";
import { isNetworkCode } from "../lib/reachability";

/**
 * A song link is fetched by the server, so it cannot wait on the phone the way a recording does
 * (lib/outbox). Said plainly, with the way that does work offline.
 */
const LINK_OFFLINE =
  "Song links need the internet, so a link can't be saved to send later. Sing or hum it on Record instead — a recording waits on your phone and goes when you're back online.";
import { transcriptionsApi } from "../api/endpoints";
import { OFFLINE_LINE, STALLED_LINE, percentLabel, stageLabel } from "../lib/jobProgress";
import { keyboardTranspose } from "../lib/keyboardTranspose";
import { METER_CHOICES, meterEventValue, meterLabel, type Meter } from "../lib/meter";
import { logAnalyticsEvent } from "../lib/analytics";
import { fonts, nightFonts, radii, spacing, type Palette } from "../design/theme";
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
  const { isPro, known, subscription, refresh, boughtRemaining } = useSubscription();

  const [url, setUrl] = useState("");
  const [focused, setFocused] = useState(false);
  /** Beats in a bar for this song; null is Not sure. Back to Not sure once a song is sent (lib/meter). */
  const [meter, setMeter] = useState<Meter | null>(null);
  const inputRef = useRef<TextInput>(null);
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
  const [infoError, setInfoError] = useState<{ code: string; message: string } | null>(null);
  const [range, setRange] = useState<ClipRange | null>(null);
  // The last section dragged by hand, so "My pick" can bring it back after a preset.
  const [pick, setPick] = useState<ClipRange | null>(null);
  const lookupSeq = useRef(0);
  const foundUrl = found?.url ?? null;

  useEffect(() => {
    const seq = ++lookupSeq.current;
    setPick(null);
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
        const err = toApiError(e);
        setInfoError({ code: err.code, message: isNetworkCode(err.code) ? LINK_OFFLINE : err.message });
        setInfo(null);
        setRange(null);
      } finally {
        if (lookupSeq.current === seq) setInfoBusy(false);
      }
    }, INFO_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // Looked up again when a bought song arrives or is spent: it decides how much of the song is allowed.
  }, [foundUrl, boughtRemaining]);

  const song = info && info.url === foundUrl ? info.data : null;
  const duration = song ? knownLength(song.durationSeconds) : null;
  const maxSeconds = song?.maxSeconds ?? null;
  // The section to send: only when the song's length is known, so the thumbs mean something.
  const section = song && duration != null && maxSeconds != null && range ? range : null;
  // A link the API turned away by name (live, private, too long…) can never work, so the screen
  // says so instead of offering the button; any other failed lookup leaves the server the final say.
  const refusal = infoError ? linkRefusal(infoError.code) : null;

  const credits = subscription?.songCreditsRemaining;
  const creditsTotal = subscription?.songCreditsTotal;

  // ── Finish ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.status === "done" && state.result) {
      const result = state.result;
      const sourceJobId = state.jobId ?? undefined;
      // Filed in the Library by the server as it finished (option A): opened as the saved sheet.
      const savedId = state.savedId ?? undefined;
      const savedTitle = state.savedTitle ?? undefined;
      reset();
      refresh();
      void markPractisedToday();
      nav.replace("Result", {
        result,
        sourceJobId,
        title: savedTitle ?? (result.source ? result.source.title : undefined),
        fresh: true,
        savedId,
      });
    }
  }, [state.status, state.result, state.jobId, state.savedId, state.savedTitle, nav, reset, refresh]);

  // A failed job costs nothing (a song YouTube refused, a link that broke): the credit or preview it held
  // comes back, so the count is read again rather than left showing it spent. Once per job: `refresh` is a
  // new function after every read, and the job stays failed.
  const recountedFor = useRef<string | null>(null);
  useEffect(() => {
    if (state.status !== "failed" || !state.jobId || recountedFor.current === state.jobId) return;
    recountedFor.current = state.jobId;
    void refresh(false);
  }, [state.status, state.jobId, refresh]);

  const stageIndex = STAGES.findIndex((s) => s.key === state.stage);
  const barWidth = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    Animated.timing(barWidth, {
      toValue: busy ? Math.max(0.03, state.progress) : 0,
      duration: 500,
      // scaleX rather than width, so the bar fills on the UI thread while the JS thread
      // is busy polling the job.
      useNativeDriver: true,
    }).start();
  }, [busy, state.progress, barWidth]);

  // While the link is being read the button waits, so the song and the picker are seen before
  // anything is transcribed; a lookup that failed leaves it enabled and the server has the final say.
  const canSubmit = found !== null && !busy && !infoBusy;

  async function submit() {
    if (!found || !canSubmit) return;
    void logAnalyticsEvent("beats_in_a_bar", { meter: meterEventValue(meter), source: "link" });
    const jobId = await startLink(found.url, {
      mode: "melody",
      keyboardTranspose: keyboardTranspose() || undefined,
      timeSignature: meter ?? undefined,
      startSeconds: section?.start,
      endSeconds: section?.end,
    });
    if (jobId) setMeter(null);
  }

  function tryAnother() {
    setUrl("");
    inputRef.current?.focus();
  }

  const uploadInstead = () => nav.navigate("Tabs", { screen: "Record", params: { autoPickAudio: true } });

  const upgradeCodes = new Set(["BILLING_SONG_PREVIEW_USED", "BILLING_FREE_TIER_LIMIT"]);
  const wantsUpgrade = state.status === "failed" && state.errorCode !== null && upgradeCodes.has(state.errorCode);
  const linkOffline = state.status === "failed" && isNetworkCode(state.errorCode);

  // Back from buying this song: the refusal no longer holds, so the link (still in the field) is ready to
  // send again without another tap on Try again.
  const boughtBefore = useRef(boughtRemaining);
  useEffect(() => {
    if (boughtRemaining > boughtBefore.current && wantsUpgrade) reset();
    boughtBefore.current = boughtRemaining;
  }, [boughtRemaining, wantsUpgrade, reset]);

  // Ready: nothing we can read yet, so the screen introduces itself and the services.
  const ready = !provider;

  // Which preset the section matches, for the chips. A song that fits whole starts as the whole song.
  const first = duration != null && maxSeconds != null ? defaultRange(duration, maxSeconds) : null;
  const preset =
    section && duration != null && first
      ? isWholeSong(section, duration)
        ? "whole"
        : section.start === first.start && section.end === first.end
          ? "start"
          : "pick"
      : null;

  const chip = (label: string, on: boolean, onPress: () => void, a11y?: string) => (
    <Touchable
      key={label}
      onPress={onPress}
      style={[styles.chip, on && styles.chipOn]}
      radius={radii.pill}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Touchable>
  );

  return (
    <Screen scroll>
      <View style={styles.headerRow}>
        <Touchable
          onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate("Tabs", { screen: "Home" }))}
          style={styles.backBtn}
          hitSlop={8}
          radius={20}
          accessibilityLabel="Go back"
        >
          <Icon name="back" size={20} color={colors.text} />
        </Touchable>
        {ready && !busy ? (
          <View style={styles.lockup} accessible accessibilityLabel="Notefusion">
            <Mark height={20} color={colors.text} />
            <Wordmark size={16} style={{ color: colors.text }} />
          </View>
        ) : (
          <Text style={styles.pageTitle} accessibilityRole="header">Song from a link</Text>
        )}
        <View style={styles.headerSpacer} />
      </View>

      {!busy && ready ? (
        <>
          <Text style={styles.title} accessibilityRole="header">Song from{"\n"}a link</Text>
          <Text style={styles.lead}>We isolate the lead voice and write it out in solfa and staff.</Text>
          {/* Said before anyone pastes: YouTube blocks server downloads for many songs, and a recording always works. */}
          <Text style={styles.lead}>
            Links work for many songs, not all. If yours fails, record it or import the audio file instead.
          </Text>
        </>
      ) : null}

      {!busy ? (
        <View style={[styles.ring, ready && focused && styles.ringOn]}>
          <View
            style={[
              styles.field,
              ready ? styles.fieldLarge : styles.fieldCompact,
              ready && focused && styles.fieldFocused,
              refusal && styles.fieldRefused,
            ]}
          >
            {provider ? (
              <ProviderMark provider={provider} size={30} />
            ) : (
              <Icon name="link" size={20} color={focused ? colors.link : colors.textFaint} />
            )}
            <TextInput
              ref={inputRef}
              value={url}
              onChangeText={setUrl}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Paste a song link"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={submit}
              editable={!busy}
              selectionColor={colors.accent}
              style={[styles.input, url.length > 0 && styles.inputFilled]}
              accessibilityLabel="Song link"
            />
            {url.length > 0 ? (
              <Touchable onPress={() => setUrl("")} hitSlop={8} ripple="borderless" accessibilityLabel="Clear">
                <Icon name="close" size={20} color={colors.textMuted} />
              </Touchable>
            ) : null}
          </View>
        </View>
      ) : null}

      {!busy && url.trim().length > 0 && !provider ? (
        <View style={styles.note}>
          <Icon name="problem" size={16} color={colors.warning} />
          <Text style={styles.noteText}>{songLinkHint(url)}</Text>
        </View>
      ) : null}

      {!busy && ready ? (
        <>
          <Text style={styles.eyebrow}>Works with</Text>
          <SourceTiles />
          <Text style={styles.tip}>Tip: in any of these apps tap Share, then Copy link.</Text>
        </>
      ) : null}

      {!busy && provider && refusal && infoError ? (
        <>
          <NoticeCard icon={refusal.icon} title={refusal.title} message={infoError.message}>
            <PillAction label="Try another link" tone="solid" onPress={tryAnother} />
            <PillAction label="Upload a file" onPress={uploadInstead} />
          </NoticeCard>
          <RefusedLinks />
        </>
      ) : null}

      {!busy && provider && !refusal ? (
        <>
          {provider !== "youtube" && !song ? (
            <Text style={styles.hint}>
              {PROVIDER_LABEL[provider]} — we'll find the song on YouTube by its title and artist.
            </Text>
          ) : null}

          {song ? (
            <>
              <SongCover song={song} provider={provider} duration={duration} />

              {duration != null && maxSeconds != null && range ? (
                <>
                  <View style={styles.pickHead}>
                    <Text style={styles.pickTitle}>Which part?</Text>
                    <Text style={styles.pickRange}>
                      {formatClock(range.start)} – {formatClock(range.end)} · {formatClock(range.end - range.start)} long
                    </Text>
                  </View>
                  <RangePicker
                    duration={duration}
                    maxSeconds={maxSeconds}
                    value={range}
                    onChange={(next) => {
                      setRange(next);
                      setPick(next);
                    }}
                  />
                  <View style={styles.chips}>
                    {chip("From the start", preset === "start", () => setRange(defaultRange(duration, maxSeconds)))}
                    {pick ? chip("My pick", preset === "pick", () => setRange(pick)) : null}
                    {fitsWhole(duration, maxSeconds)
                      ? chip("Whole song", preset === "whole", () => setRange({ start: 0, end: Math.floor(duration) }))
                      : null}
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
            </>
          ) : infoBusy ? (
            <View style={styles.reading}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.readingText}>Reading the link…</Text>
            </View>
          ) : infoError ? (
            <View style={styles.note}>
              <Icon name="problem" size={16} color={colors.warning} />
              <Text style={styles.noteText}>{infoError.message}</Text>
            </View>
          ) : null}

          <Text style={[styles.pickTitle, styles.meterTitle]}>Beats in a bar</Text>
          <View style={styles.chips}>
            {METER_CHOICES.map((m) =>
              chip(m.short, meter === m.value, () => setMeter(m.value), `Beats in a bar: ${m.label}`),
            )}
          </View>
          <Text style={styles.hint}>{meterLabel(meter)}</Text>

          {known ? (
            <View style={styles.entitlement}>
              <Mark height={14} color={isPro ? colors.textMuted : colors.textFaint} />
              <Text style={styles.entitlementText}>
                {isPro
                  ? credits == null
                    ? `Pro: ${creditsTotal ?? 20} songs a month, in the fast lane.`
                    : credits > 0
                      ? `Uses 1 of your ${credits} songs left this month`
                      : `All ${creditsTotal ?? 20} of this month's songs are used.`
                  : boughtRemaining > 0
                    ? "Uses the song you bought: the whole song, up to six minutes."
                    : credits === 0
                      ? "Your free preview is used. Buy just this song, or go Pro for full songs and downloads."
                      : "Free preview: the first 60 seconds of one song. Buy the whole song, or go Pro."}
              </Text>
            </View>
          ) : null}

          <Button
            label={section && duration != null && !isWholeSong(section, duration) ? "Transcribe this part" : "Transcribe this song"}
            variant="primary"
            onPress={submit}
            disabled={!canSubmit}
            style={styles.submit}
          />
        </>
      ) : null}

      {busy ? (
        <Card style={styles.progressCard}>
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
                <Text style={styles.songSection}>{sectionLabel(section.start, section.end, duration)}</Text>
              ) : null}
            </View>
          </View>

          <View style={styles.stages}>
            {STAGES.map((s, i) => {
              const done = stageIndex > i;
              const on = stageIndex === i;
              return (
                <View key={s.key} style={[styles.stage, on && styles.stageOn]}>
                  <Icon
                    name={done ? "done" : "step"}
                    size={12}
                    filled={on}
                    color={done ? colors.success : on ? colors.link : colors.textFaint}
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
                  { transformOrigin: "left", transform: [{ scaleX: barWidth }] },
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
              icon="retry"
              variant="secondary"
              onPress={() => void retry()}
              style={styles.submit}
            />
          ) : null}
        </Card>
      ) : null}

      {state.status === "failed" && state.error ? (
        <NoticeCard
          icon={wantsUpgrade ? "pro" : linkOffline ? "offline" : "problem"}
          title={wantsUpgrade ? "Your free songs are used" : linkOffline ? "You're offline" : "Couldn't transcribe that"}
          message={linkOffline ? LINK_OFFLINE : state.error}
        >
          {wantsUpgrade ? (
            <>
              <PillAction
                label="Just this song"
                tone="solid"
                onPress={() => nav.navigate("Upgrade", { reason: "limit" })}
              />
              <PillAction label="See Pro plans" onPress={() => nav.navigate("Upgrade")} />
            </>
          ) : (
            <PillAction label="Upload the audio instead" tone="solid" onPress={uploadInstead} />
          )}
          <PillAction label="Try again" onPress={reset} />
        </NoticeCard>
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
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
    backBtn: {
      width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
    },
    headerSpacer: { width: 40 },
    lockup: { flexDirection: "row", alignItems: "center", gap: 7 },
    pageTitle: { fontFamily: fonts.medium, fontSize: 15, color: c.text },
    title: { fontFamily: fonts.semibold, fontSize: 34, lineHeight: 36, letterSpacing: -1.4, color: c.text, marginTop: 28 },
    lead: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: c.textMuted, marginTop: 10 },

    // The focus ring is a padded wrapper rather than a shadow, so it draws the same on Android.
    ring: { borderRadius: 999, padding: 4, marginHorizontal: -4, marginTop: spacing.lg },
    ringOn: { backgroundColor: c.accentSoft },
    field: {
      flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 999,
      backgroundColor: c.surfaceAlt, borderWidth: 1.5, borderColor: c.border,
    },
    fieldLarge: { height: 60, paddingLeft: 20, paddingRight: 18 },
    fieldCompact: { height: 52, paddingLeft: 11, paddingRight: 16 },
    fieldFocused: { borderColor: c.ink },
    fieldRefused: { borderColor: c.warning + "66" },
    input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: c.text, paddingVertical: 0 },
    inputFilled: { fontFamily: nightFonts.mono, fontSize: 13.5 },

    note: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: spacing.md, paddingHorizontal: spacing.xs },
    noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: c.textMuted },
    eyebrow: {
      fontFamily: fonts.medium, fontSize: 12, letterSpacing: 1.7, textTransform: "uppercase",
      color: c.textMuted, marginTop: 30,
    },
    tip: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: c.textFaint, textAlign: "center", marginTop: spacing.lg },
    hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: c.textMuted, marginTop: spacing.sm },
    reading: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.xs },
    readingText: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted },

    pickHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 22 },
    pickTitle: { fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    meterTitle: { marginTop: 22 },
    pickRange: { fontFamily: nightFonts.mono, fontSize: 12.5, color: c.accent },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
    chip: {
      height: 30, paddingHorizontal: 12, borderRadius: radii.pill, justifyContent: "center",
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
    },
    chipOn: { backgroundColor: c.accentSoft, borderColor: c.ink },
    chipText: { fontFamily: fonts.medium, fontSize: 12.5, color: c.textMuted },
    chipTextOn: { color: c.accent },

    entitlement: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: spacing.xl, paddingHorizontal: spacing.md },
    entitlementText: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: c.textMuted, textAlign: "center" },
    submit: { marginTop: spacing.md },

    progressCard: { marginTop: spacing.lg },
    song: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    thumb: { width: 64, height: 64, borderRadius: radii.md, backgroundColor: c.surfaceAlt },
    thumbEmpty: { alignItems: "center", justifyContent: "center" },
    songText: { flex: 1 },
    songTitle: { fontFamily: fonts.semibold, fontSize: 16, color: c.text },
    songArtist: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 2 },
    songSection: { fontFamily: nightFonts.mono, fontSize: 12, color: c.accent, marginTop: 4 },
    stages: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
    stage: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: c.surfaceAlt },
    stageOn: { backgroundColor: c.accentSoft },
    stageText: { fontFamily: fonts.medium, fontSize: 12, color: c.textFaint },
    stageTextOn: { color: c.accent },
    stageTextDone: { color: c.success },
    barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
    bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: c.border, overflow: "hidden" },
    barFill: { width: "100%", height: "100%", backgroundColor: c.ink },
    barPct: { fontFamily: nightFonts.mono, fontSize: 12, color: c.accent, minWidth: 42, textAlign: "right" },
    progressNote: { fontFamily: fonts.regular, fontSize: 12, color: c.textMuted, marginTop: spacing.sm },
    progressWarn: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, color: c.warning, marginTop: spacing.sm },
    legal: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: c.textFaint, textAlign: "center", marginTop: spacing.xl },
  });
