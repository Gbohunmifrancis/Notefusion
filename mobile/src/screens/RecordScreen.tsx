import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
 Alert } from "react-native";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  type RecordingOptions,
} from "expo-audio";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Touchable } from "../components/Touchable";
import { BrandMark } from "../components/BrandMark";
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
import { useSubscription } from "../lib/subscription";
import { importKind, loadImportKind, setImportKind } from "../lib/importKind";
import {
  KEYBOARD_TRANSPOSE_CHOICES,
  keyboardTranspose,
  keyboardTransposeLabel,
  loadKeyboardTranspose,
  setKeyboardTranspose,
} from "../lib/keyboardTranspose";
import {
  fonts,
  gradients,
  radii,
  spacing,
  typography,
  type Palette,
} from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { RootStackParams, TabParams } from "../navigation/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "melody" | "poly" | "choir" | "chords";

/**
 * "Choir" is a whole choir singing in parts: each part comes back as it was sung. "Chords" is a
 * piano or guitar playing: the chords are read and written over the solfa.
 */
const MODE_LABEL: Record<Mode, string> = { melody: "Melody", poly: "Polyphonic", choir: "Choir", chords: "Chords" };
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

const WAVE_BARS = 28; // number of soundwave visualiser bars

/**
 * The API's code for the free-tier refusal (`BillingErrors.FreeTierLimitReached`).
 *
 * Matched on the code, not the message: this branch used to sniff for four different
 * substrings of the server's prose, which would have silently stopped working the first
 * time anyone reworded the error.
 */
const FREE_TIER_LIMIT_CODE = "BILLING_FREE_TIER_LIMIT";

const RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 22050,
  numberOfChannels: 1,
  isMeteringEnabled: true,
};

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

/**
 * Ceilings on the OS text-size setting, for the two kinds of text this screen cannot let grow freely.
 * Android's *Font size* and *Display size* multiply independently, so a handset set to both extremes
 * asks for roughly 1.5× the type in roughly 0.8× the width.
 *
 * DISPLAY caps the large decorative figures — the timer and the screen title. They are already the
 * biggest text on the screen at 1.0×, so a third again is plenty and the rest of the growth would only
 * cost layout. Everything that carries instructions (the status line, the error text, the guidance
 * banner) is deliberately left uncapped and wraps or scrolls instead.
 *
 * IN_DISC caps the two labels inside the record button's 116px glass disc, which cannot grow with them:
 * "analysing" at 1.5× is wider than the circle it sits in. Cheap accessibility-wise, because both
 * repeat information the uncapped status area shows at full size right below.
 */
const MAX_TEXT_SCALE_DISPLAY = 1.3;
const MAX_TEXT_SCALE_IN_DISC = 1.15;

/** Maps a dBFS metering value to a 0..1 fraction for the level-meter bar. */
function meteringToFraction(dbfs: number): number {
  const clamped = Math.max(LEVEL_SILENCE_DBFS, Math.min(0, dbfs));
  return (clamped - LEVEL_SILENCE_DBFS) / (0 - LEVEL_SILENCE_DBFS);
}

