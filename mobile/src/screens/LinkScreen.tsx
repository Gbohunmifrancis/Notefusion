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
 * work). While the field is empty it carries a Paste pill (board m-ux-medium P3a): one tap reads
 * the clipboard, only then, with React Native's own Clipboard (still in core, so no store build),
 * and the link is looked up as if it had been typed.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Clipboard,
  Image,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Icon } from "../components/Icon";

import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Touchable } from "../components/Touchable";
import { RangePicker } from "../components/RangePicker";
import { Skeleton } from "../components/Skeleton";
import { Mark, Wordmark } from "../components/night/NightUI";
import { ProviderMark, SourceTiles } from "../components/link/SourceTiles";
import { PROVIDER_LABEL, SongCover } from "../components/link/SongCover";
import { NoticeCard, RefusedLinks, linkRefusal } from "../components/link/LinkRefusal";
import { Chip } from "../components/Chip";
import { useJobPolling } from "../lib/useJobPolling";
import { useSubscription } from "../lib/subscription";
import { useAuth } from "../lib/auth";
import { linkJobStore } from "../lib/linkJobStore";
import type { LinkJobOptions, LinkSong } from "../lib/linkJob";
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
import { billingApi, transcriptionsApi } from "../api/endpoints";
import { OFFLINE_LINE, STALLED_LINE, percentLabel, stageLabel } from "../lib/jobProgress";
import { keyboardTranspose } from "../lib/keyboardTranspose";
import { METER_CHOICES, meterEventValue, meterLabel, meterSummary, type Meter } from "../lib/meter";
import { logAnalyticsEvent } from "../lib/analytics";
import { logAppEvent } from "../lib/appEvents";
import { linkEntitlement } from "../lib/linkEntitlement";
import { EXAMPLE_HYMN } from "../lib/exampleSheet";
import { hymnSheet, openingLine } from "../lib/hymnPack";
import { exampleResult } from "../lib/openSheet";
import { deriveSolfa } from "../lib/solfa";
import { formatPrice, limitOffer, type LimitOffer } from "../lib/price";
import { fonts, motion, nightFonts, radii, spacing, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { LinkInfo, Plan, TranscriptionStage } from "../api/types";
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
  const insets = useSafeAreaInsets();
  const { state, startLink, resumeLink, retry, reset } = useJobPolling();
  const { isPro, known, subscription, refresh, boughtRemaining } = useSubscription();
  const { user } = useAuth();

  const [url, setUrl] = useState("");
  const [focused, setFocused] = useState(false);
  /**
   * The last change came whole (the Paste pill, or the keyboard's paste): "not a song link" may be said at once. While
   * a link is typed letter by letter it waits until the field is left, rather than nagging at every keystroke.
   */
  const [pasted, setPasted] = useState(false);
  /** The example's opening in solfa ("s, d m d m r d l,"), as exampleSheet.test.ts reads it. */
  const exampleOpening = useMemo(() => {
    const sheet = hymnSheet(EXAMPLE_HYMN);
    return openingLine(deriveSolfa(sheet.notes, sheet.key, sheet.timeSignature).notes);
  }, []);
  /** The last step's height, so the timeline's line stops at its number rather than under its words. */
  const [lastStepHeight, setLastStepHeight] = useState(0);
  /** Beats in a bar for this song; null is Not sure. Back to Not sure once a song is sent (lib/meter). */
  const [meter, setMeter] = useState<Meter | null>(null);
  /** "More options" unfolded: the Beats-in-a-bar chips, folded away by default (board l-ux-high 02b). */
  const [moreOpen, setMoreOpen] = useState(false);
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
  // What the pinned bar says and offers (board l-ux-high 02c): with nothing left for a song it offers the ways on
  // instead of a Transcribe that could only end in a refusal card. Unknown until the subscription is read.
  const entitlement = known
    ? linkEntitlement({ isPro, credits, creditsTotal, boughtRemaining })
    : null;

  /**
   * The region's one-song purchase and Pro by the month, as Record's limit sheet reads them, for the bar's
   * "Buy this song · ₦3,000". Read once for a free account; until they arrive, or if they fail, it goes without the price.
   */
  const [offer, setOffer] = useState<LimitOffer>({});
  useEffect(() => {
    if (!known || isPro) return;
    let live = true;
    void Promise.all([
      billingApi.plans().catch(() => [] as Plan[]),
      billingApi.singlePlans().catch(() => [] as Plan[]),
    ]).then(([pro, single]) => {
      if (live) setOffer(limitOffer(pro, single));
    });
    return () => {
      live = false;
    };
  }, [known, isPro]);

  // ── Finish ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.status === "done" && state.result) {
      const result = state.result;
      const sourceJobId = state.jobId ?? undefined;
      // Filed in the Library by the server as it finished (option A): opened as the saved sheet.
      const savedId = state.savedId ?? undefined;
      const savedTitle = state.savedTitle ?? undefined;
      linkJobStore.clear();
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

  // ── The job card comes back (lib/linkJob) ────────────────────────────────
  // A song takes minutes, and leaving the screen meanwhile used to lose its card. The link sent is kept until its
  // job ends, and on coming back the screen follows it again while it still runs.
  /** The link and options last sent, for "Try again" to keep the job it sends instead. */
  const sent = useRef<{ url: string; opts: LinkJobOptions; song?: LinkSong } | null>(null);
  /** Kept with the song it is, so the Library's "On its way" names it from the start (board m-ux-medium P2e). */
  function remember(jobId: string | null, link: string, opts: LinkJobOptions, kept?: LinkSong) {
    sent.current = { url: link, opts, song: kept };
    if (jobId && user) linkJobStore.save({ jobId, url: link, userId: user.id, sentAt: Date.now(), opts, song: kept });
  }
  useEffect(() => {
    if (!user) return;
    let live = true;
    void linkJobStore.read(user.id).then(async (kept) => {
      if (!live || !kept) return;
      const outcome = await resumeLink(kept.jobId, kept.url, kept.opts);
      if (!live) return;
      if (outcome === "running") sent.current = { url: kept.url, opts: kept.opts, song: kept.song };
      else if (outcome === "ended") linkJobStore.clear();
    });
    return () => {
      live = false;
    };
    // Once, as the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A failed job has nothing left to follow; the link it was sent with goes back in the field to change or resend.
  useEffect(() => {
    if (state.status !== "failed") return;
    linkJobStore.clear();
    const link = sent.current?.url;
    if (link) setUrl((u) => u || link);
  }, [state.status]);

  /** "Try again": the same link sent afresh, and kept as the job to come back to. */
  async function sendAgain() {
    const jobId = await retry();
    if (sent.current) remember(jobId, sent.current.url, sent.current.opts, sent.current.song);
  }

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
  // anything is transcribed; a lookup that failed leaves it enabled and the server has the final say. With nothing
  // left for a song the bar offers the ways on instead, and the keyboard's Go does not send either.
  const canSubmit = found !== null && !busy && !infoBusy && (entitlement === null || entitlement.kind === "send");

  async function submit() {
    if (!found || !canSubmit) return;
    void logAnalyticsEvent("beats_in_a_bar", { meter: meterEventValue(meter), source: "link" });
    // Where the song is from and how much of it, never the link itself.
    logAppEvent("link_submitted", {
      provider: found.provider,
      sec: section ? Math.round(section.end - section.start) : null,
    });
    const opts: LinkJobOptions = {
      mode: "melody",
      keyboardTranspose: keyboardTranspose() || undefined,
      timeSignature: meter ?? undefined,
      startSeconds: section?.start,
      endSeconds: section?.end,
    };
    const jobId = await startLink(found.url, opts);
    remember(
      jobId,
      found.url,
      opts,
      song ? { title: song.title, artist: song.artist, thumbnailUrl: song.thumbnailUrl ?? null } : undefined,
    );
    if (jobId) setMeter(null);
  }

  function tryAnother() {
    setUrl("");
    inputRef.current?.focus();
  }

  /**
   * The Paste pill: the clipboard is read on this tap and never on open, and its text goes in the field as if typed,
   * so the link is looked up (or its hint shown) the same way. An empty clipboard opens the keyboard instead.
   */
  async function paste() {
    const text = (await Clipboard.getString().catch(() => "")).trim();
    if (text) {
      setUrl(text);
      setPasted(true);
    } else inputRef.current?.focus();
  }

  /** The failure card's way on: the card goes, and the link stays in the field to change or send again. */
  function changeLink() {
    reset();
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
  // A link we can send: Transcribe and its entitlement line sit in a bar pinned to the bottom edge, where the
  // thumb is (Song link opens over the tabs, so there is no tab bar under it).
  const docked = !busy && provider !== null && !refusal;

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

  // The app's one chip (board n-ux-low Q5e), the same as Record's options.
  const chip = (label: string, on: boolean, onPress: () => void, a11y?: string) => (
    <Chip key={label} label={label} selected={on} onPress={onPress} accessibilityLabel={a11y} />
  );

  return (
    <View style={styles.flex}>
      <Screen scroll contentStyle={styles.page}>
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
          </>
        ) : null}

        {!busy ? (
          <View style={[styles.ring, ready && focused && styles.ringOn]}>
            <View
              style={[
                styles.field,
                ready ? styles.fieldLarge : styles.fieldCompact,
                ready && url.length === 0 && styles.fieldPaste,
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
                onChangeText={(t) => {
                  // More than one character at once is a paste; typing adds them one by one.
                  setPasted(t.length - url.length > 1);
                  setUrl(t);
                }}
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
                <Touchable onPress={() => setUrl("")} hitSlop={12} ripple="borderless" accessibilityLabel="Clear">
                  <Icon name="close" size={20} color={colors.textMuted} />
                </Touchable>
              ) : (
                <Touchable
                  onPress={() => void paste()}
                  style={styles.paste}
                  radius={radii.pill}
                  accessibilityLabel="Paste a song link"
                >
                  <Text style={styles.pasteText}>Paste</Text>
                </Touchable>
              )}
            </View>
          </View>
        ) : null}

        {!busy && url.trim().length > 0 && !provider && (pasted || !focused) ? (
          <View style={styles.note}>
            <Icon name="problem" size={16} color={colors.warning} />
            <Text style={styles.noteText}>{songLinkHint(url)}</Text>
          </View>
        ) : null}

        {/* The three steps fill the page down to its small print, so it reads top to bottom on a tall phone. */}
        {!busy && ready ? (
          <>
            <Text style={styles.eyebrow}>How it works</Text>
            {/* A timeline: the steps joined by a line through their numbers that stops at the last one. */}
            <View style={styles.steps}>
              <View style={[styles.stepLine, { bottom: Math.max(14, lastStepHeight - 14) }]} />
              <View style={styles.step}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>1</Text>
                </View>
                <View style={styles.stepBody}>
                  <Text style={styles.stepTitle}>Copy the link</Text>
                  <Text style={styles.stepText}>In any of these apps tap Share, then Copy link.</Text>
                  <SourceTiles />
                </View>
              </View>
              <View style={styles.step}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>2</Text>
                </View>
                <View style={styles.stepBody}>
                  <Text style={styles.stepTitle}>Paste it here</Text>
                  <Text style={styles.stepText}>Then pick the part of the song you want.</Text>
                </View>
              </View>
              <View style={styles.step} onLayout={(e) => setLastStepHeight(e.nativeEvent.layout.height)}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>3</Text>
                </View>
                <View style={styles.stepBody}>
                  <Text style={styles.stepTitle}>Get the solfa</Text>
                  <Text style={styles.stepText}>
                    A full song takes a few minutes. We'll notify you when it's ready if you leave.
                  </Text>
                </View>
              </View>
            </View>

            {/* What a link becomes, before anyone pastes one: the bundled example (Library's "See an example"). */}
            <Text style={styles.eyebrow}>What you get</Text>
            <Card style={styles.example}>
              <Text style={styles.exampleTitle}>{EXAMPLE_HYMN.title}</Text>
              <Text style={styles.exampleMeta}>
                Doh is {EXAMPLE_HYMN.key.replace(" major", "")} · {EXAMPLE_HYMN.time} · {EXAMPLE_HYMN.tempo} BPM
              </Text>
              <Text style={styles.exampleSolfa}>{exampleOpening}</Text>
              <Text style={styles.exampleWords}>{EXAMPLE_HYMN.firstLine}</Text>
              <Button
                label="See the whole sheet"
                variant="secondary"
                size="sm"
                onPress={() => nav.navigate("Result", { result: exampleResult(), title: EXAMPLE_HYMN.title, example: true })}
                style={styles.exampleButton}
              />
            </Card>
          </>
        ) : null}

        {!busy && provider && refusal && infoError ? (
          <>
            <NoticeCard icon={refusal.icon} title={refusal.title} message={infoError.message}>
              <Button label="Try another link" variant="secondary" size="sm" onPress={tryAnother} />
              <Button label="Upload a file" variant="text" size="sm" onPress={uploadInstead} />
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
                    {/* The allowance is said once. A free account's is the pinned bar's line (the preview, or the song it
                        bought); Pro's bar counts songs, so the length is said here. */}
                    {isPro ? (
                      <Text style={styles.hint}>{`Up to ${formatClock(maxSeconds)} at a time on Pro.`}</Text>
                    ) : entitlement ? null : (
                      <Text style={styles.hint}>
                        {`Up to ${formatClock(maxSeconds)} on the free preview — Pro takes up to 6:00 of any song.`}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text style={styles.hint}>
                    We couldn't read how long this song is, so we'll transcribe the first{" "}
                    {maxSeconds != null ? formatClock(maxSeconds) : "part"}.
                  </Text>
                )}
              </>
            ) : infoBusy ? (
              // The cover's shape holds its place while the link is read, so the song lands where it waited.
              <View accessible accessibilityLabel="Reading the link" accessibilityLiveRegion="polite">
                <Skeleton height={196} radius={24} style={styles.coverSkeleton} />
                <Text style={[styles.readingText, styles.reading]}>Reading the link…</Text>
              </View>
            ) : infoError ? (
              <View style={styles.note}>
                <Icon name="problem" size={16} color={colors.warning} />
                <Text style={styles.noteText}>{infoError.message}</Text>
              </View>
            ) : null}

            <Touchable
              onPress={() => setMoreOpen((open) => !open)}
              style={styles.moreRow}
              scaleTo={motion.scale.row}
              accessibilityRole="button"
              accessibilityLabel={`More options. ${meterSummary(meter)}`}
              accessibilityState={{ expanded: moreOpen }}
            >
              <Icon name="settings" size={18} color={colors.icon} />
              <Text style={styles.moreTitle}>More options</Text>
              <Text style={styles.moreValue} numberOfLines={1}>{meterSummary(meter)}</Text>
              <Icon name={moreOpen ? "down" : "chevron"} size={16} color={colors.textFaint} />
            </Touchable>
            {moreOpen ? (
              <>
                <Text style={[styles.pickTitle, styles.meterTitle]}>Beats in a bar</Text>
                <View style={styles.chips}>
                  {METER_CHOICES.map((m) =>
                    chip(m.short, meter === m.value, () => setMeter(m.value), `Beats in a bar: ${m.label}`),
                  )}
                </View>
                <Text style={styles.hint}>{meterLabel(meter)}</Text>
              </>
            ) : null}
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
                onPress={() => void sendAgain()}
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
            {/* The same ways on as the pinned bar, priced and with their verbs (lib/price `limitOffer`). */}
            {wantsUpgrade ? (
              <>
                <Button
                  label={offer.single ? `Buy this song · ${formatPrice(offer.single.amountMinor, offer.single.currency)}` : "Buy this song"}
                  variant="secondary"
                  size="sm"
                  onPress={() => nav.navigate("Upgrade", { reason: "limit", planId: offer.single?.id })}
                />
                <Button
                  label="See Pro"
                  variant="text"
                  size="sm"
                  onPress={() => nav.navigate("Upgrade", offer.monthly ? { planId: offer.monthly.id } : undefined)}
                />
              </>
            ) : (
              <Button label="Upload the audio instead" variant="secondary" size="sm" onPress={uploadInstead} />
            )}
            {/* Offline, the same link is sent again; otherwise the card goes and the link is ready to change. */}
            {linkOffline ? (
              <Button label="Try again" variant="text" size="sm" onPress={() => void sendAgain()} />
            ) : (
              <Button label="Change link" variant="text" size="sm" onPress={changeLink} />
            )}
          </NoticeCard>
        ) : null}

        {/* At the foot of the page however tall the phone; the content above starts at the top. */}
        <View style={styles.foot}>
          {/* Said before anyone pastes: YouTube blocks server downloads for many songs, and a recording always works. */}
          {!busy && ready ? (
            <Text style={styles.footNote}>
              Links work for many songs, not all. If yours fails, record it or import the audio file instead.
            </Text>
          ) : null}
          <Text style={styles.legal}>
            Transcriptions are for personal and choir rehearsal use. The song's audio is deleted the moment
            the job finishes; only the notes are kept.
          </Text>
        </View>
      </Screen>
      {docked ? (
        <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {entitlement ? (
            <View style={styles.entitlement}>
              {/* Beside the first line, which the sentence then reads on from (board n-ux-low Q5f). */}
              <View style={styles.entitlementLead}>
                {entitlement.kind === "buy" ? (
                  <Icon name="pro" size={14} color={colors.premium} />
                ) : (
                  <Mark height={14} color={isPro ? colors.textMuted : colors.textFaint} />
                )}
              </View>
              <Text style={styles.entitlementText}>
                {entitlement.kind === "send" ? entitlement.line : entitlement.reason}
              </Text>
            </View>
          ) : null}
          {entitlement?.kind === "buy" ? (
            <View style={styles.dockActions}>
              <Button
                label={offer.single ? `Buy this song · ${formatPrice(offer.single.amountMinor, offer.single.currency)}` : "Buy this song"}
                icon="song"
                onPress={() => nav.navigate("Upgrade", { reason: "limit", planId: offer.single?.id })}
                style={styles.dockMain}
              />
              <Button
                label="See Pro"
                variant="text"
                onPress={() => nav.navigate("Upgrade", offer.monthly ? { planId: offer.monthly.id } : undefined)}
              />
            </View>
          ) : entitlement?.kind === "full" ? (
            <Button label="See your membership" variant="secondary" onPress={() => nav.navigate("Upgrade")} block />
          ) : (
            <Button
              label={section && duration != null && !isWholeSong(section, duration) ? "Transcribe this part" : "Transcribe this song"}
              variant="primary"
              onPress={submit}
              disabled={!canSubmit}
              block
            />
          )}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
    /** At least the screen's height, so the small print can sit at the foot. */
    page: { flexGrow: 1 },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
    backBtn: {
      width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
    },
    headerSpacer: { width: 40 },
    lockup: { flexDirection: "row", alignItems: "center", gap: 7 },
    pageTitle: { fontFamily: fonts.medium, fontSize: 15, color: c.text },
    title: { fontFamily: fonts.semibold, fontSize: 34, lineHeight: 36, letterSpacing: -1.4, color: c.text, marginTop: 28 },
    // Sentences are 16 px and nothing is under 13 (board m-ux-medium P3f).
    lead: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: c.textMuted, marginTop: 10 },

    // The focus ring is a padded wrapper rather than a shadow, so it draws the same on Android.
    ring: { borderRadius: 999, padding: 4, marginHorizontal: -4, marginTop: spacing.lg },
    ringOn: { backgroundColor: c.accentSoft },
    field: {
      flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 999,
      backgroundColor: c.surfaceAlt, borderWidth: 1.5, borderColor: c.border,
    },
    fieldLarge: { height: 60, paddingLeft: 20, paddingRight: 18 },
    fieldCompact: { height: 52, paddingLeft: 11, paddingRight: 16 },
    /** The Paste pill sits 8 px from the field's end: 44 px inside the 60. */
    fieldPaste: { paddingRight: 8 },
    paste: {
      height: 44, paddingHorizontal: spacing.lg, borderRadius: radii.pill, justifyContent: "center",
      backgroundColor: c.accentSoft, borderWidth: 1, borderColor: c.accentGlow,
    },
    pasteText: { fontFamily: fonts.semibold, fontSize: 15, color: c.link },
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
    // Sentences that wrap read from the left, on the gutter (board n-ux-low Q5f): the steps, the bar's line, the legal note.
    steps: { gap: spacing.lg, marginTop: spacing.md },
    /** Behind the numbers, from the first one's middle (each is 28 tall) to the last one's. */
    stepLine: { position: "absolute", left: 13.5, top: 14, bottom: 14, width: 1, backgroundColor: c.border },
    step: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
    stepNumber: {
      width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center",
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
    },
    stepNumberText: { fontFamily: fonts.semibold, fontSize: 13, color: c.text },
    stepBody: { flex: 1 },
    stepTitle: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24, color: c.text },
    stepText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: c.textMuted, marginTop: 2 },

    hint: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, color: c.textMuted, marginTop: spacing.sm },
    reading: { marginTop: spacing.md, paddingHorizontal: spacing.xs },
    readingText: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted },
    /** SongCover's own frame (196 tall, 24 round, `lg` above). */
    coverSkeleton: { marginTop: spacing.lg },

    pickHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 22 },
    pickTitle: { fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    meterTitle: { marginTop: 22 },
    pickRange: { fontFamily: nightFonts.mono, fontSize: 12.5, color: c.accent },
    /** The section and Beats-in-a-bar chips, 8 apart (board m-ux-medium P3c). */
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },

    moreRow: {
      flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, marginTop: 22,
      borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    },
    moreTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 14.5, color: c.text },
    moreValue: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 12.5, color: c.textMuted },

    /** The pinned bar: the canvas under a hairline, as a practice mode's footer. */
    dock: {
      gap: spacing.md, paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: c.bg,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
    },
    dockActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    dockMain: { flex: 1 },
    /** Set left on the bar's 16 px gutter, the mark beside the first line (board n-ux-low Q5f). */
    entitlement: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    /** One line of the sentence tall, so the mark sits on the first line however many follow. */
    entitlementLead: { height: 23, justifyContent: "center" },
    entitlementText: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, color: c.textMuted },
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
    stageTextDone: { color: c.successText },
    barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
    bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: c.border, overflow: "hidden" },
    barFill: { width: "100%", height: "100%", backgroundColor: c.ink },
    barPct: { fontFamily: nightFonts.mono, fontSize: 12, color: c.accent, minWidth: 42, textAlign: "right" },
    progressNote: { fontFamily: fonts.regular, fontSize: 12, color: c.textMuted, marginTop: spacing.sm },
    progressWarn: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, color: c.warningText, marginTop: spacing.sm },
    example: { marginTop: spacing.md },
    exampleTitle: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: c.text },
    exampleMeta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.textMuted, marginTop: 2 },
    exampleSolfa: { fontFamily: nightFonts.mono, fontSize: 20, lineHeight: 28, color: c.text, marginTop: spacing.md },
    exampleWords: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: c.textMuted, marginTop: 2 },
    exampleButton: { alignSelf: "flex-start", marginTop: spacing.md },
    /** Takes the spare height above it, so it ends the page. */
    foot: { marginTop: "auto", paddingTop: spacing.xl },
    footNote: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: c.textMuted, marginBottom: spacing.md },
    legal: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: c.textFaint },
  });
