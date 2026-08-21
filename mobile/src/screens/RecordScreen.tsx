import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
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
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { showDialog } from "../lib/dialog";
import { useJobPolling } from "../lib/useJobPolling";
import { useSubscription } from "../lib/subscription";
import {
  fonts,
  gradients,
  radii,
  spacing,
  typography,
  type Palette,
} from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { RootStackParams } from "../navigation/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "melody" | "poly";
type Phase = "ready" | "recording" | "uploading";

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
  const { state, start, reset } = useJobPolling();
  const { isPro, known, trialRemaining, trialTotal, refresh } = useSubscription();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [phase, setPhase] = useState<Phase>("ready");
  const [mode, setMode] = useState<Mode>("melody");
  const [selectedKey, setSelectedKey] = useState<string>("Auto");
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

      // Pre-warm the transcriber dyno (Heroku Eco dynos sleep after inactivity).
      // Fire-and-forget: this runs during recording so the dyno is ready by the
      // time the audio file is submitted. Errors are intentionally swallowed.
      fetch("https://notefusion-transcriber-ef80c63d506f.herokuapp.com/docs", {
        method: "GET",
      }).catch(() => undefined);
    } catch {
      setPermError("Could not start recording. Please try again.");
    }
  }

  async function pickAudioFile() {
    setPermError(null);
    // Importing a file costs a generation exactly like recording one, and this path
    // had no gate at all — the trial was only enforced on the microphone.
    if (blockedByTrialLimit()) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["audio/*", "audio/mpeg", "audio/wav", "audio/x-m4a", "audio/mp4", "audio/aac"],
        copyToCacheDirectory: true,
      });

      if (res.canceled || !res.assets || res.assets.length === 0) {
        return;
      }

      const asset = res.assets[0];
      setPhase("uploading");
      const keyOpt = selectedKey === "Auto" ? undefined : selectedKey;
      await start(asset.uri, asset.name || "imported-audio.m4a", {
        mode,
        key: keyOpt,
      });
    } catch {
      setPhase("ready");
      setPermError("Could not import audio file. Please try again.");
    }
  }


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
      await start(uri, `clip-${elapsed}s.m4a`, { mode, key: keyOpt });
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

  return (
    <Screen edges={["top"]}>
      <View style={styles.container}>
        {/* ── Top controls ────────────────────────────────────────────────── */}
        <View style={styles.top}>
          <Text style={styles.screenTitle}>Listening</Text>

          {/* Free-tier counter. Gated on `known` as well as `!isPro`: the fallback
              value is the full allowance, so an unanswered billing request would
              otherwise announce "5 of 5 left" to a Pro account. Tappable throughout —
              wanting to see the plans is not only an out-of-credits impulse. */}
          {known && !isPro && (
            <TouchableOpacity
              onPress={() => nav.navigate("Upgrade")}
              style={[styles.trialPill, trialRemaining <= 0 && styles.trialPillSpent]}
              activeOpacity={0.8}
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
            </TouchableOpacity>
          )}

          {/* Mode toggle */}
          <View style={styles.modeToggle}>
            {(["melody", "poly"] as Mode[]).map((m) => {
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
                    {m === "melody" ? "Melody" : "Polyphonic"}
                  </Text>
                </LinearGradient>
              ) : (
                <TouchableOpacity
                  key={m}
                  style={styles.modeSegment}
                  onPress={() => phase === "ready" && setMode(m)}
                  disabled={phase !== "ready"}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modeTextInactive}>
                    {m === "melody" ? "Melody" : "Polyphonic"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

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
                  <TouchableOpacity
                    key={k}
                    style={styles.keyChip}
                    onPress={() => phase === "ready" && setSelectedKey(k)}
                    disabled={phase !== "ready"}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.keyChipText}>{k}</Text>
                  </TouchableOpacity>
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

          {/* Record button */}
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={isUploading ? undefined : handleButtonPress}
            disabled={isUploading}
            style={styles.btnOuter}
          >
            <LinearGradient
              colors={
                phase === "recording"
                  ? (["#DC2626", "#B91C1C"] as const)
                  : isUploading
                    ? ([
                        "rgba(37,99,235,0.4)",
                        "rgba(59,130,246,0.4)",
                      ] as const)
                    : gradients.brand
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.btnRing}
            >
              <View style={styles.btnGlassDisc}>
                {isUploading ? (
                  <View style={styles.btnIconWrap}>
                    <Text style={styles.progressPct}>
                      {Math.round(state.progress * 100)}%
                    </Text>
                    <Text style={styles.progressLabel}>analysing</Text>
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
          <Text style={styles.statusTitle}>
            {phase === "ready" && "Tap to record"}
            {phase === "recording" && "Listening…"}
            {isUploading &&
              (state.status === "processing"
                ? "Transcribing Solfa & Staff…"
                : "Processing audio…")}
          </Text>

          <Text style={styles.timerText}>
            {isUploading ? `${Math.round(state.progress * 100)}%` : mmss}
          </Text>

          <Text style={styles.statusSub}>
            {phase === "ready" &&
              "Sing, hum, or play near the mic for accurate Solfa extraction."}
            {phase === "recording" && "Tap the button again when you're done."}
            {isUploading && "Analysing pitch frequencies and key profile…"}
          </Text>

          {phase === "ready" && (
            <TouchableOpacity
              onPress={pickAudioFile}
              style={styles.importFileBtn}
              activeOpacity={0.8}
            >
              <Ionicons name="folder-open-outline" size={18} color={colors.accent} />
              <Text style={styles.importFileBtnText}>Import audio file</Text>
            </TouchableOpacity>
          )}

          {isUploading && (
            <View style={styles.progressTrack}>
              <LinearGradient
                colors={gradients.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[
                  styles.progressFill,
                  { width: `${Math.max(5, state.progress * 100)}%` },
                ]}
              />
            </View>
          )}
        </View>

        {/* ── Bottom action ────────────────────────────────────────────────── */}
        {(phase === "recording" || isUploading) && (
          <View style={styles.bottomAction}>
            {phase === "recording" && (
              <Button
                label="Stop & Transcribe"
                onPress={stopAndSubmit}
                icon="stop-circle-outline"
              />
            )}
            {isUploading && (
              <Button
                label="Processing…"
                variant="secondary"
                disabled
                loading
              />
            )}
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
              label="Try again"
              variant="secondary"
              onPress={() => {
                reset();
                setPhase("ready");
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
  container: {
    flex: 1,
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
  },
  trialPillSpent: {
    backgroundColor: "rgba(220, 38, 38, 0.10)",
    borderColor: "rgba(220, 38, 38, 0.28)",
  },
  trialPillText: {
    fontSize: 11.5,
    fontFamily: fonts.semibold,
    color: c.accent,
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
  },

  modeSegment: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
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
  },

  modeTextInactive: {
    ...typography.label,
    color: c.textFaint,
    fontSize: 12,
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

  /** The wash stays a fixed rgba rather than the palette's danger hue so it
   *  reads as a tint over both canvases; the dot and label use c.danger. */
  guidanceBanner: {
    position: "absolute",
    top: -8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(220, 38, 38, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(220, 38, 38, 0.35)",
    borderRadius: radii.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    zIndex: 10,
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
    textShadowColor: "rgba(37, 99, 235, 0.55)",
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

  progressTrack: {
    width: "80%",
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: c.surfaceAlt,
    marginTop: spacing.lg,
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
    backgroundColor: "rgba(220, 38, 38, 0.08)",
    borderColor: "rgba(220, 38, 38, 0.22)",
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
