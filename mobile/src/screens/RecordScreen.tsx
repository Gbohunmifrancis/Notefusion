import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Linking, StyleSheet, Text, View } from "react-native";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  type RecordingOptions,
} from "expo-audio";
import { Icon } from "../components/Icon";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Touchable } from "../components/Touchable";
import { Mark } from "../components/night/NightUI";
import { LevelTrace } from "../components/record/LevelTrace";
import { RecordOptionsSheet, type ModeOption } from "../components/record/RecordOptionsSheet";
import { showDialog } from "../lib/dialog";
import { markPractisedToday } from "../lib/practiceReminder";
import * as haptics from "../lib/haptics";
import {
  enablePush,
  getPushPermission,
  loadNotificationPrefs,
  markPushPermissionAsked,
  pushPermissionAsked,
} from "../lib/push";
import { useJobPolling } from "../lib/useJobPolling";
import { OFFLINE_LINE, STALLED_LINE, percentLabel, stageLabel, type ClientStage } from "../lib/jobProgress";
import { useIosAnnouncement } from "../lib/announce";
import { useSubscription } from "../lib/subscription";
import { importKind, importKindAnswered, loadImportKind, setImportKind } from "../lib/importKind";
import { setLeaveGuard } from "../lib/leaveGuard";
import { canImport, isScoreFile } from "../lib/importFile";
import { recordKindChoices } from "../lib/recordKind";
import { onlySettingsCanGrant } from "../lib/micPermission";
import { formatPrice, limitCopy, limitOffer, type LimitOffer } from "../lib/price";
import { billingApi, previewApi } from "../api/endpoints";
import type { Plan } from "../api/types";
import {
  KEYBOARD_TRANSPOSE_CHOICES,
  keyboardTranspose,
  keyboardTransposeLabel,
  loadKeyboardTranspose,
  setKeyboardTranspose,
} from "../lib/keyboardTranspose";
import { meterEventValue, type Meter } from "../lib/meter";
import { logAnalyticsEvent } from "../lib/analytics";
import { useDataSaver } from "../lib/dataSaver";
import { recordingProfile } from "../lib/recordingPreset";
import { enqueueTake, parkTake, releaseTake, takeById } from "../lib/outbox";
import { useTakeSend } from "../lib/useTakeSend";
import { takeMeta } from "../lib/sendQueue";
import { probeApi } from "../lib/connectivity";
import { isNetworkCode, isOffline } from "../lib/reachability";
import type { SubmitOptions } from "../api/endpoints";
import {
  fonts,
  motion,
  nightFonts,
  radii,
  spacing,
  typography,
  type Palette,
} from "../design/theme";
import { ThemeOverride, useColors, useThemedStyles } from "../lib/theme";
import type { AuthStackParams, RootStackParams, TabParams } from "../navigation/types";
import { GuestAccountCard } from "../components/GuestAccountCard";
import type { AxiosError } from "axios";
import {
  GUEST_MAX_SECONDS,
  GUEST_PREVIEW_TITLE,
  PREVIEW_MAX_BYTES,
  guestRecordingLine,
  guestTakeFull,
  type PendingPreview,
  type PreviewRefusal,
} from "../lib/guestPreview";
import { guestPreviewStore } from "../lib/guestPreviewStore";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "melody" | "poly" | "choir" | "chords";

/**
 * The modes as the picker lists them; the first `title` is what the top bar's pill says.
 * "Choir" is a whole choir singing in parts: each part comes back as it was sung. "Chords" is a
 * piano or guitar playing: the chords are read and written over the solfa.
 */
const MODES: readonly ModeOption[] = [
  { mode: "melody", title: "Hum or sing", hint: "One line — hummed, sung or played on its own.", icon: "sing" },
  { mode: "poly", title: "Polyphonic", hint: "An instrument playing several notes at once.", icon: "instrument" },
  { mode: "choir", title: "Choir", hint: "A choir singing in parts: each part comes back as it was sung.", icon: "choir" },
  { mode: "chords", title: "Chords", hint: "Chords (piano, guitar): the chords played are read and written over the solfa.", icon: "chords" },
];
const MODE_TITLE = Object.fromEntries(MODES.map((m) => [m.mode, m.title])) as Record<Mode, string>;
type Phase = "ready" | "recording" | "uploading";

/**
 * The steps an upload goes through, as the uploading card lists them. Isolating the voice
 * is only on the list when the recording is a song with instruments behind it.
 */
const UPLOAD_STAGES: { key: ClientStage; label: string }[] = [
  { key: "uploading", label: "Uploading" },
  { key: "queued", label: "Waiting in line" },
  { key: "separating", label: "Isolating the voice" },
  { key: "transcribing", label: "Writing the solfa" },
];

// ─── Constants ────────────────────────────────────────────────────────────────

const KEYS = [
  "Auto",
  "C major",
  "D major",
  "E major",
  "F major",
  "G major",
  "A major",
  "Bb major",
  "A minor",
  "D minor",
  "E minor",
];

/**
 * The API's code for the free-tier refusal (`BillingErrors.FreeTierLimitReached`).
 *
 * Matched on the code, not the message: this branch used to sniff for four different
 * substrings of the server's prose, which would have silently stopped working the first
 * time anyone reworded the error.
 */
const FREE_TIER_LIMIT_CODE = "BILLING_FREE_TIER_LIMIT";

/**
 * The API's code for a free account asking for a song with instruments with no bought song
 * left (`BillingErrors.SongNotFree`): the free weekly ones are hums and recordings.
 */
const SONG_NOT_FREE_CODE = "BILLING_SONG_NOT_FREE";

/** Added to a refusal when the take is kept in the send queue (lib/outbox) rather than lost. */
const KEPT_LINE = " Your recording is kept in your Library — send it from there when you can.";

/** The Library's line under a mic take kept back because a song needs Pro or a bought song. */
const SONG_KEPT_REASON = "A song needs Pro or a bought song. Once you have one, tap Try again — or delete it.";

/**
 * AAC in an .m4a at 22,050 Hz mono — the rate the worker resamples to anyway — at 128 kbps, or at
 * 32 kbps on data saver: a quarter of the upload with the same transcription (lib/recordingPreset.ts
 * has the measurement).
 */
function recordingOptionsFor(dataSaver: boolean): RecordingOptions {
  const profile = recordingProfile(dataSaver);
  return {
    ...RecordingPresets.HIGH_QUALITY,
    sampleRate: profile.sampleRate,
    numberOfChannels: profile.numberOfChannels,
    bitRate: profile.bitRate,
    web: { ...RecordingPresets.HIGH_QUALITY.web, bitsPerSecond: profile.bitRate },
    isMeteringEnabled: true,
  };
}

// ── Recording length cap ──────────────────────────────────────────────────────
//
// Mirrors the server's NF_MAX_CLIP_SECONDS (180), which is a hard 413: a longer recording
// is not degraded, it is refused, and the user would lose the whole take. Stopping at the
// limit and submitting is the only outcome that keeps the audio.
//
// This was 60 s and the reason was different — NF_PYIN_MAX_SECONDS was also 60, and above
// it _pyin_track returned empty arrays, taking out pyin_refine and pyin_semitone together
// (the latter being "what fixes the ghost accidentals at their source"). Crossing that line
// cost solfa.chromatic_ghosts 1.526 -> 3.526 on the corpus, so a clip a second over came
// back visibly worse than one a second under with nothing on screen to explain why. The
// worker's pyin grid is now coarser (NF_PYIN_RESOLUTION, 2.39x cheaper for no measured loss),
// which bought a 180 s pyin budget — the cap and the accepted duration are the same number
// now, so there is no accuracy cliff left inside the recordable range to hide from.
const MAX_RECORD_SEC = 180;

// How close to the cap the subtitle starts counting down instead of giving the
// ordinary "tap when you're done" hint.
const RECORD_WARN_AT_SEC = 15;

// ── Voice-level guidance thresholds (dBFS, 0 = loudest, -160 = silence) ───────
//
// expo-audio's metering value is an averaged power level in dBFS. Typical
// speaking/singing voice close to a phone mic sits around -20 to -6 dBFS;
// a quiet or distant voice drops below about -40 dBFS. These thresholds were
// chosen empirically against the Phase 0 spike recordings (spike/README.md)
// and err on the side of nudging the user rather than staying silent.
const LEVEL_SILENCE_DBFS = -50; // effectively nothing reaching the mic
const LEVEL_QUIET_DBFS = -34; // audible but too soft for confident transcription
const LEVEL_GOOD_DBFS = -18; // comfortably loud — meter reads "good" from here up

// How long the level must stay below LEVEL_QUIET_DBFS before the guidance
// banner appears. Short dips (breaths, pauses between phrases) shouldn't
// trigger a nag — only a sustained quiet stretch should.
const QUIET_GUIDANCE_DELAY_MS = 1200;
/** The banner's words, shown and (on iOS) said. */
const QUIET_GUIDANCE = "Sing louder or hold closer to the mic";