/** Traffic-light colour for the current metering level. */
function meteringToColor(dbfs: number, c: Palette): string {
  if (dbfs >= LEVEL_GOOD_DBFS) return c.success; // comfortably loud
  if (dbfs >= LEVEL_QUIET_DBFS) return c.warning; // audible but soft
  return c.danger; // too quiet / far from the mic
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
    message:
      "Transcribing takes a moment. Turn on notifications and you can leave the app — we'll let you know as soon as your score is done.",
    icon: "notifications-outline",
    tone: "brand",
    actions: [
      { label: "Notify me", icon: "checkmark", onPress: () => void enablePush() },
      { label: "Not now", style: "cancel" },
    ],
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * RecordScreen — light blue audio capture & transcription trigger.
 *
 * The central gradient record button (Deep Blue → Bright Blue ring +
 * white disc) is the hero.
 *
 *   • Ready state    : static gradient ring, pulsing ambient glow orb.
 *   • Recording      : two concentric blue ripple waves; animated
 *                      soundwave bars below the button.
 *   • Uploading      : gradient progress bar; percentage inside the button.
 *   • Mode toggle    : white pill — active segment uses gradient fill.
 *   • Key picker     : horizontal scroll of glass chips; active chip gradient.
 *   • Error cards    : red-tinted glass surface consistent with the system.
 */
export function RecordScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute<RouteProp<TabParams, "Record">>();
  const tabNav = useNavigation<BottomTabNavigationProp<TabParams, "Record">>();
  const { state, start, retry, reset } = useJobPolling();
  const { isPro, known, trialRemaining, trialTotal, refresh, subscription } = useSubscription();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [phase, setPhase] = useState<Phase>("ready");
  const [mode, setMode] = useState<Mode>("melody");
  const [selectedKey, setSelectedKey] = useState<string>("Auto");
  /** The player's keyboard transpose, mirrored from the module cache so the chips repaint. */
  const [kbTranspose, setKbTranspose] = useState(keyboardTranspose());
  useEffect(() => {
    void loadImportKind();
    void loadKeyboardTranspose().then(() => setKbTranspose(keyboardTranspose()));
  }, []);
  const [elapsed, setElapsed] = useState(0);
  const [permError, setPermError] = useState<string | null>(null);

  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  // Polls the native recorder ~6x/sec for status + metering while recording;
  // expo-audio only reports metering through this hook, not on `recorder` itself.
  const recorderState = useAudioRecorderState(recorder, 150);

  // ── Animation values ──────────────────────────────────────────────────────
  const ripple1 = useRef(new Animated.Value(1)).current;
  const ripple2 = useRef(new Animated.Value(1)).current;
  const rippleOpacity1 = useRef(new Animated.Value(0)).current;
  const rippleOpacity2 = useRef(new Animated.Value(0)).current;
  const ambientGlow = useRef(new Animated.Value(0.3)).current;
  const barAnims = useRef(
    Array.from({ length: WAVE_BARS }, () => new Animated.Value(0.15)),
  ).current;
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSubmitArgs = useRef<{uri: string, name: string, opts: any} | null>(null);

  // ── Voice-level guidance state ────────────────────────────────────────────
  const [showQuietGuidance, setShowQuietGuidance] = useState(false);
  const quietSinceRef = useRef<number | null>(null);
  const meterAnim = useRef(new Animated.Value(0)).current;
  const guidanceOpacity = useRef(new Animated.Value(0)).current;

  // ── Ambient glow pulse (always on) ───────────────────────────────────────
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(ambientGlow, {
          toValue: 0.65,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(ambientGlow, {
          toValue: 0.25,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [ambientGlow]);

  // ── Ripple waves ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === "recording") {
      const anim1 = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ripple1, {
              toValue: 1.6,
              duration: 1100,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(rippleOpacity1, {
              toValue: 0,
              duration: 1100,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(ripple1, {
              toValue: 1,
              duration: 0,
              useNativeDriver: true,
            }),
            Animated.timing(rippleOpacity1, {
              toValue: 0.7,
              duration: 0,
              useNativeDriver: true,
            }),
          ]),
        ]),
      );

      const anim2 = Animated.loop(
        Animated.sequence([
          Animated.delay(420),
          Animated.parallel([
            Animated.timing(ripple2, {
              toValue: 1.95,
              duration: 1400,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(rippleOpacity2, {
              toValue: 0,
              duration: 1400,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(ripple2, {
              toValue: 1,
              duration: 0,
              useNativeDriver: true,
            }),
            Animated.timing(rippleOpacity2, {
              toValue: 0.45,
              duration: 0,
              useNativeDriver: true,
            }),
          ]),
        ]),
      );

      anim1.start();
      anim2.start();

      return () => {
        anim1.stop();
        anim2.stop();
        ripple1.setValue(1);
        ripple2.setValue(1);
        rippleOpacity1.setValue(0);
        rippleOpacity2.setValue(0);
      };
    }
  }, [phase, ripple1, ripple2, rippleOpacity1, rippleOpacity2]);

  // ── Soundwave bars ────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === "recording") {
      const anims = barAnims.map((bar, i) => {
        const targetHigh = 0.5 + Math.random() * 0.5;
        const targetLow = 0.1 + Math.random() * 0.2;
        const dur = 180 + Math.random() * 220;
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(bar, {
              toValue: targetHigh,
              duration: dur,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(bar, {
              toValue: targetLow,
              duration: dur * 0.8,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        );
        return Animated.sequence([Animated.delay(i * 18), loop]);
      });

      const all = Animated.parallel(anims);
      all.start();
      return () => {
        all.stop();
        barAnims.forEach((b) => b.setValue(0.15));
      };
    } else {
      Animated.parallel(
        barAnims.map((b) =>
          Animated.timing(b, {
            toValue: 0.12,
            duration: 400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ),
      ).start();
    }
  }, [phase, barAnims]);

  // ── Navigate to Result ────────────────────────────────────────────────────
  useEffect(() => {
    if (state.status === "done" && state.result) {
      const result = state.result;
      reset();
      setPhase("ready");
      setElapsed(0);
      // A successful generation is what spends a free credit, server-side, so re-read
      // the count now — otherwise the pill still claims the old number when the user
      // comes back from Result. Not awaited: navigation must not wait on billing.
      refresh();
      // Practised today, so today's reminder has nothing to nag about. Fire-and-forget.
      void markPractisedToday();
      nav.navigate("Result", { result });
    }
  }, [state.status, state.result, nav, reset, refresh]);

  /**
   * Explains an exhausted trial and offers the way out.
   *
   * Shown instead of dropping the user on the paywall unannounced, which was the whole
   * of the old behaviour and read as the app refusing to record for no stated reason.
   */
  const showTrialExhausted = useCallback(() => {
    showDialog({
      title: "Free trial used up",
      message:
        `You've used all ${trialTotal} free transcriptions. Upgrade to Pro for unlimited ` +
        `transcriptions — everything you've already transcribed stays in your library.`,
      icon: "sparkles",
      tone: "premium",
      actions: [
        {
          label: "See Pro plans",
          icon: "arrow-forward",
          onPress: () => nav.navigate("Upgrade"),
        },
        { label: "Not now", style: "cancel" },
      ],
    });
  }, [trialTotal, nav]);

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

    // The server refusing on quota means the local gate let the tap through — a stale
    // count, or the last credit spent on another device. Same dialog, and the job state
    // is cleared so the error card's "Try again" doesn't offer a retry that cannot
    // possibly succeed.
    if (state.errorCode === FREE_TIER_LIMIT_CODE) {
      reset();
      showTrialExhausted();
    }
  }, [state.status, state.errorCode, reset, showTrialExhausted]);

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
  // depending on it would re-run this effect on each one.
  useEffect(() => {
    if (phase === "recording" && elapsed >= MAX_RECORD_SEC) void stopAndSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, elapsed]);

  // ── Voice-level metering & "sing louder" guidance ─────────────────────────
  //
  // recorderState.metering is only meaningful while phase === "recording";
  // expo-audio reports a stale/undefined value otherwise. The meter bar
  // animates smoothly toward each new reading rather than snapping, and the
  // guidance banner only appears after QUIET_GUIDANCE_DELAY_MS of sustained
  // quiet — not on every brief dip — so pauses for breath don't trigger it.
  useEffect(() => {
    if (phase !== "recording") {
      quietSinceRef.current = null;
      if (showQuietGuidance) setShowQuietGuidance(false);
      Animated.timing(meterAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
      return;
    }

    const dbfs = recorderState.metering ?? LEVEL_SILENCE_DBFS;

    Animated.timing(meterAnim, {
      toValue: meteringToFraction(dbfs),
      duration: 150,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();

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
  }, [phase, recorderState.metering, meterAnim, showQuietGuidance]);

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
    setPermError(null);
    if (blockedByTrialLimit()) return;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setPermError(
          "Microphone permission is required to listen and transcribe.",
        );
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
      tick.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch {
      setPermError("Could not start recording. Please try again.");
    }
  }

  /**
   * Whether the audio is a song with instruments (true: vocal isolated first) or a hummed tune;
   * null when the sheet was dismissed. The remembered answer — a song, until someone says otherwise
   * — is listed first and marked, and whatever is chosen is remembered for next time. A recording
   * cannot be cancelled: the take is already made, so it offers only the two answers.
   */
  function askIfSong(cancelable: boolean): Promise<boolean | null> {
    const remembered = importKind();
    let resolve: (v: boolean | null) => void = () => undefined;
    const done = new Promise<boolean | null>((r) => {
      resolve = r;
    });
    const choose = (kind: "song" | "voice") => {
      void setImportKind(kind);
      resolve(kind === "song");
    };
    const song = { text: `A song with instruments${remembered === "song" ? " (last time)" : ""}`, onPress: () => choose("song") };
    const voice = { text: `A tune I hummed or sang${remembered === "voice" ? " (last time)" : ""}`, onPress: () => choose("voice") };
    Alert.alert(
      "What is this recording?",
      "A song with instruments has its lead vocal isolated first, so the notes and the beat come from the voice, not the band." +
        (isPro && typeof subscription?.songCreditsRemaining === "number"
          ? ` It uses 1 of your ${subscription.songCreditsRemaining} songs left this month; a hummed tune costs nothing.`
          : ""),
      [
        ...(remembered === "song" ? [song, voice] : [voice, song]),
        ...(cancelable ? [{ text: "Cancel", style: "cancel" as const, onPress: () => resolve(null) }] : []),
      ],
      { cancelable, onDismiss: () => resolve(cancelable ? null : remembered === "song") },
    );
    return done;
  }

  async function pickAudioFile() {
    setPermError(null);
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
      // A file from the phone's library is as likely to be a song with a band behind the
      // voice as a hummed line, and the two need different treatment: a song's lead vocal
      // is isolated first and its beat read from the full mix, or the mixture comes back as
      // a scatter of wrong notes. Scores and MIDI files have nothing to isolate.
      // Chords mode reads the instruments themselves, so nothing is isolated there either.
      const ext = (asset.name || "").split(".").pop()?.toLowerCase() ?? "";
      const isScore = ["mid", "midi", "xml", "musicxml", "mxl", "abc"].includes(ext);
      const separate = isScore || mode === "chords" ? false : await askIfSong(true);
      if (separate === null) return;
      setPhase("uploading");
      const keyOpt = selectedKey === "Auto" ? undefined : selectedKey;
      const opts = { mode, key: keyOpt, separate, keyboardTranspose: kbTranspose || undefined };
      lastSubmitArgs.current = { uri: asset.uri, name: asset.name || "imported-audio.m4a", opts }; const jobId = await start(asset.uri, asset.name || "imported-audio.m4a", opts);
      // Only once the job is really queued — a quota refusal has no completion
      // to notify about.
      if (jobId) void offerBackgroundAlerts();
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
      // A phone held up to a speaker records a song as surely as a file import does, and a song
      // transcribed whole comes back as a scatter of wrong notes — so the same question, with the
      // same remembered answer, and no cancel because the take is already made.
      const separate = mode === "chords" ? false : ((await askIfSong(false)) ?? false);
      const opts = { mode, key: keyOpt, separate, keyboardTranspose: kbTranspose || undefined };
      lastSubmitArgs.current = { uri, name: `clip-${elapsed}s.m4a`, opts }; const jobId = await start(uri, `clip-${elapsed}s.m4a`, opts);
      if (jobId) void offerBackgroundAlerts();
    } catch {
      setPhase("ready");
    }
  }

  const handleButtonPress = () => {
    if (phase === "ready") startRecording();
    else if (phase === "recording") stopAndSubmit();
  };

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(
    elapsed % 60,
  ).padStart(2, "0")}`;

  const isUploading = phase === "uploading";

  // The row of steps on the uploading card. A hummed tune skips the isolating step — unless
  // the worker says it is isolating anyway, in which case the step is shown rather than lost.
  const separating = lastSubmitArgs.current?.opts?.separate === true || state.stage === "separating";
  const uploadStages = separating ? UPLOAD_STAGES : UPLOAD_STAGES.filter((s) => s.key !== "separating");
  const uploadStageIndex = uploadStages.findIndex((s) => s.key === state.stage);

  return (
    // Scrolls only when it has to. `container` grows to fill the viewport, so at the default text
    // size the column still spreads with `space-between` exactly as it did before — the scroll is
    // what absorbs a large Font size or Display size setting instead of pushing the status text off
    // the bottom edge behind the tab bar.
    <Screen edges={["top"]} scroll contentStyle={styles.scrollContent}>
      <View style={styles.container}>
        {/* ── Top controls ────────────────────────────────────────────────── */}
        <View style={styles.top}>
          <Text style={styles.screenTitle} maxFontSizeMultiplier={MAX_TEXT_SCALE_DISPLAY}>
            Listening
          </Text>

          {/* Free-tier counter. Gated on `known` as well as `!isPro`: the fallback
              value is the full allowance, so an unanswered billing request would
              otherwise announce "5 of 5 left" to a Pro account. Tappable throughout —
              wanting to see the plans is not only an out-of-credits impulse. */}
          {known && !isPro && (
            <Touchable
              onPress={() => nav.navigate("Upgrade")}
              style={[styles.trialPill, trialRemaining <= 0 && styles.trialPillSpent]}
              radius={radii.pill}
              accessibilityLabel="See Pro plans"
            >
              <Ionicons
                name={trialRemaining > 0 ? "sparkles-outline" : "lock-closed-outline"}
                size={13}
                color={trialRemaining > 0 ? colors.accent : colors.danger}
              />
              <Text
                style={[
                  styles.trialPillText,
                  trialRemaining <= 0 && styles.trialPillTextSpent,
                ]}
              >
                {trialRemaining > 0
                  ? `${trialRemaining} of ${trialTotal} free transcriptions left`
                  : "Free trial used up — see Pro plans"}
              </Text>
            </Touchable>
          )}

          {/* Mode toggle */}
          <View style={styles.modeToggle}>
            {(["melody", "poly", "choir", "chords"] as Mode[]).map((m) => {
              const active = mode === m;
              return active ? (
                <LinearGradient
                  key={m}
                  colors={gradients.brand}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.modeSegment, styles.modeSegmentActive]}
                >
                  <Text style={styles.modeTextActive}>
                    {MODE_LABEL[m]}
                  </Text>
                </LinearGradient>
              ) : (
                <Touchable
                  key={m}
                  style={styles.modeSegment}
                  onPress={() => setMode(m)}
                  // Both pickers are locked once recording starts. Passing `disabled`
                  // rather than gating inside onPress is what stops a locked segment
                  // springing and buzzing at a tap that does nothing — and it fades to
                  // the same 0.4 every other disabled control in the app uses, so the
                  // lock is finally visible.
                  disabled={phase !== "ready"}
                  radius={radii.pill}
                  accessibilityLabel={`${MODE_LABEL[m]} mode`}
                >
                  <Text style={styles.modeTextInactive}>
                    {MODE_LABEL[m]}
                  </Text>
                </Touchable>
              );
            })}
          </View>

          {mode === "chords" ? (
            <Text style={styles.modeHint}>
              Chords (piano, guitar): the chords played are read and written over the solfa.
            </Text>
          ) : null}

          {/* Keyboard transpose — the setting on the player's keyboard, so the sheet reads as the
              music sounded, not as the shapes were played. Shown for chords, and whenever it is set,
              because it rides along with every submit. */}
          {mode === "chords" || kbTranspose !== 0 ? (
            <View style={styles.keyRow}>
              <Text style={styles.keyLabel}>Keyboard transpose{kbTranspose !== 0 ? ` · ${keyboardTransposeLabel(kbTranspose)}` : ""}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.keyScroll}
              >
                {KEYBOARD_TRANSPOSE_CHOICES.map((t) => {
                  const active = kbTranspose === t;
                  const label = keyboardTransposeLabel(t);
                  return active ? (
                    <LinearGradient
                      key={t}
                      colors={gradients.brand}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[styles.keyChip, styles.keyChipActive]}
                    >
                      <Text style={styles.keyChipTextActive}>{label}</Text>
                    </LinearGradient>
                  ) : (
                    <Touchable
                      key={t}
                      style={styles.keyChip}
                      onPress={() => {
                        setKbTranspose(t);
                        void setKeyboardTranspose(t);
                      }}
                      disabled={phase !== "ready"}
                      radius={radii.pill}
                      accessibilityLabel={`Keyboard transpose ${label}`}
                    >
                      <Text style={styles.keyChipText}>{label}</Text>
                    </Touchable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {/* Key picker */}
          <View style={styles.keyRow}>
            <Text style={styles.keyLabel}>Key Signature</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.keyScroll}
            >
              {KEYS.map((k) => {
                const active = selectedKey === k;
                return active ? (
                  <LinearGradient
                    key={k}
                    colors={gradients.brand}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.keyChip, styles.keyChipActive]}
                  >
                    <Text style={styles.keyChipTextActive}>{k}</Text>
                  </LinearGradient>
                ) : (
                  <Touchable
                    key={k}
                    style={styles.keyChip}
                    onPress={() => setSelectedKey(k)}
                    disabled={phase !== "ready"}
                    radius={radii.pill}
                    accessibilityLabel={`Key: ${k}`}
                  >
                    <Text style={styles.keyChipText}>{k}</Text>
                  </Touchable>
                );
              })}
            </ScrollView>
          </View>
        </View>

        {/* ── Central record zone ─────────────────────────────────────────── */}
        <View style={styles.centerZone}>
          {/* Ambient glow orb */}
          <Animated.View
            style={[styles.ambientOrb, { opacity: ambientGlow }]}
          />

          {/* Ripple 2 — outermost */}
          <Animated.View
            style={[
              styles.rippleRing,
              styles.rippleOuter,
              { opacity: rippleOpacity2, transform: [{ scale: ripple2 }] },
            ]}
          />

          {/* "Sing louder / move closer" guidance banner — fades in after a
              sustained quiet stretch while recording. Positioned above the
              button so it doesn't obscure the record/stop control itself. */}
          <Animated.View
            style={[styles.guidanceBanner, { opacity: guidanceOpacity }]}
            pointerEvents="none"
          >
            <View style={styles.guidanceDot} />
            <Text style={styles.guidanceText}>
              Sing louder or hold closer to the mic
            </Text>
          </Animated.View>

          {/* Ripple 1 — inner */}
          <Animated.View
            style={[
              styles.rippleRing,
              styles.rippleInner,
              { opacity: rippleOpacity1, transform: [{ scale: ripple1 }] },
            ]}
          />

          {/* Record button. Deliberately still a TouchableOpacity: it owns the
              ripple/glow system above, and a competing press-scale would fight it.
              It does take the heavier tick, on press-in — starting and stopping a
              recording is the most consequential tap on the screen. */}
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={isUploading ? undefined : handleButtonPress}
            onPressIn={() => haptics.play("medium")}
            disabled={isUploading}
            style={styles.btnOuter}
          >
            <LinearGradient
              colors={
                phase === "recording"
                  ? (["#DC2626", "#B91C1C"] as const)
                  : isUploading
                    ? gradients.brandMuted
                    : gradients.brand
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.btnRing}
            >
              <View style={styles.btnGlassDisc}>
                {isUploading ? (
                  <View style={styles.btnIconWrap}>
                    <Text
                      style={styles.progressPct}
                      maxFontSizeMultiplier={MAX_TEXT_SCALE_IN_DISC}
                    >
                      {Math.round(state.progress * 100)}%
                    </Text>
                    <Text
                      style={styles.progressLabel}
                      maxFontSizeMultiplier={MAX_TEXT_SCALE_IN_DISC}
                    >
                      {state.stage === "uploading" ? "uploading" : "analysing"}
                    </Text>
                  </View>
                ) : phase === "recording" ? (
                  <View style={styles.btnIconWrap}>
                    <View style={styles.stopSquare} />
                  </View>
                ) : (
                  <View style={styles.btnIconWrap}>
                    <Ionicons name="mic" size={44} color={colors.accent} />
                  </View>
                )}
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* Soundwave bars */}
          <View style={styles.waveContainer}>
            {barAnims.map((anim, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.waveBar,
                  {
                    transform: [{ scaleY: anim }],
                    // Literal rgba, not a palette token: the alpha is computed per
                    // bar so the ramp fades toward the outer edges, and a token
                    // carries a fixed one. The two hues are the brand gradient's
                    // own endpoints — deep blue out from the left, bright from the right.
                    backgroundColor:
                      i < WAVE_BARS / 2
                        ? `rgba(37, 99, 235, ${0.4 + (i / WAVE_BARS) * 0.6})`
                        : `rgba(59, 130, 246, ${0.4 + ((WAVE_BARS - i) / WAVE_BARS) * 0.6})`,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        {/* ── Voice-level meter ────────────────────────────────────────────── */}
        {/* Only shown while recording — a live traffic-light bar (red → amber →
            green) so users get instant, glanceable feedback on mic level
            without needing to read the guidance banner text. */}
        {phase === "recording" && (
          <View style={styles.meterArea}>
            <Ionicons
              name={
                currentMeterDbfs < LEVEL_QUIET_DBFS
                  ? "mic-off-outline"
                  : "mic-outline"
              }
              size={14}
              color={meterColor}
              style={styles.meterIcon}
            />
            <View style={styles.meterTrack}>
              <Animated.View
                style={[
                  styles.meterFill,
                  {
                    backgroundColor: meterColor,
                    width: meterAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["0%", "100%"],
                    }),
                  },
                ]}
              />
            </View>
          </View>
        )}

        {/* ── Status area ─────────────────────────────────────────────────── */}
        <View style={styles.statusArea}>
          {isUploading ? (
            /* The uploading card: the mark, the step the job is on, a real percentage — the
               upload's own until the server answers, the worker's after — and the steps still
               to come. Once the server has the job it finishes it whether or not anyone is
               watching, and sends a notification when it does; the upload itself is the part
               that has to stay in the foreground. Nothing on this card is server text. */
            <Card style={styles.uploadCard}>
              <View style={styles.uploadHead}>
                <View style={styles.uploadOrb}>
                  <BrandMark size={28} color={colors.accent} />
                </View>
                <View style={styles.uploadHeadText}>
                  <Text style={styles.uploadTitle}>{stageLabel(state.stage, state.queuePosition)}</Text>
                  <Text style={styles.uploadSub}>
                    {state.stage === "uploading"
                      ? "Keep the app open until the upload finishes."
                      : "You can leave this screen — we'll notify you when it's ready."}
                  </Text>
                </View>
                <Text style={styles.uploadPct} maxFontSizeMultiplier={MAX_TEXT_SCALE_DISPLAY}>
                  {percentLabel(state.progress)}
                </Text>
              </View>

              <View style={styles.uploadStages}>
                {uploadStages.map((s, i) => {
                  const done = uploadStageIndex > i;
                  const on = uploadStageIndex === i;
                  return (
                    <View key={s.key} style={[styles.uploadStage, on && styles.uploadStageOn]}>
                      <Ionicons
                        name={done ? "checkmark-circle" : on ? "ellipse" : "ellipse-outline"}
                        size={12}
                        color={done ? colors.success : on ? colors.accent : colors.textFaint}
                      />
                      <Text
                        style={[
                          styles.uploadStageText,
                          on && styles.uploadStageTextOn,
                          done && styles.uploadStageTextDone,
                        ]}
                      >
                        {s.label}
                      </Text>
                    </View>
                  );
                })}
              </View>

              <View style={styles.progressTrack}>
                <LinearGradient
                  colors={gradients.brand}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.progressFill, { width: `${Math.max(3, Math.min(100, state.progress * 100))}%` }]}
                />
              </View>

              {state.stalled ? <Text style={styles.uploadWarn}>{STALLED_LINE}</Text> : null}
              {state.offline ? <Text style={styles.uploadWarn}>{OFFLINE_LINE}</Text> : null}
              {state.canRetry ? (
                <Button
                  label="Try again"
                  icon="refresh-outline"
                  variant="secondary"
                  onPress={() => void retry()}
                  style={{ marginTop: spacing.md }}
                />
              ) : null}
            </Card>
          ) : (
            <>
              <Text style={styles.statusTitle}>
                {phase === "ready" ? "Tap to record" : "Listening…"}
              </Text>

              <Text style={styles.timerText} maxFontSizeMultiplier={MAX_TEXT_SCALE_DISPLAY}>
                {mmss}
              </Text>

              <Text style={styles.statusSub}>
                {phase === "ready"
                  ? "Sing, hum, or play near the mic for accurate Solfa extraction."
                  : elapsed >= MAX_RECORD_SEC - RECORD_WARN_AT_SEC
                    ? `Stopping in ${MAX_RECORD_SEC - elapsed}s — ${MAX_RECORD_SEC / 60} minutes is the longest clip we can transcribe.`
                    : "Tap the button again when you're done."}
              </Text>
            </>
          )}

          {phase === "ready" && (
            <Touchable
              onPress={pickAudioFile}
              style={styles.importFileBtn}
              radius={radii.pill}
              accessibilityLabel="Import audio file"
            >
              <Ionicons name="folder-open-outline" size={18} color={colors.accent} />
              <Text style={styles.importFileBtnText}>Import audio file</Text>
            </Touchable>
          )}

        </View>

        {/* ── Bottom action ────────────────────────────────────────────────── */}
        {phase === "recording" && (
          <View style={styles.bottomAction}>
            <Button
              label="Stop & Transcribe"
              onPress={stopAndSubmit}
              icon="stop-circle-outline"
            />
          </View>
        )}

        {/* ── Error cards ──────────────────────────────────────────────────── */}
        {permError && (
          <Card style={styles.errCard}>
            <View style={styles.errRow}>
              <View style={styles.errDot} />
              <Text style={styles.errText}>{permError}</Text>
            </View>
          </Card>
        )}

        {state.error && (
          <Card style={styles.errCard}>
            <View style={styles.errRow}>
              <View style={styles.errDot} />
              <Text style={styles.errText}>{state.error}</Text>
            </View>
            <Button
              label="Retry Upload"
                variant="secondary"
                onPress={() => {
                  if (lastSubmitArgs.current) {
                    setPhase("uploading");
                    void start(lastSubmitArgs.current.uri, lastSubmitArgs.current.name, lastSubmitArgs.current.opts);
                  } else {
                    reset();
                    setPhase("ready");
                  }
                }}
                style={{ marginTop: spacing.md }}
            />
          </Card>
        )}
      </View>
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const BTN_SIZE = 148;
const DISC_SIZE = 116;
const METER_TRACK_WIDTH = 220;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  scrollContent: {
    // `flex: 1` does nothing to a ScrollView's content container; `flexGrow` is what makes the
    // column fill the viewport when the content is shorter than it.
    flexGrow: 1,
  },

  container: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 100,
  },

  // ── Top ──────────────────────────────────────────────────────────────────

  top: {
    width: "100%",
    alignItems: "center",
    paddingTop: spacing.sm,
    gap: spacing.md,
  },

  screenTitle: {
    ...typography.title,
    color: c.text,
    fontSize: 22,
    letterSpacing: -0.3,
  },

  // ── Free-tier counter ─────────────────────────────────────────────────────
  //
  // Under the title rather than beside the record button, so it reads as account
  // context and not as a warning about the recording in progress.

  trialPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    // "Free trial used up — see Pro plans" is wider than a narrow handset once the text setting is
    // turned up. RN defaults `flexShrink` to 0, so without this pair the row keeps its natural width
    // and simply runs off both edges rather than wrapping.
    maxWidth: "100%",
  },
  trialPillSpent: {
    backgroundColor: c.dangerSoft,
    borderColor: c.dangerBorder,
  },
  trialPillText: {
    fontSize: 11.5,
    fontFamily: fonts.semibold,
    color: c.accent,
    flexShrink: 1,
  },
  trialPillTextSpent: {
    color: c.danger,
  },

  // ── Mode toggle ───────────────────────────────────────────────────────────

  modeToggle: {
    flexDirection: "row",
    backgroundColor: c.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.border,
    padding: 3,
    maxWidth: "100%",
  },

  modeSegment: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    // "Polyphonic" is the long one; the two segments give up padding and wrap their label rather
    // than pushing the whole toggle past the screen edge.
    flexShrink: 1,
  },

  modeSegmentActive: {
    overflow: "hidden",
    shadowColor: c.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },

  modeTextActive: {
    ...typography.label,
    color: "#FFFFFF", // sits on the brand gradient — blue in both modes
    fontSize: 12,
    fontFamily: fonts.bold,
    flexShrink: 1,
  },

  modeTextInactive: {
    ...typography.label,
    color: c.textFaint,
    fontSize: 12,
    flexShrink: 1,
  },

  /** One line under the toggle saying what the chosen mode listens for. */
  modeHint: {
    ...typography.caption,
    color: c.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },

  // ── Key picker ────────────────────────────────────────────────────────────

  keyRow: {
    width: "100%",
  },

  keyLabel: {
    ...typography.caption,
    color: c.textFaint,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
  },

  keyScroll: {
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },

  keyChip: {
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
  },

  keyChipActive: {
    overflow: "hidden",
    borderWidth: 0,
    shadowColor: c.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },

  keyChipText: {
    ...typography.caption,
    color: c.textMuted,
    fontSize: 12,
  },

  keyChipTextActive: {
    ...typography.caption,
    color: "#FFFFFF", // sits on the brand gradient
    fontSize: 12,
    fontFamily: fonts.bold,
  },

  // ── Centre zone ───────────────────────────────────────────────────────────

  centerZone: {
    alignItems: "center",
    justifyContent: "center",
    width: 280,
    height: 280,
  },

  ambientOrb: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: c.accentGlow,
  },

  // ── Voice-level guidance banner ───────────────────────────────────────────

  guidanceBanner: {
    position: "absolute",
    top: -8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.dangerSoft,
    borderWidth: 1,
    borderColor: c.dangerBorder,
    borderRadius: radii.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    zIndex: 10,
    // Resolves against the 280px centre zone, which is itself inside the screen padding — so this is
    // what keeps the banner on screen. Absolutely positioned and unclipped, it otherwise grows past
    // both edges, and it is the one element that must stay clear of the record button beneath it.
    maxWidth: "100%",
  },

  guidanceDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: c.danger,
    marginRight: spacing.sm,
    shadowColor: c.danger,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 5,
    elevation: 3,
  },

  guidanceText: {
    ...typography.caption,
    color: c.danger,
    fontSize: 12,
    fontFamily: fonts.bold,
    flexShrink: 1,
  },

  // ── Voice-level meter bar ──────────────────────────────────────────────────

  meterArea: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: -spacing.sm,
    marginBottom: spacing.xs,
  },

  meterIcon: {
    marginRight: spacing.sm,
  },

  meterTrack: {
    width: METER_TRACK_WIDTH,
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: c.surfaceAlt,
    overflow: "hidden",
  },

  meterFill: {
    height: "100%",
    borderRadius: radii.pill,
  },

  rippleRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 1.5,
  },

  /** Two rings at different strengths, so the outer one reads as the fainter,
   *  further-travelled wave. Literal rgba because each needs its own alpha pair
   *  and no palette token carries four of them; the hue is the brand blue. */
  rippleInner: {
    width: 176,
    height: 176,
    borderColor: "rgba(37, 99, 235, 0.7)",
    backgroundColor: "rgba(37, 99, 235, 0.06)",
  },

  rippleOuter: {
    width: 232,
    height: 232,
    borderColor: "rgba(37, 99, 235, 0.45)",
    backgroundColor: "rgba(37, 99, 235, 0.03)",
  },

  // ── Record button ─────────────────────────────────────────────────────────

  btnOuter: {
    shadowColor: c.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 28,
    elevation: 14,
    borderRadius: BTN_SIZE / 2,
  },

  btnRing: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },

  /** The disc inside the gradient ring — surface-coloured so it reads as a
   *  raised face rather than punching a white hole in the dark canvas. */
  btnGlassDisc: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: DISC_SIZE / 2,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },

  btnIconWrap: {
    alignItems: "center",
    justifyContent: "center",
  },

  stopSquare: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: c.danger,
    shadowColor: c.danger,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 12,
    elevation: 6,
  },

  progressPct: {
    fontSize: 26,
    fontFamily: fonts.bold,
    color: c.accent,
    letterSpacing: -0.5,
  },

  progressLabel: {
    ...typography.caption,
    color: c.textFaint,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 2,
  },

  // ── Soundwave ─────────────────────────────────────────────────────────────

  waveContainer: {
    position: "absolute",
    bottom: -50,
    flexDirection: "row",
    alignItems: "center",
    height: 40,
    gap: 2.5,
  },

  waveBar: {
    width: 3,
    height: 36,
    borderRadius: radii.pill,
  },

  // ── Status ────────────────────────────────────────────────────────────────

  statusArea: {
    alignItems: "center",
    width: "100%",
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xxxl + spacing.xl,
  },

  statusTitle: {
    ...typography.heading,
    color: c.text,
    fontSize: 18,
    marginBottom: spacing.xs,
  },

  timerText: {
    fontSize: 42,
    fontFamily: fonts.bold,
    color: c.text,
    letterSpacing: -1,
    textShadowColor: c.accentGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
    fontVariant: ["tabular-nums"],
    marginVertical: spacing.xs,
  },

  statusSub: {
    ...typography.body,
    color: c.textMuted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },

  // ── Uploading card ────────────────────────────────────────────────────────

  uploadCard: {
    width: "100%",
  },

  uploadHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },

  /** The mark on a soft disc, standing in for the record button's glow while it is busy. */
  uploadOrb: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },

  uploadHeadText: {
    flex: 1,
  },

  uploadTitle: {
    ...typography.heading,
    color: c.text,
    fontSize: 16,
  },

  uploadSub: {
    ...typography.caption,
    color: c.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },

  uploadPct: {
    fontSize: 22,
    fontFamily: fonts.bold,
    color: c.accent,
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },

  uploadStages: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.md,
  },

  uploadStage: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    backgroundColor: c.surfaceAlt,
  },

  uploadStageOn: {
    backgroundColor: c.accentSoft,
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
    color: c.success,
  },

  uploadWarn: {
    ...typography.caption,
    color: c.warning,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.sm,
  },

  progressTrack: {
    width: "100%",
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: c.surfaceAlt,
    marginTop: spacing.md,
    overflow: "hidden",
  },

  progressFill: {
    height: "100%",
    borderRadius: radii.pill,
  },

  importFileBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
    alignSelf: "center",
  },
  importFileBtnText: {
    fontSize: 14,
    fontFamily: fonts.semibold,
    color: c.accent,
  },

  // ── Bottom action ─────────────────────────────────────────────────────────

  bottomAction: {
    width: "100%",
    paddingHorizontal: spacing.xl,
  },

  // ── Error card ────────────────────────────────────────────────────────────

  errCard: {
    width: "100%",
    marginTop: spacing.sm,
    backgroundColor: c.dangerSoft,
    borderColor: c.dangerBorder,
  },

  errRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },

  errDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.danger,
    marginRight: spacing.sm,
    marginTop: 3,
    shadowColor: c.danger,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 3,
  },

  errText: {
    ...typography.body,
    color: c.danger,
    fontSize: 13,
    flex: 1,
    lineHeight: 20,
  },
});