/**
 * Ceilings on the OS text-size setting, for the two kinds of text this screen cannot let grow freely.
 * Android's *Font size* and *Display size* multiply independently, so a handset set to both extremes
 * asks for roughly 1.5× the type in roughly 0.8× the width.
 *
 * DISPLAY caps the large decorative figures — the timer and the job card's percentage. The timer is
 * already the biggest text on the screen at 1.0×, so a third again is plenty and the rest of the growth
 * would only cost layout. Everything that carries instructions (the status line, the error text, the
 * guidance banner) is deliberately left uncapped and wraps or scrolls instead.
 *
 * CHROME caps the labels that share a fixed row — the mode pill between the close button and the
 * Fast lane badge, and the captions under the 56px side buttons — which cannot grow without pushing
 * their neighbours off the edge. Each repeats something the sheet or the button's own label says.
 */
const MAX_TEXT_SCALE_DISPLAY = 1.3;
const MAX_TEXT_SCALE_CHROME = 1.15;

/**
 * How many level readings the trace holds across its width — at the recorder's ~6.7 readings a
 * second, the last nine seconds or so of the take.
 */
const TRACE_POINTS = 60;

/** Maps a dBFS metering value to a 0..1 fraction for the level trace. */
function meteringToFraction(dbfs: number): number {
  const clamped = Math.max(LEVEL_SILENCE_DBFS, Math.min(0, dbfs));
  return (clamped - LEVEL_SILENCE_DBFS) / (0 - LEVEL_SILENCE_DBFS);
}

/** The trace's head colour for the current metering level: mint, amber, then grey for nothing heard. */
function meteringToColor(dbfs: number, c: Palette): string {
  if (dbfs >= LEVEL_GOOD_DBFS) return c.success; // comfortably loud
  if (dbfs >= LEVEL_QUIET_DBFS) return c.warning; // audible but soft
  return c.textMuted; // too quiet / far from the mic: the amber "Sing louder" pill says so
}

/** Removes a local take or imported cache copy; one that is already gone is nothing to report. */
function deleteQuietly(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone or locked.
  }
}

/**
 * Offers notifications the first time a transcription is submitted — the one
 * moment where the ask explains itself.
 *
 * Deliberately not at sign-in: `push.ts` refuses to prompt without `force` so a
 * silent login can never raise a system dialog. But nothing else forced it
 * either, so a user who never opened Settings → Notifications had no token on
 * the server and the API's completion push had nowhere to go — the background
 * worker was doing its job and the phone had no way to hear about it. This is
 * that missing prompt, asked once, with its reason attached.
 *
 * Fire-and-forget: the job is already running and nothing here may delay or fail
 * the submit. A denied or unsupported permission shows nothing at all — the poll
 * still finishes the job while this screen lives, and re-asking someone who said
 * no is the wrong move.
 */
async function offerBackgroundAlerts(): Promise<void> {
  await loadNotificationPrefs();
  if (pushPermissionAsked()) return;
  if ((await getPushPermission()) !== "undetermined") return;

  // Marked before showing, not after: a dismissal resolves with no action, and
  // "asked" means asked either way.
  await markPushPermissionAsked();
  showDialog({
    title: "Tell you when it's ready?",
    message: "Turn on notifications and you can leave the app. We'll tell you the moment your score is done.",
    icon: "bell",
    tone: "brand",
    actions: [
      { label: "Notify me", onPress: () => void enablePush() },
      { label: "Not now", style: "cancel" },
    ],
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * RecordScreen — audio capture & transcription trigger, in the night design.
 *
 *   • Top bar        : close, the mode pill (opens the options sheet: mode, key, keyboard
 *                      transpose), and the Fast lane badge for Pro.
 *   • Timer          : large monospace clock with one status line under it.
 *   • Level trace    : the mic level as a thin glowing line over faint guides.
 *   • Controls       : import / start over · record–stop · done.
 *   • Uploading      : one calm card — the mark, the stage, the steps, a thin progress bar.
 *
 * `guest` (board l-ux-high/07, "Try it first" on Welcome, in the signed-out stack): the same screen with no account —
 * thirty seconds that stop by themselves, the microphone or a recording file, sent to the website's anonymous
 * preview and followed there. No tab bar, send queue or free count; the sheet opens in Result as a guest.
 */
export function RecordScreen({ guest = false }: { guest?: boolean }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute<RouteProp<TabParams, "Record">>();
  const tabNav = useNavigation<BottomTabNavigationProp<TabParams, "Record">>();
  /** The signed-out stack, for a guest (the same navigator as `nav`, typed for its routes). */
  const guestNav = useNavigation<NativeStackNavigationProp<AuthStackParams>>();
  /**
   * Every take goes through the send queue (lib/outbox): kept in app storage and queued before its upload
   * starts, followed here until its result is in. `direct` is the old way, straight from the recorder's
   * file, for a take the queue could not keep (no room, or the account still loading).
   */
  const take = useTakeSend();
  const direct = useJobPolling();
  const following = take.state.takeId !== null;
  const state = following ? take.state : direct.state;
  const resetTake = take.reset;
  const resetDirect = direct.reset;
  const reset = useCallback(() => {
    resetTake();
    resetDirect();
  }, [resetTake, resetDirect]);
  const {
    isPro,
    known,
    trialRemaining,
    boughtRemaining,
    boughtTotal,
    freeRemaining,
    freePerWeek,
    freeBack,
    refresh,
    subscription,
  } = useSubscription();
  /**
   * A song with instruments (the voice isolated first) is not one of the free weekly ones: it
   * takes Pro or a bought song. Known-and-free only, so a dropped billing request fails open.
   */
  const songNeedsCredit = known && !isPro && boughtRemaining <= 0;
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  /**
   * The region's own prices for the limit sheet's two rows (the one-song purchase and Pro by the
   * month). Read once for a free account; until they arrive, or if they fail, the rows go without.
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

  const [phase, setPhase] = useState<Phase>("ready");
  const [mode, setMode] = useState<Mode>("melody");
  const [selectedKey, setSelectedKey] = useState<string>("Auto");
  const [optionsOpen, setOptionsOpen] = useState(false);
  /** Beats in a bar for the next take or file; null is Not sure. Back to Not sure once one is sent (lib/meter). */
  const [meter, setMeter] = useState<Meter | null>(null);
  /** The player's keyboard transpose, mirrored from the module cache so the chips repaint. */
  const [kbTranspose, setKbTranspose] = useState(keyboardTranspose());
  useEffect(() => {
    void loadImportKind();
    void loadKeyboardTranspose().then(() => setKbTranspose(keyboardTranspose()));
  }, []);
  const [elapsed, setElapsed] = useState(0);
  const [permError, setPermError] = useState<string | null>(null);
  /** The microphone was refused for good: only the phone's settings can turn it on now. */
  const [permSettings, setPermSettings] = useState(false);

  // ── The guest preview (board l-ux-high/07) ────────────────────────────────
  /** The guest's take, kept until its sheet opens: what "Send it again" sends. */
  const guestTake = useRef<{ uri: string; name: string } | null>(null);
  /** Why the guest's last send was refused (`lib/guestPreview`), with the API's words; null otherwise. */
  const [guestRefused, setGuestRefused] = useState<{ refusal: PreviewRefusal; message: string } | null>(null);
  /** The preview on its way: its job, when it was sent and from what. Kept on the phone with its sheet once in. */
  const guestPending = useRef<Omit<PendingPreview, "result"> | null>(null);
  const { startPreview, resumePreview } = direct;
  /** A guest leaves to Welcome (the job, once sent, goes on and is kept); an account to Home. */
  const leave = useCallback(() => {
    if (guest) guestNav.goBack();
    else tabNav.navigate("Home");
  }, [guest, guestNav, tabNav]);

  // The preset follows Data saver, but never mid-take: a new preset makes a new recorder.
  const dataSaver = useDataSaver();
  const [recordingOptions, setRecordingOptions] = useState(() => recordingOptionsFor(dataSaver));
  useEffect(() => {
    if (phase !== "recording") setRecordingOptions(recordingOptionsFor(dataSaver));
  }, [dataSaver, phase]);
  const recorder = useAudioRecorder(recordingOptions);
  // Polls the native recorder ~6x/sec for status + metering while recording;
  // expo-audio only reports metering through this hook, not on `recorder` itself.
  const recorderState = useAudioRecorderState(recorder, 150);

  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  /** True from a Start tap until the recorder is running (or has failed to). */
  const startingRef = useRef(false);
  const lastSubmitArgs = useRef<{uri: string, name: string, opts: any} | null>(null);
  /** Replaces the remembered submit, deleting the file it pointed at unless it is the same one. */
  const rememberSubmit = useCallback((next: {uri: string, name: string, opts: any} | null) => {
    const prev = lastSubmitArgs.current;
    if (prev && prev.uri !== next?.uri) deleteQuietly(prev.uri);
    lastSubmitArgs.current = next;
  }, []);

  /**
   * A take sent the old way (the queue could not keep it at first) that then failed for want of a network:
   * queued now if it can be, and shown kept on the phone (board 13). Returns false when it could not be kept,
   * leaving the usual retry card.
   */
  const keepTake = take.keep;
  const queueLastTake = useCallback((afterFailedSend: boolean): boolean => {
    const last = lastSubmitArgs.current;
    if (!last) return false;
    const id = enqueueTake({ fileUri: last.uri, fileName: last.name, opts: last.opts, afterFailedSend });
    if (!id) return false;
    // The file is the queue's now (moved, not copied): forgetting it here must not delete it.
    lastSubmitArgs.current = null;
    resetDirect();
    setPhase("uploading");
    void logAnalyticsEvent("take_queued_offline", { mode: last.opts?.mode });
    keepTake(id);
    return true;
  }, [resetDirect, keepTake]);

  /**
   * Sends a take. Write-ahead: it is kept in app storage and queued first (a mic take already is, held
   * since it stopped), then sent at once by the queue and followed here; offline, it waits there. Returns
   * the job id once the server has the take, null otherwise.
   */
  const sendTake = take.send;
  const startDirect = direct.start;
  const submitOrQueue = useCallback(
    async (uri: string, name: string, opts: SubmitOptions, heldId: string | null = null): Promise<string | null> => {
      void logAnalyticsEvent("recording_upload", { data_saver: dataSaver });
      if (heldId && !releaseTake(heldId, opts)) {
        // Deleted from the Library while the question was open: nothing left to send.
        setPhase("ready");
        return null;
      }
      const id = heldId ?? enqueueTake({ fileUri: uri, fileName: name, opts });
      if (id) {
        rememberSubmit(null);
        const sent = await sendTake(id);
        return sent?.status === "sent" ? sent.jobId : null;
      }
      rememberSubmit({ uri, name, opts });
      if (isOffline() && !(await probeApi()) && queueLastTake(false)) return null;
      return startDirect(uri, name, opts);
    },
    [rememberSubmit, queueLastTake, sendTake, startDirect, dataSaver],
  );

  /** Board 13's two ways on from a take kept on the phone: it goes by itself either way. */
  const leaveKept = useCallback(
    (toLibrary: boolean) => {
      reset();
      setPhase("ready");
      setElapsed(0);
      if (toLibrary) tabNav.navigate("Library");
    },
    [reset, tabNav],
  );

  // ── Voice-level guidance state ────────────────────────────────────────────
  const [showQuietGuidance, setShowQuietGuidance] = useState(false);
  const quietSinceRef = useRef<number | null>(null);
  /** Recent level readings, 0..1, oldest first — what the trace draws. */
  const [levels, setLevels] = useState<number[]>([]);
  const guidanceOpacity = useRef(new Animated.Value(0)).current;

  // ── Navigate to Result ────────────────────────────────────────────────────
  useEffect(() => {
    if (state.status === "done" && state.result && guest) {
      // A guest's preview: kept on the phone with its sheet until an account keeps it, and opened in Result in
      // this one's place, so closing it goes back to Welcome.
      const result = state.result;
      const pending = guestPending.current;
      guestPending.current = null;
      if (pending) void guestPreviewStore.save({ ...pending, result });
      if (guestTake.current) deleteQuietly(guestTake.current.uri);
      guestTake.current = null;
      reset();
      setPhase("ready");
      setElapsed(0);
      void logAnalyticsEvent("guest_preview_ready");
      guestNav.replace("Result", { result, guest: true, title: GUEST_PREVIEW_TITLE });
      return;
    }
    if (state.status === "done" && state.result) {
      const result = state.result;
      const sourceJobId = state.jobId ?? undefined;
      // Filed in the Library by the server as it finished (option A): the Result opens it as a saved sheet.
      const savedId = state.savedId ?? undefined;
      const savedTitle = state.savedTitle ?? undefined;
      // The transcription is in; the audio it came from has no further use on the phone. Kept
      // until now (not dropped at upload) because "Retry Upload" re-sends it after a failed job.
      rememberSubmit(null);
      reset();
      setPhase("ready");
      setElapsed(0);
      // A successful generation is what spends a free credit, server-side, so re-read
      // the count now — otherwise the pill still claims the old number when the user
      // comes back from Result. Not awaited: navigation must not wait on billing.
      refresh();
      // Practised today, so today's reminder has nothing to nag about. Fire-and-forget.
      void markPractisedToday();
      nav.navigate("Result", { result, sourceJobId, fresh: true, savedId, title: savedTitle });
    }
  }, [state.status, state.result, state.jobId, state.savedId, state.savedTitle, nav, reset, refresh, rememberSubmit, guest, guestNav]);

  /**
   * Explains an exhausted trial and offers the way out.
   *
   * Shown instead of dropping the user on the paywall unannounced, which was the whole
   * of the old behaviour and read as the app refusing to record for no stated reason.
   */
  /** The one-song purchase as a row you tap once, with this region's price when it is known. */
  const songChoice = useCallback(
    () => ({
      label: "Just this song",
      detail: "One more transcription. No subscription.",
      price: offer.single ? formatPrice(offer.single.amountMinor, offer.single.currency) : undefined,
      icon: "song" as const,
      onPress: () => nav.navigate("Upgrade", { reason: "limit", planId: offer.single?.id }),
    }),
    [offer, nav],
  );

  const showTrialExhausted = useCallback((kept = false) => {
    // Board 7b: when they come back, then two ways on, the song first (as Upgrade preselects it).
    const copy = limitCopy(freePerWeek, boughtTotal, freeBack);
    showDialog({
      title: copy.title,
      message: copy.message + (kept ? KEPT_LINE : ""),
      choices: [
        songChoice(),
        {
          label: "NoteFusion Pro",
          detail: "Unlimited hums · 20 songs a month",
          price: offer.monthly ? formatPrice(offer.monthly.amountMinor, offer.monthly.currency) : undefined,
          priceUnit: offer.monthly ? "/ month" : undefined,
          icon: "pro",
          tone: "premium",
          onPress: () => nav.navigate("Upgrade", offer.monthly ? { planId: offer.monthly.id } : undefined),
        },
      ],
      actions: [{ label: "Not now", style: "cancel" }],
    });
  }, [freePerWeek, freeBack, boughtTotal, nav, offer, songChoice]);

  /**
   * A song with instruments on a free account with no bought song left. The take (or file) is
   * already in hand, so the first way out sends it as a tune that was sung, which one of the
   * week's free ones covers; `sendAsTune` does that.
   */
  const showSongNotFree = useCallback(
    (sendAsTune?: () => void, kept = false) => {
      showDialog({
        title: "Songs need Pro or a bought song",
        message:
          `A song's voice is lifted out of the band first, which takes Pro or a bought song. ` +
          `Your ${freePerWeek} free ones a week are for hums and a voice on its own.` +
          (kept ? KEPT_LINE : ""),
        choices: [
          ...(sendAsTune
            ? [{ label: "Send as a tune I sang", icon: "sing" as const, chips: [{ label: "Free" }], onPress: sendAsTune }]
            : []),
          songChoice(),
        ],
        actions: [{ label: "Not now", style: "cancel" }],
      });
    },
    [freePerWeek, songChoice],
  );

  /**
   * Stops a free account that has nothing left, and says so. Returns true when the
   * caller should give up.
   *
   * `known` is in the condition deliberately: without it a dropped billing request
   * reads as "not subscribed" and would lock a paying customer out of their own
   * microphone. Pro accounts are never metered.
   */
  const blockedByTrialLimit = useCallback((): boolean => {
    if (isPro || !known || trialRemaining > 0) return false;
    showTrialExhausted();
    return true;
  }, [isPro, known, trialRemaining, showTrialExhausted]);

  // A failed job must clear the uploading chrome, or the record button stays
  // disabled and the "Processing…" spinner renders on top of the error card,
  // stranding the user until they happen to tap Try again. The error card is
  // driven by state.error, so it stays visible; only the phase is reset.
  useEffect(() => {
    if (state.status !== "failed") return;
    setPhase("ready");

    // A guest's preview that failed was not had (the API lets this phone try again): nothing is kept for it.
    if (guest) {
      guestPending.current = null;
      void guestPreviewStore.clear();
      return;
    }

    // The server refusing on quota means the local gate let the tap through — a stale
    // count, or the last credit spent on another device. Same dialog, and the job state
    // is cleared so the error card's "Try again" doesn't offer a retry that cannot
    // possibly succeed.
    // A take from the send queue stays in it (and the Library), refused, for Try again or Delete.
    if (state.errorCode === FREE_TIER_LIMIT_CODE) {
      reset();
      showTrialExhausted(following);
    } else if (state.errorCode === SONG_NOT_FREE_CODE) {
      reset();
      showSongNotFree(undefined, following);
    } else if (!following && isNetworkCode(state.errorCode)) {
      // A direct upload never got an answer: keep the take and send it when the connection is back.
      queueLastTake(true);
    }
  }, [state.status, state.errorCode, following, reset, showTrialExhausted, showSongNotFree, queueLastTake, guest]);

  // A failed job costs nothing: the place it held comes back, so the count is read again, once per job
  // (`refresh` is a new function after every read, and the job stays failed). A guest has no count.
  const recountedFor = useRef<string | null>(null);
  useEffect(() => {
    if (guest || state.status !== "failed" || !state.jobId || recountedFor.current === state.jobId) return;
    recountedFor.current = state.jobId;
    void refresh(false);
  }, [state.status, state.jobId, refresh, guest]);

  // The elapsed-time interval is cleared in stopAndSubmit, but a screen unmount
  // mid-recording (back gesture, tab switch) never runs that path, leaking the
  // timer and firing a state update on an unmounted component. Tear it down here.
  useEffect(
    () => () => {
      if (tick.current) clearInterval(tick.current);
    },
    [],
  );

  // ── Auto-stop at MAX_RECORD_SEC ───────────────────────────────────────────
  //
  // Submits for the user rather than refusing to record further, because the clip up to
  // the cap is perfectly usable and discarding it would be worse than truncating it.
  // Safe against firing twice: the phase guard closes as soon as stopAndSubmit sets
  // "uploading", and stopAndSubmit itself returns early unless recorder.isRecording.
  // stopAndSubmit is deliberately not a dependency — it is redeclared every render, so
  // depending on it would re-run this effect on each one. A guest's take stops at the preview's
  // thirty seconds, which is all the API transcribes of it.
  useEffect(() => {
    if (phase === "recording" && (guest ? guestTakeFull(elapsed) : elapsed >= MAX_RECORD_SEC)) void stopAndSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, elapsed]);

  // A preview this phone sent before and has not seen (the guest left while it ran) is followed again here. One the
  // API no longer knows, or one that failed, is let go: this phone may try again.
  useEffect(() => {
    if (!guest) return;
    let live = true;
    void (async () => {
      const pending = await guestPreviewStore.read();
      if (!live || !pending || recorder.isRecording) return;
      if (pending.result) {
        guestNav.replace("Result", { result: pending.result, guest: true, title: GUEST_PREVIEW_TITLE });
        return;
      }
      let failed = false;
      try {
        failed = (await previewApi.getJob(pending.jobId)).status === "failed";
      } catch (e) {
        failed = (e as AxiosError)?.response?.status === 404;
      }
      if (!live || recorder.isRecording) return;
      if (failed) {
        void guestPreviewStore.clear();
        return;
      }
      guestPending.current = { jobId: pending.jobId, recordedAt: pending.recordedAt };
      setPhase("uploading");
      resumePreview(pending.jobId);
    })();
    return () => {
      live = false;
    };
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Sends a guest's take to the anonymous preview and follows it. The take stays in hand until its sheet opens: a
   * send that got no answer, or met a fault on our side, offers "Send it again", as the website does.
   */
  async function sendGuest(uri: string, name: string) {
    // A take kept from a send that failed is let go once another takes its place.
    if (guestTake.current && guestTake.current.uri !== uri) deleteQuietly(guestTake.current.uri);
    guestTake.current = { uri, name };
    setGuestRefused(null);
    setPermError(null);
    setPhase("uploading");
    void logAnalyticsEvent("guest_preview_sent", { mode, source: name.startsWith("clip-") ? "mic" : "file" });
    const sent = await startPreview(uri, name, {
      mode,
      timeSignature: meter ?? undefined,
      keyboardTranspose: kbTranspose || undefined,
    });
    if (!sent) return; // left or sent again while it went up
    if ("jobId" in sent) {
      setMeter(null);
      guestPending.current = { jobId: sent.jobId, recordedAt: Date.now() };
      // Kept from now: closing this screen, or the app, does not lose it.
      void guestPreviewStore.save({ ...guestPending.current, result: null });
      return;
    }
    setPhase("ready");
    setGuestRefused(sent);
    if (sent.refusal !== "kept") {
      // Sending it again cannot change the answer: the take has no further use.
      deleteQuietly(uri);
      guestTake.current = null;
    }
  }

  // ── Voice-level metering & "sing louder" guidance ─────────────────────────
  //
  // recorderState.metering is only meaningful while phase === "recording";
  // expo-audio reports a stale/undefined value otherwise. Each reading joins the
  // trace's history, and the guidance banner only appears after
  // QUIET_GUIDANCE_DELAY_MS of sustained quiet — not on every brief dip — so
  // pauses for breath don't trigger it.
  useEffect(() => {
    if (phase !== "recording") {
      quietSinceRef.current = null;
      if (showQuietGuidance) setShowQuietGuidance(false);
      setLevels((l) => (l.length ? [] : l));
      return;
    }

    const dbfs = recorderState.metering ?? LEVEL_SILENCE_DBFS;

    setLevels((l) => [...l.slice(-(TRACE_POINTS - 1)), meteringToFraction(dbfs)]);

    const now = Date.now();
    if (dbfs < LEVEL_QUIET_DBFS) {
      if (quietSinceRef.current === null) {
        quietSinceRef.current = now;
      } else if (
        !showQuietGuidance &&
        now - quietSinceRef.current >= QUIET_GUIDANCE_DELAY_MS
      ) {
        setShowQuietGuidance(true);
      }
    } else {
      quietSinceRef.current = null;
      if (showQuietGuidance) setShowQuietGuidance(false);
    }
  }, [phase, recorderState.metering, showQuietGuidance]);

  // Fade the guidance banner in/out rather than popping it, so it reads as a
  // gentle nudge rather than an alarming error state.
  useEffect(() => {
    Animated.timing(guidanceOpacity, {
      toValue: showQuietGuidance ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [showQuietGuidance, guidanceOpacity]);

  const currentMeterDbfs =
    phase === "recording"
      ? (recorderState.metering ?? LEVEL_SILENCE_DBFS)
      : LEVEL_SILENCE_DBFS;
  const meterColor = meteringToColor(currentMeterDbfs, colors);

  // ── Recording controls ────────────────────────────────────────────────────

  async function startRecording() {
    // Closed before the first await: a second tap during the permission prompt or the recorder's
    // prepare would otherwise start a second take and a second clock.
    if (startingRef.current) return;
    setPermError(null);
    setPermSettings(false);
    // A new take puts a failed send's note away; the phone's preview being used up still stands.
    setGuestRefused((r) => (r?.refusal === "used" ? r : null));
    if (blockedByTrialLimit()) return;
    startingRef.current = true;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setPermError(
          "Microphone permission is required to listen and transcribe.",
        );
        setPermSettings(onlySettingsCanGrant(perm));
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("recording");
      setElapsed(0);
      if (tick.current) clearInterval(tick.current);
      tick.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch {
      setPermError("Could not start recording. Please try again.");
    } finally {
      startingRef.current = false;
    }
  }

  /**
   * Whether the audio is a song with instruments (true: vocal isolated first) or a hummed tune;
   * null when the sheet was cancelled. Board a-core/03: two rows you tap once, each with what it
   * costs on this account (`lib/recordKind`). The remembered answer — a song, until someone says
   * otherwise — is listed first with a "Last time" chip, and whatever is chosen is remembered for
   * next time. A recording cannot be cancelled: the take is already made, so the sheet then has no
   * Cancel and cannot be swiped or tapped away.
   */
  function askIfSong(cancelable: boolean, fromMic: boolean): Promise<boolean | null> {
    return new Promise<boolean | null>((resolve) => {
      const choose = (kind: "song" | "voice") => {
        void setImportKind(kind);
        resolve(kind === "song");
      };
      const choices = recordKindChoices(importKind(), {
        known,
        isPro,
        songCreditsRemaining: subscription?.songCreditsRemaining,
        freeRemaining,
        boughtRemaining,
      }, { answered: importKindAnswered(), fromMic });
      showDialog({
        title: "What is this recording?",
        message: "A song's lead vocal is lifted out of the band first, so the notes come from the voice.",
        choices: choices.map((choice) => ({
          label: choice.title,
          icon: choice.icon,
          chips: [
            ...(choice.lastTime ? [{ label: "Last time", tone: "accent" as const }] : []),
            ...(choice.cost ? [{ label: choice.cost }] : []),
          ],
          onPress: () => choose(choice.kind),
        })),
        actions: cancelable ? [{ label: "Cancel", style: "cancel", onPress: () => resolve(null) }] : [],
        blocking: !cancelable,
      });
    });
  }

  async function pickAudioFile() {
    setPermError(null);
    setPermSettings(false);
    // Importing a file costs a generation exactly like recording one, and this path
    // had no gate at all — the trial was only enforced on the microphone.
    if (blockedByTrialLimit()) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "audio/*",
          "audio/mpeg",
          "audio/wav",
          "audio/x-m4a",
          "audio/mp4",
          "audio/aac",
          "audio/midi",
          "audio/x-midi",
          "application/xml",
          "text/xml",
          "application/vnd.recordare.musicxml",
          "application/vnd.recordare.musicxml+xml",
          "*/*",
        ],
        copyToCacheDirectory: true,
      });

      if (res.canceled || !res.assets || res.assets.length === 0) {
        return;
      }

      const asset = res.assets[0];
      if (guest) {
        // The preview reads a recording, as the website's does: no scores, and 25 MB at most.
        if (!canImport(asset.name) || isScoreFile(asset.name)) {
          setPermError("That doesn't look like a recording. Choose an MP3, WAV, M4A, FLAC, OGG or WebM file.");
          return;
        }
        if ((asset.size ?? 0) > PREVIEW_MAX_BYTES) {
          setPermError("That file is over 25 MB. Choose a shorter recording, or one saved as MP3 or M4A.");
          return;
        }
        await sendGuest(asset.uri, asset.name || "imported-audio.m4a");
        return;
      }
      // Refused here, not after the upload: the picker shows every file (lib/importFile).
      if (!canImport(asset.name)) {
        setPermError("That file isn't one we can read. Choose a recording (MP3, M4A, WAV…), a MIDI file or MusicXML.");
        return;
      }
      // A file from the phone's library is as likely to be a song with a band behind the
      // voice as a hummed line, and the two need different treatment: a song's lead vocal
      // is isolated first and its beat read from the full mix, or the mixture comes back as
      // a scatter of wrong notes. Scores and MIDI files have nothing to isolate.
      // Chords mode reads the instruments themselves, so nothing is isolated there either.
      const isScore = isScoreFile(asset.name);
      const separate = isScore || mode === "chords" ? false : await askIfSong(true, false);
      if (separate === null) return;
      const send = async (isolate: boolean) => {
        setPhase("uploading");
        const keyOpt = selectedKey === "Auto" ? undefined : selectedKey;
        const opts = { mode, key: keyOpt, separate: isolate, keyboardTranspose: kbTranspose || undefined, timeSignature: meter ?? undefined };
        void logAnalyticsEvent("beats_in_a_bar", { meter: meterEventValue(meter), source: "file" });
        const jobId = await submitOrQueue(asset.uri, asset.name || "imported-audio.m4a", opts);
        // Only once the job is really queued — a quota refusal has no completion
        // to notify about.
        if (jobId) {
          setMeter(null);
          void offerBackgroundAlerts();
        }
      };
      // A song is not one of the free weekly ones: offer to send it as a sung tune instead.
      if (separate && songNeedsCredit) {
        showSongNotFree(() => void send(false).catch(() => setPhase("ready")));
        return;
      }
      await send(separate);
    } catch {
      setPhase("ready");
      setPermError("Could not import audio file. Please try again.");
    }
  }

  useEffect(() => {
    if (route.params?.autoPickAudio && phase === "ready") {
      tabNav.setParams({ autoPickAudio: undefined });
      void pickAudioFile();
    }
  }, [route.params?.autoPickAudio, phase]);


  async function stopAndSubmit() {
    if (tick.current) clearInterval(tick.current);
    quietSinceRef.current = null;
    setShowQuietGuidance(false);
    if (!recorder.isRecording) return;
    setPhase("uploading");
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        setPhase("ready");
        return;
      }
      const keyOpt = selectedKey === "Auto" ? undefined : selectedKey;
      const name = `clip-${elapsed}s.m4a`;
      // A guest's take goes straight to the preview: no send queue, and no question about a band (the website
      // asks none either).
      if (guest) {
        await sendGuest(uri, name);
        return;
      }
      const base = { mode, key: keyOpt, keyboardTranspose: kbTranspose || undefined, timeSignature: meter ?? undefined };
      // Kept on the phone the moment it stops (lib/outbox), held while the question below is open: should the
      // app die meanwhile, it goes with the answer remembered from last time (a free tune if a song is not paid for).
      const heldId = enqueueTake({
        fileUri: uri,
        fileName: name,
        opts: { ...base, separate: mode !== "chords" && importKindAnswered() && importKind() === "song" && !songNeedsCredit },
        held: true,
      });
      // A phone held up to a speaker records a song as surely as a file import does, and a song
      // transcribed whole comes back as a scatter of wrong notes — so the same question, with the
      // same remembered answer, and no cancel because the take is already made.
      const separate = mode === "chords" ? false : ((await askIfSong(false, true)) ?? false);
      const send = async (isolate: boolean) => {
        setPhase("uploading");
        const opts = { ...base, separate: isolate };
        void logAnalyticsEvent("beats_in_a_bar", { meter: meterEventValue(meter), source: "mic" });
        const jobId = await submitOrQueue(uri, name, opts, heldId);
        if (jobId) {
          setMeter(null);
          void offerBackgroundAlerts();
        }
      };
      // A song is not one of the free weekly ones: the take is made, so offer to send it as a sung tune —
      // and keep it in the Library meanwhile, for when a song is bought.
      if (separate && songNeedsCredit) {
        setPhase("ready");
        if (heldId) parkTake(heldId, SONG_NOT_FREE_CODE, SONG_KEPT_REASON, { ...base, separate: true });
        showSongNotFree(() => void send(false).catch(() => setPhase("ready")), heldId !== null);
        return;
      }
      await send(separate);
    } catch {
      setPhase("ready");
    }
  }

  const handleButtonPress = () => {
    if (phase === "ready") startRecording();
    else if (phase === "recording") stopAndSubmit();
  };

  /**
   * Throws the take away without sending it: the recorder stops, the clock resets and nothing
   * reaches the server, so nothing is spent.
   */
  async function discardTake() {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    quietSinceRef.current = null;
    setShowQuietGuidance(false);
    setPhase("ready");
    setElapsed(0);
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch {
      // The take is being thrown away; a recorder that will not stop cleanly has nothing to lose.
    }
  }

  /**
   * Asks first once the take is long enough to be worth keeping — a slip of the thumb should not
   * cost two minutes of singing — and goes straight through for a false start.
   */
  function confirmDiscard(title: string, confirmLabel: string, then: () => void) {
    if (elapsed < 10) {
      then();
      return;
    }
    showDialog({
      title,
      message: "This recording will be lost. Nothing is sent and nothing is used up.",
      icon: "delete",
      tone: "danger",
      actions: [
        { label: confirmLabel, style: "destructive", onPress: then },
        { label: "Keep recording", style: "cancel" },
      ],
    });
  }

  /** The ghost button while recording: drop this take and start a fresh one. */
  function startOver() {
    confirmDiscard("Start over?", "Start over", () => {
      void discardTake().then(startRecording);
    });
  }

  /**
   * The close button. A take in progress is thrown away (with the same ask); a job on its way
   * keeps going — the server finishes it and the result still opens — so leaving is safe.
   */
  function close() {
    if (phase === "recording") {
      confirmDiscard("Discard this recording?", "Discard", () => {
        void discardTake();
        leave();
      });
      return;
    }
    leave();
  }

  /**
   * While the mic is on, leaving asks as the close button does: Android's back and a tab in the bar
   * (lib/leaveGuard) used to walk away with the recorder still running out of sight, which then sent the
   * take by itself at the three-minute cap. The latest render's ask is kept in a ref so it sees today's clock.
   */
  const leaveAsk = useRef<(proceed: () => void) => void>(() => {});
  leaveAsk.current = (proceed) =>
    confirmDiscard("Discard this recording?", "Discard", () => {
      void discardTake();
      proceed();
    });
  useEffect(() => {
    if (phase !== "recording") return;
    setLeaveGuard((proceed) => leaveAsk.current(proceed));
    return () => setLeaveGuard(null);
  }, [phase]);
  useFocusEffect(
    useCallback(() => {
      if (phase !== "recording") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        leaveAsk.current(leave);
        return true;
      });
      return () => sub.remove();
    }, [phase, leave]),
  );

  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  const isUploading = phase === "uploading";
  const isRecording = phase === "recording";
  /** The connection dropped: the take waits on the phone (board 13). */
  const kept = following && take.state.kept;
  /** Our failure, and the take is being sent again by itself (board 13). */
  const resending = following ? take.state.resending : null;
  const keptTake = kept ? takeById(take.state.takeId!) : null;

  // The row of steps on the uploading card. A hummed tune skips the isolating step — unless
  // the worker says it is isolating anyway, in which case the step is shown rather than lost.
  const sentOpts = following ? takeById(take.state.takeId!)?.opts : lastSubmitArgs.current?.opts;
  const separating = sentOpts?.separate === true || state.stage === "separating";
  const uploadStages = separating ? UPLOAD_STAGES : UPLOAD_STAGES.filter((s) => s.key !== "separating");
  const uploadStageIndex = uploadStages.findIndex((s) => s.key === state.stage);

  const pillLabel = MODE_TITLE[mode] + (selectedKey === "Auto" ? "" : ` · ${selectedKey}`) + (meter ? ` · ${meter}` : "");

  // The job's step as it changes, and the quiet nudge as it shows: Android reads them as live regions, iOS hears them here.
  const jobTitle = resending ? "Sending it again" : stageLabel(state.stage, state.queuePosition);
  useIosAnnouncement(isUploading && !kept ? jobTitle : null);
  useIosAnnouncement(showQuietGuidance ? QUIET_GUIDANCE : null);

  return (
    // Scrolls only when it has to. `container` grows to fill the viewport, so at the default text
    // size the trace takes up the slack between the clock and the controls — the scroll is what
    // absorbs a large Font size or Display size setting instead of pushing the controls off the
    // bottom edge behind the tab bar.
    <Screen edges={guest ? ["top", "bottom"] : ["top"]} scroll contentStyle={styles.scrollContent}>
      <View style={[styles.container, guest && styles.containerGuest]}>
        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <View style={styles.topBar}>
          <View style={styles.topSide}>
            <Touchable
              onPress={close}
              style={styles.iconBtn}
              radius={20}
              // A 40 px circle: 48 dp to a thumb without moving it (the pill is 8 px away).
              hitSlop={4}
              accessibilityLabel={isRecording ? "Discard recording and close" : "Close"}
            >
              <Icon name="close" size={20} color={colors.text} />
            </Touchable>
          </View>

          {kept ? (
            <View style={styles.offlinePill} accessibilityLabel="Offline">
              <Icon name="offline" size={14} color={colors.textMuted} />
              <Text style={styles.offlinePillText} maxFontSizeMultiplier={MAX_TEXT_SCALE_CHROME}>
                Offline
              </Text>
            </View>
          ) : null}

          {!isUploading && (
            <Touchable
              onPress={() => setOptionsOpen(true)}
              // Locked once recording starts. Passing `disabled` rather than gating inside
              // onPress is what stops the pill springing and buzzing at a tap that does
              // nothing — and it fades to the same 0.4 every other disabled control uses.
              disabled={phase !== "ready"}
              style={styles.modePill}
              radius={radii.pill}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              accessibilityLabel={`${pillLabel}. Change what you're recording`}
            >
              <Text style={styles.modePillText} numberOfLines={1} maxFontSizeMultiplier={MAX_TEXT_SCALE_CHROME}>
                {pillLabel}
              </Text>
              <Icon name="down" size={14} color={colors.textMuted} />
            </Touchable>
          )}

          <View style={[styles.topSide, styles.topSideEnd]}>
            {/* Pro jobs run in the queue's high-priority lane. */}
            {isPro && (
              <View style={styles.fastLane} accessibilityLabel="Fast lane: Pro recordings go first">
                <Icon name="pro" size={12} color={colors.premiumDeep} />
                <Text style={styles.fastLaneText} maxFontSizeMultiplier={MAX_TEXT_SCALE_CHROME}>
                  Fast lane
                </Text>
              </View>
            )}
          </View>
        </View>

        {isUploading && kept ? (
          /* Kept on this phone (board 13): the connection dropped, so the take waits in the app's storage and goes
             by itself when the API answers, even after the app is closed. The bar stays where the upload stopped. */
          <View style={styles.jobZone}>
            <View style={styles.jobCard}>
              <View style={[styles.jobMark, styles.jobMarkQuiet]}>
                <Icon name="offline" size={26} color={colors.text} />
              </View>
              <Text style={styles.jobTitle}>Kept on this phone</Text>
              <Text style={styles.jobSub}>
                The connection dropped. We&apos;ll send it as soon as you&apos;re online; you can close the app.
              </Text>
              <View style={styles.jobBarRow}>
                <View style={styles.progressTrack}>
                  <View
                    style={[styles.progressFill, styles.progressFillPaused, { width: `${Math.max(3, Math.min(100, state.progress * 100))}%` }]}
                  />
                </View>
                <Text style={[styles.jobPct, styles.jobPctPaused]} maxFontSizeMultiplier={MAX_TEXT_SCALE_DISPLAY}>
                  {percentLabel(state.progress)}
                </Text>
              </View>
              <Text style={styles.pausedLine}>Uploading · paused</Text>
              <View style={styles.keptActions}>
                <Button label="See it in Library" variant="secondary" size="sm" onPress={() => leaveKept(true)} />
                <Button label="Record another" size="sm" onPress={() => leaveKept(false)} />
              </View>
              {keptTake ? <Text style={styles.keptMeta}>{takeMeta(keptTake)}</Text> : null}
            </View>
          </View>
        ) : isUploading ? (
          /* The uploading card: the mark, the step the job is on, a real percentage — the
             upload's own until the server answers, the worker's after — and the steps still
             to come. Once the server has the job it finishes it whether or not anyone is
             watching, and sends a notification when it does; the upload itself is the part
             that has to stay in the foreground. Nothing on this card is server text. */
          <View style={styles.jobZone}>
            <View style={styles.jobCard}>
              <View style={styles.jobMark}>
                {resending ? <Icon name="retry" size={26} color={colors.accent} /> : <Mark height={30} color={colors.accent} />}
              </View>
              <Text style={styles.jobTitle} accessibilityLiveRegion="polite">
                {jobTitle}
              </Text>
              <Text style={styles.jobSub}>
                {resending === "lost"
                  ? "Our server restarted while writing your solfa, so we're sending your recording again. Nothing to do, and it isn't charged twice."
                  : resending === "server"
                    ? "Our server had a problem with that upload, so we're sending your recording again. Nothing to do, and it isn't charged twice."
                    : state.stage === "uploading"
                      ? "Keep the app open until the upload finishes."
                      : guest
                        ? "Your preview opens here when it's ready."
                        : "You can leave this screen — we'll notify you when it's ready."}
              </Text>

              <View style={styles.jobBarRow}>
                <View style={styles.progressTrack}>
                  <View
                    style={[styles.progressFill, { width: `${Math.max(3, Math.min(100, state.progress * 100))}%` }]}
                  />
                </View>
                <Text style={styles.jobPct} maxFontSizeMultiplier={MAX_TEXT_SCALE_DISPLAY}>
                  {percentLabel(state.progress)}
                </Text>
              </View>

              <View style={styles.uploadStages}>
                {uploadStages.map((s, i) => {
                  const done = uploadStageIndex > i;
                  const on = uploadStageIndex === i;
                  return (
                    <View key={s.key} style={styles.uploadStage}>
                      <Icon
                        name={done ? "done" : "step"}
                        size={12}
                        filled={on}
                        color={done ? colors.success : on ? colors.link : colors.textFaint}
                      />
                      <Text
                        style={[
                          styles.uploadStageText,
                          on && styles.uploadStageTextOn,
                          done && styles.uploadStageTextDone,
                        ]}
                      >
                        {/* Sending again, the title says so: the step on carries the place in line instead. */}
                        {on && resending ? stageLabel(state.stage, state.queuePosition) : s.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
              {resending ? (
                <Text style={styles.jobFoot}>You can leave this screen; we&apos;ll notify you when it&apos;s ready.</Text>
              ) : null}

              {state.stalled ? <Text style={styles.uploadWarn}>{STALLED_LINE}</Text> : null}
              {state.offline ? <Text style={styles.uploadWarn}>{OFFLINE_LINE}</Text> : null}
              {/* Never for a guest: a second preview from this phone would be refused while the first runs. */}
              {state.canRetry && !guest ? (
                <Button
                  label="Try again"
                  icon="retry"
                  variant="secondary"
                  onPress={() => void (following ? take.retry() : direct.retry())}
                  style={{ marginTop: spacing.lg, alignSelf: "stretch" }}
                />
              ) : null}
            </View>
          </View>
        ) : (
          <>
            {/* ── Clock and status ──────────────────────────────────────────── */}
            <View style={styles.clockArea}>
              <Text
                style={styles.timerText}
                maxFontSizeMultiplier={MAX_TEXT_SCALE_DISPLAY}
                accessibilityLabel={`${Math.floor(elapsed / 60)} minutes ${elapsed % 60} seconds`}
              >
                {clock}
              </Text>
              <View style={styles.statusRow}>
                {isRecording && <View style={styles.recDot} />}
                <Text style={styles.statusLine}>
                  {phase === "ready"
                    ? "Tap to record · sing, hum or play near the mic"
                    : guest
                      ? guestRecordingLine(elapsed)
                      : elapsed >= MAX_RECORD_SEC - RECORD_WARN_AT_SEC
                        ? `Stopping in ${MAX_RECORD_SEC - elapsed}s — ${MAX_RECORD_SEC / 60} minutes is the longest clip we can transcribe.`
                        : "Recording · keep going to the end of the phrase"}
                </Text>
              </View>

              {/* A guest's take is the website's free preview (board l-ux-high/07): said once, in the
                  counter's place. */}
              {guest ? (
                <View style={styles.previewPill}>
                  <Icon name="about" size={13} color={colors.link} />
                  <Text style={styles.previewPillText}>
                    Free {GUEST_MAX_SECONDS}-second preview · no account needed
                  </Text>
                </View>
              ) : null}

              {/* Free-tier counter. Gated on `known` as well as `!isPro`: the fallback
                  value is the full allowance, so an unanswered billing request would
                  otherwise announce "5 of 5 left" to a Pro account. Tappable throughout —
                  wanting to see the plans is not only an out-of-credits impulse. */}
              {!guest && known && !isPro && (
                <Touchable
                  onPress={() => nav.navigate("Upgrade")}
                  style={styles.trialPill}
                  radius={radii.pill}
                  // A one-line pill about 27 px tall: the slop makes it 44 to a thumb.
                  hitSlop={{ top: 9, bottom: 9, left: 8, right: 8 }}
                  accessibilityLabel={
                    trialRemaining > 0 ? "See Pro plans" : `Free ones back ${freeBack}. See Pro plans`
                  }
                >
                  {/* Spent is said plainly, in the quiet pill: no lock, no red. */}
                  <Text style={[styles.trialPillText, trialRemaining <= 0 && styles.trialPillTextSpent]}>
                    {freeRemaining > 0
                      ? `${freeRemaining} of ${freePerWeek} free this week · back ${freeBack}`
                      : boughtRemaining > 0
                        ? `${boughtRemaining} bought left · free back ${freeBack}`
                        : `Free ones back ${freeBack}`}
                  </Text>
                </Touchable>
              )}

              {/* The transpose rides along with every submit, so it stays in view whenever it
                  is set, not only inside the sheet. */}
              {kbTranspose !== 0 && phase === "ready" ? (
                <Text style={styles.settingLine}>
                  Keyboard transpose · {keyboardTransposeLabel(kbTranspose)}
                </Text>
              ) : null}
            </View>

            {/* ── Level trace ────────────────────────────────────────────────── */}
            <View style={styles.traceArea}>
              <LevelTrace
                levels={levels}
                capacity={TRACE_POINTS}
                headColor={meterColor}
              />

              {/* "Sing louder / move closer" guidance banner — fades in after a
                  sustained quiet stretch while recording. Over the top of the trace,
                  so it never covers the controls. Always drawn for the fade, so a
                  screen reader is kept off it while it is hidden and told when it shows. */}
              <Animated.View
                style={[styles.guidanceBanner, { opacity: guidanceOpacity }]}
                pointerEvents="none"
                accessibilityElementsHidden={!showQuietGuidance}
                importantForAccessibility={showQuietGuidance ? "yes" : "no-hide-descendants"}
                accessibilityLiveRegion={showQuietGuidance ? "polite" : "none"}
              >
                <View style={styles.guidanceDot} />
                <Text style={styles.guidanceText}>{QUIET_GUIDANCE}</Text>
              </Animated.View>
            </View>
          </>
        )}

        {/* ── Error cards ──────────────────────────────────────────────────── */}
        {permError && (
          <Card style={styles.errCard}>
            <View style={styles.errRow}>
              <Icon name="problem" size={18} color={colors.warning} style={styles.errIcon} />
              <Text style={styles.errText}>{permError}</Text>
            </View>
            {permSettings ? (
              <Button
                label="Open settings"
                variant="text"
                size="sm"
                onPress={() => void Linking.openSettings().catch(() => undefined)}
                style={styles.errAction}
              />
            ) : null}
          </Card>
        )}

        {/* A guest's refused send (board l-ux-high/07): this phone's preview used — the way to an account; no answer
            or our fault — the take is kept, with Send it again; anything else in the API's words. */}
        {guest && guestRefused?.refusal === "used" ? (
          <GuestAccountCard
            message="This phone has had its free preview. Create a free account for 3 a week."
            primary="Create a free account"
            style={styles.errCard}
          />
        ) : guest && guestRefused ? (
          <Card style={styles.errCard}>
            <View style={styles.errRow}>
              <Icon name="problem" size={18} color={colors.warning} style={styles.errIcon} />
              <Text style={styles.errText}>
                {guestRefused.refusal === "kept" ? "Couldn't send it. Your take is kept." : guestRefused.message}
              </Text>
            </View>
            {guestRefused.refusal === "kept" && guestTake.current ? (
              <Button
                label="Send it again"
                icon="retry"
                onPress={() => {
                  const kept = guestTake.current;
                  if (kept) void sendGuest(kept.uri, kept.name);
                }}
                style={{ marginTop: spacing.md }}
              />
            ) : null}
          </Card>
        ) : null}

        {/* A guest's preview that failed: said, and a new take is the way on (a failed preview is not had). */}
        {guest && state.error ? (
          <Card style={styles.errCard}>
            <View style={styles.errRow}>
              <Icon name="problem" size={18} color={colors.warning} style={styles.errIcon} />
              <Text style={styles.errText}>{state.error}</Text>
            </View>
          </Card>
        ) : null}

        {!guest && state.error && (
          <Card style={styles.errCard}>
            <View style={styles.errRow}>
              <Icon name="problem" size={18} color={colors.warning} style={styles.errIcon} />
              <Text style={styles.errText}>{state.error}</Text>
            </View>
            <Button
              label="Retry Upload"
                variant="secondary"
                onPress={() => {
                  if (following) {
                    setPhase("uploading");
                    void take.retry().then((t) => {
                      if (!t) setPhase("ready");
                    });
                  } else if (lastSubmitArgs.current) {
                    setPhase("uploading");
                    void direct.start(lastSubmitArgs.current.uri, lastSubmitArgs.current.name, lastSubmitArgs.current.opts);
                  } else {
                    reset();
                    setPhase("ready");
                  }
                }}
                style={{ marginTop: spacing.md }}
            />
          </Card>
        )}

        {/* ── Controls ─────────────────────────────────────────────────────── */}
        {!isUploading && (
          <View style={styles.controls}>
            {/* Left: importing a file when idle; throwing the take away and starting again
                while recording. */}
            <View style={styles.sideSlot}>
              <Touchable
                onPress={isRecording ? startOver : pickAudioFile}
                style={styles.ghostBtn}
                radius={28}
                accessibilityLabel={isRecording ? "Start over" : "Import audio file"}
              >
                <Icon
                  name={isRecording ? "retry" : "import"}
                  size={22}
                  color={colors.text}
                />
              </Touchable>
              <Text style={styles.sideCaption} maxFontSizeMultiplier={MAX_TEXT_SCALE_CHROME}>
                {isRecording ? "Start over" : "Import"}
              </Text>
            </View>

            {/* Record button. It takes the heavier tick on press-in — starting and stopping
                a recording is the most consequential tap on the screen — and the large-target
                press. No ripple: unclipped it paints a square, and clipping would cut off the
                idle glow. Idle it is the mark on the brand blue; recording, a ring around the
                red stop square, and the one way to finish (board m-ux-medium P3d): its words
                under it. They hold their place while idle, so the ring does not move as a take starts. */}
            <View style={styles.recordSlot}>
              <Touchable
                onPress={handleButtonPress}
                haptic="medium"
                scaleTo={motion.scale.large}
                ripple={false}
                style={isRecording ? styles.recordRing : styles.recordIdle}
                accessibilityLabel={isRecording ? "Stop and transcribe" : "Start recording"}
              >
                {isRecording ? (
                  <View style={styles.stopSquare} />
                ) : (
                  <Mark height={38} color={colors.onInk} />
                )}
              </Touchable>
              <Text
                style={[styles.recordCaption, !isRecording && styles.recordCaptionIdle]}
                maxFontSizeMultiplier={MAX_TEXT_SCALE_CHROME}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                Stop and transcribe
              </Text>
            </View>

            {/* Right: empty, so the record button keeps the centre. */}
            <View style={styles.sideSlot} />
          </View>
        )}
        {guest && !isUploading ? (
          <Text style={styles.stopsLine}>Stops by itself at 0:{GUEST_MAX_SECONDS}</Text>
        ) : null}
      </View>

      <RecordOptionsSheet
        visible={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        modes={MODES}
        mode={mode}
        onMode={setMode}
        // The preview has no key to give: it is always heard (the API's preview takes none).
        keys={guest ? [] : KEYS}
        selectedKey={selectedKey}
        onKey={setSelectedKey}
        meter={meter}
        onMeter={setMeter}
        showTranspose={mode === "chords" || kbTranspose !== 0}
        transposeChoices={KEYBOARD_TRANSPOSE_CHOICES}
        transpose={kbTranspose}
        transposeLabel={keyboardTransposeLabel}
        onTranspose={(t) => {
          setKbTranspose(t);
          void setKeyboardTranspose(t);
        }}
      />
    </Screen>
  );
}

/** "Try it first" (board l-ux-high/07): Record as a guest, on the night canvas as every first-run screen is. */
export function GuestRecordScreen() {
  return (
    <ThemeOverride mode="dark">
      <RecordScreen guest />
    </ThemeOverride>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const RECORD_SIZE = 84;
const SIDE_SIZE = 56;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  scrollContent: {
    // `flex: 1` does nothing to a ScrollView's content container; `flexGrow` is what makes the
    // column fill the viewport when the content is shorter than it.
    flexGrow: 1,
  },

  container: {
    flexGrow: 1,
    // Clears the floating tab bar, which is absolutely positioned over the bottom of the screen.
    paddingBottom: 110,
  },

  /** A guest has no tab bar to clear. */
  containerGuest: {
    paddingBottom: spacing.xl,
  },

  // ── Top bar ──────────────────────────────────────────────────────────────

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },

  /** Equal-width sides, so the pill stays centred whether or not the badge is there. */
  topSide: {
    flex: 1,
    flexDirection: "row",
  },
  topSideEnd: {
    justifyContent: "flex-end",
  },

  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },

  modePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 15,
    borderRadius: radii.pill,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    // "Polyphonic · Bb major" on a narrow handset gives up the label's tail rather than the
    // close button.
    flexShrink: 1,
  },

  modePillText: {
    fontFamily: fonts.medium,
    fontSize: 13.5,
    color: c.text,
    flexShrink: 1,
  },

  fastLane: {
    height: 26,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    backgroundColor: c.premiumSoft,
    borderWidth: 1,
    borderColor: c.premiumBorder,
    alignItems: "center",
    justifyContent: "center",
  },

  fastLaneText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: c.premiumDeep,
  },

  // ── Clock & status ────────────────────────────────────────────────────────

  clockArea: {
    alignItems: "center",
    marginTop: spacing.xxxl - spacing.xs,
    paddingHorizontal: spacing.sm,
  },

  timerText: {
    fontFamily: nightFonts.mono,
    fontSize: 80,
    letterSpacing: -3,
    color: c.text,
    fontVariant: ["tabular-nums"],
    // The face's line box is tall at this size; the default leaves a gap that pushes the status
    // line away from the figures it belongs to.
    lineHeight: 92,
  },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: spacing.xs,
  },

  recDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: c.danger,
  },

  // The one instruction on the screen is a 16 px sentence; labels are 13 and up (board m-ux-medium P3f).
  statusLine: {
    ...typography.body,
    fontSize: 16,
    lineHeight: 23,
    color: c.textMuted,
    textAlign: "center",
    flexShrink: 1,
  },

  settingLine: {
    ...typography.caption,
    color: c.textFaint,
    marginTop: spacing.sm,
    textAlign: "center",
  },

  // ── Free-tier counter ─────────────────────────────────────────────────────
  //
  // Under the status line rather than beside the record button, so it reads as account
  // context and not as a warning about the recording in progress.

  trialPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    marginTop: spacing.md,
    // "Free ones back Friday 6pm — see Pro plans" is wider than a narrow handset once the text setting is
    // turned up. RN defaults `flexShrink` to 0, so without this pair the row keeps its natural width
    // and simply runs off both edges rather than wrapping.
    maxWidth: "100%",
  },
  trialPillText: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: c.textMuted,
    flexShrink: 1,
  },
  trialPillTextSpent: {
    color: c.textMuted,
  },

  /** The guest's "Free 30-second preview" (board l-ux-high/07): information, so the link blue on its soft wash. */
  previewPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentGlow,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    marginTop: spacing.md,
    maxWidth: "100%",
  },
  previewPillText: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: c.link,
    flexShrink: 1,
  },

  /** Under the controls for a guest: when the take ends by itself. */
  stopsLine: {
    ...typography.caption,
    color: c.textMuted,
    textAlign: "center",
    marginTop: spacing.lg,
  },

  // ── Level trace ───────────────────────────────────────────────────────────

  /** Takes whatever height is left between the clock and the controls. */
  traceArea: {
    flexGrow: 1,
    minHeight: 160,
    marginTop: spacing.xl,
    marginHorizontal: -spacing.lg, // runs edge to edge, as the guides do on the board
    justifyContent: "flex-start",
    alignItems: "center",
  },

  // ── Voice-level guidance banner ───────────────────────────────────────────

  /** A nudge, not an alarm (board 7c): the quiet pill with an amber dot, never red. */
  guidanceBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.surfaceAlt,
    borderRadius: radii.pill,
    minHeight: 34,
    paddingVertical: 7,
    paddingHorizontal: 14,
    // Inside the edge-to-edge trace area, so this is what keeps the banner off both edges.
    maxWidth: "90%",
  },

  guidanceDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: c.warning,
    marginRight: spacing.sm,
  },

  guidanceText: {
    color: c.text,
    fontSize: 13,
    fontFamily: fonts.semibold,
    flexShrink: 1,
  },

  // ── Controls ──────────────────────────────────────────────────────────────

  controls: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 34,
    marginTop: spacing.lg,
  },

  /** A side button with its caption; the caption hangs below so the circles line up with the
   *  record button's centre. */
  sideSlot: {
    alignItems: "center",
    width: 72,
    paddingTop: (RECORD_SIZE - SIDE_SIZE) / 2,
    gap: 6,
  },

  sideCaption: {
    ...typography.caption,
    fontSize: 13,
    letterSpacing: 0,
    color: c.textMuted,
  },

  ghostBtn: {
    width: SIDE_SIZE,
    height: SIDE_SIZE,
    borderRadius: SIDE_SIZE / 2,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },

  /** The record button with its words under it. */
  recordSlot: {
    alignItems: "center",
    gap: spacing.sm,
  },

  /** "Stop and transcribe": the ring's own spoken label, said under it while recording. */
  recordCaption: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: c.textMuted,
  },
  recordCaptionIdle: {
    opacity: 0,
  },

  /** Idle: the mark on a filled blue disc — the one glowing thing on the screen. */
  recordIdle: {
    width: RECORD_SIZE,
    height: RECORD_SIZE,
    borderRadius: RECORD_SIZE / 2,
    backgroundColor: c.ink,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: c.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 22,
    elevation: 10,
  },

  /** Recording: a plain ring in the text colour around the stop square. */
  recordRing: {
    width: RECORD_SIZE,
    height: RECORD_SIZE,
    borderRadius: RECORD_SIZE / 2,
    borderWidth: 3,
    borderColor: c.text,
    alignItems: "center",
    justifyContent: "center",
  },

  stopSquare: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: c.danger,
  },

  // ── Job card ──────────────────────────────────────────────────────────────

  /** The card sits in the middle of what is left of the screen, nothing to scroll past. */
  jobZone: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: spacing.xl,
  },

  jobCard: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl + spacing.xs,
    paddingBottom: spacing.xl,
  },

  /** Kept on the phone: the offline sign on a neutral tile (blue is for what is moving). */
  jobMarkQuiet: {
    backgroundColor: c.surfaceAlt,
  },

  progressFillPaused: {
    backgroundColor: c.textMuted,
  },

  jobPctPaused: {
    color: c.textMuted,
  },

  pausedLine: {
    fontFamily: fonts.regular,
    fontSize: 12.5,
    color: c.textFaint,
    marginTop: spacing.sm,
  },

  keptActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },

  keptMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: c.textFaint,
    marginTop: spacing.lg,
    textAlign: "center",
  },

  jobFoot: {
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 17,
    color: c.textFaint,
    textAlign: "center",
    marginTop: spacing.lg,
  },

  offlinePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: c.surfaceAlt,
  },

  offlinePillText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: c.textMuted,
  },

  /** The mark on a soft disc, standing in for the record button while it is busy. */
  jobMark: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: c.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },

  jobTitle: {
    fontFamily: fonts.semibold,
    fontSize: 20,
    letterSpacing: -0.5,
    color: c.text,
    textAlign: "center",
  },

  jobSub: {
    ...typography.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: c.textMuted,
    textAlign: "center",
    marginTop: spacing.xs + 2,
  },

  jobBarRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: spacing.md,
    marginTop: spacing.xl,
  },

  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: c.surfaceAlt,
    overflow: "hidden",
  },

  progressFill: {
    height: "100%",
    borderRadius: radii.pill,
    backgroundColor: c.ink,
  },

  jobPct: {
    fontFamily: typography.mono.fontFamily,
    fontSize: 14,
    color: c.accent,
    fontVariant: ["tabular-nums"],
    minWidth: 40,
    textAlign: "right",
  },

  uploadStages: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: spacing.md,
    rowGap: spacing.xs,
    marginTop: spacing.lg,
  },

  uploadStage: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },

  uploadStageText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: c.textFaint,
  },

  uploadStageTextOn: {
    color: c.accent,
  },

  uploadStageTextDone: {
    color: c.successText,
  },

  uploadWarn: {
    ...typography.caption,
    color: c.warningText,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.md,
    textAlign: "center",
  },

  // ── Error card ────────────────────────────────────────────────────────────

  /** A problem is a neutral card with a small amber icon and plain words, never a red wash. */
  errCard: {
    width: "100%",
    marginTop: spacing.md,
  },

  errRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },

  errIcon: {
    marginRight: spacing.sm,
    marginTop: 1,
  },

  errText: {
    ...typography.body,
    color: c.text,
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },

  /** A text button under the note, its word lined up with the note's (icon 18 + gap, less the button's 12 pad). */
  errAction: {
    alignSelf: "flex-start",
    marginLeft: 18 + spacing.sm - 12,
    marginTop: spacing.xs,
  },
});
