/**
 * PracticeScreen — the daily habit: the practice path's next free solfa drill (hear it, a count-in, sing it, marked
 * note by note, then on to the next — grades, units and milestones on the way), the streak, XP toward the next sol-fa
 * level, the weekly goal, the last seven days and the badges.
 *
 * Every number here is the server's (`GET /api/practice/progress`), read off the takes it has marked; the
 * phone never reports a score. A marked take comes back with what it earned, which is celebrated with one
 * line and a tap — and without motion when the system asks for reduced motion.
 *
 * Two tracks, chosen by style (never by age) on the first visit and changeable any time (`lib/practiceTrack`):
 * Playful — stars and a friendly word instead of the number, a practice buddy, stickers, a confetti burst; and
 * Focused — the exact score and cents, the take's overall tuning, "Replay my take", and less fuss. The server picks
 * each track's drills; XP, levels, streaks and badges are the same on both.
 *
 * Board s-practice-fun/s1 (after c-practice/6a): the path card stays the hero, with the streak, level and week one line
 * above it that opens "Your progress" (`PracticeProgress`: the stat cards, the week and the badges, which used to make
 * this tab a long scroll); then "Quick games" (`PracticeGame`: tapped, not sung) and "More ways to practise" (Playful:
 * "More ways to play") — the modes the server says are live (`progress.modes`), each pushing `PracticeMode`. One Doh on
 * screen: Playful's buddy at the top (the track pill takes an icon), Focused's one small Doh beside the modes.
 *
 * A tab (board a-core/04), reached from the tab bar, Home's streak chip and every practice reminder. A tab stays
 * mounted, so leaving it mid-take stops the take, as leaving the old pushed screen did.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Linking, Platform, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Icon } from "../components/Icon";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "react-native-reanimated";
import { SvgXml } from "react-native-svg";
import { File, Paths } from "expo-file-system";
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
} from "expo-audio";
import { PRACTICE_PROFILE } from "../lib/recordingPreset";

import { Screen } from "../components/Screen";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Skeleton } from "../components/Skeleton";
import { Touchable } from "../components/Touchable";
import { TabHeader } from "../components/TabHeader";
import { GradeMarks } from "../components/GradeMarks";
import { TrackPicker } from "../components/practice/TrackPicker";
import { StarGrade } from "../components/practice/StarGrade";
import { Confetti } from "../components/practice/Confetti";
import { Art } from "../components/practice/Art";
import type { ArtName } from "../components/practice/art/svgs";
import { practiceApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import type { AxiosError } from "axios";
import { classifySendFailure } from "../lib/sendQueue";
import type { Drill, GradeResult, PracticeProgress, PracticeSeason, PracticeTrack } from "../api/types";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { leadInFor, noteDueAt, partSeconds } from "../lib/take";
import { synthesizeMelodyWavBase64 } from "../lib/synth";
import { logAnalyticsEvent } from "../lib/analytics";
import { acknowledgeGrade } from "../lib/practiceReward";
import { rememberStreak } from "../lib/practiceReminder";
import {
  allowanceLine,
  nextAction,
  pathLine,
  unitBarFraction,
  unitLine,
  streakSnapshot,
} from "../lib/practiceProgress";
import {
  celebrationFor,
  flameArt,
  gradeAnnouncement,
  levelArt,
  mascotArt,
  mascotLine,
  mascotMood,
  playfulRewardLine,
  rewardArt,
  trackTitle,
  tuningLine,
} from "../lib/practiceTrack";
import { ProblemNote } from "../components/ProblemNote";
import { onlySettingsCanGrant } from "../lib/micPermission";
import { CostumedArt } from "../components/season/Costume";
import { ART } from "../components/practice/art/svgs";
import { useSeason } from "../lib/seasonStore";
import { activeSeason, costumeOf, seasonCard, seasonOf, seasonTint, seasonWords, type Costume } from "../lib/season";
import { ModeList } from "../components/practice/ModeList";
import { GameTiles } from "../components/practice/GameTiles";
import { MarkingBar } from "../components/practice/MarkingBar";
import { MARK_STEP_MS } from "../components/practice/useMarkReveal";
import { hubModes, modesDohLine, modesHeading, progressStrip } from "../lib/practiceModes";
import type { RootStackParams } from "../navigation/types";

type Phase = "idle" | "leadin" | "singing" | "grading";

/** A practice take: the voice at 32 kbps, a third of the upload for the same marks (lib/recordingPreset). */
const RECORDING = { ...RecordingPresets.HIGH_QUALITY, ...PRACTICE_PROFILE };
/** Recording runs on this long after the last note, so a held ending is not cut (the server keeps four). */
const TAIL_SEC = 1;
const TOAST_MS = 3200;
const MIC_REFUSED = "Microphone permission is needed to sing the drill.";
/** A take still not marked after this long: "Still marking — slow connection". */
const SLOW_MARK_MS = 8000;
const MARKING_LINE = { upload: "Listening back…", check: "Checking each note…", slow: "Still marking — slow connection" } as const;

export function PracticeScreen() {
  const colors = useColors();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const recorder = useAudioRecorder(RECORDING);

  const [progress, setProgress] = useState<PracticeProgress | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  /** The path's drill after a marked take, fetched with the fresh progress: what "Continue" opens. */
  const [next, setNext] = useState<Drill | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** The microphone was refused for good: only the phone's settings can turn it on now. */
  const [micBlocked, setMicBlocked] = useState(false);
  const [grade, setGrade] = useState<GradeResult | null>(null);
  /** While a take is marked (board s-practice-fun/s2): sending it, the server checking it, or a slow connection's wait. */
  const [marking, setMarking] = useState<"upload" | "check" | "slow">("upload");

  const [picking, setPicking] = useState(false);
  const [savingTrack, setSavingTrack] = useState<PracticeTrack | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [takeUri, setTakeUri] = useState<string | null>(null);
  /** A take sung but not marked (no connection, or our fault): kept, so "Send it again" marks it without singing again. */
  const [unsent, setUnsent] = useState<{ uri: string; drill: Drill; leadIn: number } | null>(null);

  /** The reward line, with the level's emblem or the badge's sticker beside it when it is one. */
  const [toast, setToast] = useState<{ line: string; art: ArtName | null } | null>(null);
  /** The marked take's reward line went up in the toast, so the marks do not say it a second time. */
  const [rewardToasted, setRewardToasted] = useState(false);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const leadIn = useRef(0);
  const player = useRef<AudioPlayer | null>(null);
  const audioFile = useRef<File | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopAt = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const live = useRef(true);
  /** Closed before `sing`'s first await: a second tap during the permission prompt would start a second take. */
  const startingRef = useRef(false);
  /** Which button is getting a take (or the next drill) ready: it shows a spinner until the mic is listening. */
  const [starting, setStarting] = useState<"main" | "again" | null>(null);

  // The drill on screen, read by `load`: a visit that brings a different drill clears the last one's marks.
  const drillRef = useRef<Drill | null>(null);
  drillRef.current = drill;

  const load = useCallback(async () => {
    try {
      const [p, d] = await Promise.all([practiceApi.progress(), practiceApi.nextDrill()]);
      if (!live.current) return;
      setProgress(p);
      if (drillRef.current?.id !== d.id) {
        setGrade(null);
        setNext(null);
        setTakeUri(null);
      }
      setDrill(d);
      setLoadError(null);
      void rememberStreak(streakSnapshot(p));
    } catch (e) {
      if (!live.current) return;
      const err = toApiError(e);
      setLoadError(err.message);
      setOffline(err.code.startsWith("NETWORK_"));
    } finally {
      if (live.current) setLoading(false);
    }
  }, []);

  // Read on every visit; leaving the tab (or the app's back to another tab) mid-take stops the take and any playback.
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        if (phaseRef.current === "leadin" || phaseRef.current === "singing") stop();
        else if (phaseRef.current === "idle") cleanup();
      };
      // `stop` and `cleanup` only touch refs and setters.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  useEffect(
    () => () => {
      live.current = false;
      cleanup();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function cleanup() {
    if (tick.current) clearInterval(tick.current);
    if (stopAt.current) clearTimeout(stopAt.current);
    tick.current = null;
    stopAt.current = null;
    try { player.current?.remove(); } catch { /* already released */ }
    player.current = null;
    try { if (audioFile.current?.exists) audioFile.current.delete(); } catch { /* already gone */ }
    audioFile.current = null;
  }

  function showToast(line: string, art: ArtName | null = null) {
    setToast({ line, art });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastAnim.setValue(reduceMotion ? 1 : 0);
    if (!reduceMotion) {
      Animated.timing(toastAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    }
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  /** Plays the drill once on the synth, at its tempo: what the singer is about to sing. */
  function hear() {
    if (!drill || phase !== "idle") return;
    cleanup();
    try {
      const file = new File(Paths.cache, `notefusion-drill-${Date.now()}.wav`);
      file.write(synthesizeMelodyWavBase64(drill.notes, drill.tempoBpm), { encoding: "base64" });
      audioFile.current = file;
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      player.current = createAudioPlayer({ uri: file.uri });
      player.current.play();
    } catch (e) {
      if (__DEV__) console.warn("[practice] hear failed", e);
      setError("Could not play the drill. Please try again.");
    }
  }

  /**
   * Saves the track, then loads the drill it offers (each track keeps its own place on the path). The picker closes at
   * once, with the drill card's stand-in until the track's drill is here; a refusal puts both back and reopens it.
   */
  async function chooseTrack(next: PracticeTrack) {
    if (phase !== "idle") return;
    const before = { progress, drill };
    setSavingTrack(next);
    setTrackError(null);
    setPicking(false);
    setProgress((p) => (p ? { ...p, track: next } : p));
    setNext(null);
    setGrade(null);
    setTakeUri(null);
    let saved: PracticeProgress | null = null;
    try {
      saved = await practiceApi.setTrack(next);
      const d = await practiceApi.nextDrill();
      if (!live.current) return;
      setProgress(saved);
      setDrill(d);
      void logAnalyticsEvent("practice_track_chosen", { track: next });
    } catch (e) {
      if (!live.current) return;
      if (saved) {
        // The track is saved, only its drill did not come: "No drill yet" offers to try again.
        setProgress(saved);
        setDrill(null);
        return;
      }
      setProgress(before.progress);
      setDrill(before.drill);
      setPicking(true);
      setTrackError(toApiError(e).message);
    } finally {
      if (live.current) setSavingTrack(null);
    }
  }

  /** Focused: plays the singer's own take back, from the recording just marked. */
  function replay() {
    if (!takeUri || phase !== "idle") return;
    cleanup();
    try {
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      player.current = createAudioPlayer({ uri: takeUri });
      player.current.play();
    } catch (e) {
      if (__DEV__) console.warn("[practice] replay failed", e);
      setError("Could not play your take back.");
    }
  }

  async function sing(from: "main" | "again" = "main") {
    if (!drill || phase !== "idle" || startingRef.current) return;
    startingRef.current = true;
    setStarting(from);
    cleanup();
    setError(null);
    setGrade(null);
    setTakeUri(null);
    setUnsent(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError(MIC_REFUSED);
        setMicBlocked(onlySettingsCanGrant(perm));
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldRouteThroughEarpiece: false });
      const lead = leadInFor(drill.notes, drill.tempoBpm, drill.timeSignature);
      leadIn.current = lead.seconds;
      const file = new File(Paths.cache, `notefusion-leadin-${Date.now()}.wav`);
      file.write(lead.wavBase64, { encoding: "base64" });
      audioFile.current = file;
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      player.current = createAudioPlayer({ uri: file.uri });
      player.current.play();
      setPhase("leadin");
      setElapsed(0);
      void logAnalyticsEvent("drill_started", { drill: drill.id, level: drill.level });
      tick.current = setInterval(() => {
        const t = (Date.now() - startedAt.current) / 1000;
        setElapsed(t);
        if (t >= leadIn.current) setPhase((p) => (p === "leadin" ? "singing" : p));
      }, 100);
      const total = Math.min(drill.maxTakeSeconds, lead.seconds + partSeconds(drill.notes, drill.tempoBpm) + TAIL_SEC);
      stopAt.current = setTimeout(() => void finish(drill), total * 1000);
    } catch (e) {
      cleanup();
      setPhase("idle");
      if (__DEV__) console.warn("[practice] start failed", e);
      setError("Could not start recording. Please try again.");
    } finally {
      startingRef.current = false;
      if (live.current) setStarting(null);
    }
  }

  async function finish(sung: Drill) {
    cleanup();
    setPhase("grading");
    let uri: string | null = null;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      uri = recorder.uri;
      if (!uri) throw new Error("The recording was lost.");
    } catch (e) {
      if (!live.current) return;
      setPhase("idle");
      setError(toApiError(e).message);
      return;
    }
    await mark(sung, uri, leadIn.current);
  }

  /** "Send it again": the kept take, marked as if it had just been sung. */
  function sendAgain() {
    if (!unsent || phase !== "idle") return;
    setError(null);
    void mark(unsent.drill, unsent.uri, unsent.leadIn);
  }

  /**
   * Sends a take to be marked and shows what it earned. A take that could not be marked for want of a connection,
   * or by our fault, is kept to send again; one the server turned down is not (sending it again would be too).
   */
  async function mark(sung: Drill, uri: string, lead: number) {
    setPhase("grading");
    setUnsent(null);
    setMarking("upload");
    // Past this the take is still on its way or being marked: the line says the connection is slow, not that it broke.
    const slow = setTimeout(() => { if (live.current) setMarking("slow"); }, SLOW_MARK_MS);
    try {
      const result = await practiceApi.gradeDrill(uri, sung.id, lead, () => {
        if (live.current) setMarking((m) => (m === "upload" ? "check" : m));
      });
      clearTimeout(slow);
      if (!live.current) return;
      setGrade(result);
      setTakeUri(uri);
      setPhase("idle");
      void logAnalyticsEvent("drill_completed", { drill: sung.id, score: result.score, xp: result.reward?.xpGained ?? 0 });
      const moment = acknowledgeGrade(result);
      const how = celebrationFor(sung.track, result.score, result.reward, !!result.milestone);
      // The confetti and the reward line wait for the marks to land and the score to count up (board s-practice-fun/s2).
      const landed = reduceMotion ? 0 : result.notes.length * MARK_STEP_MS + 700;
      // Each line once: a milestone is said by its card, and what the take earned by the toast, or else under the marks.
      const earned = sung.track === "playful" ? playfulRewardLine(result.reward) : moment?.line ?? null;
      const toasted = how !== "quiet" && !result.milestone && !!earned;
      setTimeout(() => {
        if (!live.current) return;
        if (how === "burst") setBurst((b) => b + 1);
        if (toasted && earned) showToast(earned, rewardArt(result.reward));
      }, landed);
      setRewardToasted(toasted);
      const line = result.milestone?.title ?? earned;
      // Android's live regions already read the toast and the milestone; iOS hears the line here.
      AccessibilityInfo.announceForAccessibility(
        gradeAnnouncement(sung.track === "playful", result, Platform.OS === "ios" ? line : null),
      );
      const [fresh, upcoming] = await Promise.all([
        practiceApi.progress().catch(() => null),
        practiceApi.nextDrill().catch(() => null),
      ]);
      if (!live.current) return;
      if (fresh) {
        setProgress(fresh);
        setDrill((d) => (d ? { ...d, allowance: fresh.drills } : d));
      }
      setNext(upcoming);
    } catch (e) {
      clearTimeout(slow);
      if (!live.current) return;
      setPhase("idle");
      const err = toApiError(e);
      setError(err.message);
      if (classifySendFailure(err.code, (e as AxiosError)?.response?.status) !== "refused") {
        setUnsent({ uri, drill: sung, leadIn: lead });
      }
    }
  }

  /** On along the path: the drill fetched after the take (or fetched now), its marks cleared. */
  async function goNext() {
    if (phase !== "idle" || startingRef.current) return;
    startingRef.current = true;
    if (!next) setStarting("main");
    cleanup();
    setError(null);
    try {
      const upcoming = next ?? (await practiceApi.nextDrill());
      if (!live.current) return;
      setDrill(upcoming);
      setNext(null);
      setGrade(null);
      setTakeUri(null);
    } catch (e) {
      if (live.current) setError(toApiError(e).message);
    } finally {
      startingRef.current = false;
      if (live.current) setStarting(null);
    }
  }

  function stop() {
    cleanup();
    void recorder.stop().catch(() => undefined);
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    setPhase("idle");
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const busy = phase !== "idle";
  const due = drill && phase === "singing" ? noteDueAt(drill.notes, drill.tempoBpm, leadIn.current, elapsed) : -1;
  const countdown = Math.max(0, Math.ceil(leadIn.current - elapsed));
  const allowance = progress?.drills ?? drill?.allowance ?? null;
  const left = allowance ? Math.max(0, allowance.limit - allowance.used) : null;
  const track = progress?.track ?? null;
  const playful = track === "playful";
  const focused = track === "focused";
  const showPicker = !!progress && (track == null || picking);
  const where = drill ? pathLine(drill) : null;
  const onward = drill && grade ? nextAction(drill, next, track) : null;
  /** Nothing left to mark today and nothing to move on to: the main button is the day's end. */
  const doneForToday = left === 0 && !(onward && !onward.same);
  /** The kept take, while its drill is the one on screen: the main button sends it again. */
  const resendable = !!unsent && !!drill && unsent.drill.id === drill.id && !grade;
  // Doh's mood and line (Playful only): singing along, cheering, encouraging, worried, sleepy or waving.
  const scene = { picking: showPicker, recording: busy, grade, hasDrill: !!drill, drillsLeft: left };
  const buddyMood = progress ? mascotMood(progress, scene) : "wave";
  const buddy = { mood: buddyMood, line: progress ? mascotLine(buddyMood, progress, scene) : "" };
  // More ways to practise: the live modes in the track's words (a phone has no live pitch meter: no needle promised).
  const modeRows = progress ? hubModes(progress.modes, track, false) : [];
  // The season's path, only while its season is on for the singer: one card under today's drill — the carols' pine
  // card (board d-christmas/03) or the Midnight path's pumpkin one (board j-halloween/03). Doh wears the season's
  // costume in Practice then (the cap, the witch hat), and there is still one Doh on screen. Christmas: on Focused
  // the card's, so the modes' steps aside, and on Playful the buddy's, so the card has none. Halloween: on Playful
  // the card's, with Boo beside him, so the buddy steps aside; Focused's card has neither Doh nor Boo.
  const seasonFlag = useSeason();
  const seasonPath = progress?.season ?? null;
  const pathSeason = seasonPath ? seasonOf(seasonPath.season) : null;
  const costume = costumeOf(pathSeason ?? activeSeason(seasonFlag));
  const cardDoh = !!seasonPath && !showPicker && (pathSeason === "halloween" ? playful : !playful);
  const dohLine = cardDoh ? null : modesDohLine(modeRows, track);
  const buddyShown = playful && !showPicker && !!drill && !(cardDoh && pathSeason === "halloween");

  return (
    <View style={styles.flex}>
      <Screen
        scroll
        contentStyle={styles.screen}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
      >
        <TabHeader title="Practice" eyebrow="Practice path">
          {track && !showPicker && !busy ? (
            <Touchable
              onPress={() => { setTrackError(null); setPicking(true); }}
              accessibilityRole="button"
              accessibilityLabel={`Practice style: ${trackTitle(track)}. Change it`}
              radius={radii.pill}
            >
              <View style={[styles.trackPill, playful && styles.trackPillPlayful]}>
                {/* One Doh on screen: Playful's is the buddy below, so the pill takes an icon. */}
                {playful ? <Icon name="playful" size={18} color={colors.play} /> : <Art name={levelArt(progress?.level.index ?? 0)} width={24} />}
                <Text style={styles.trackPillText}>{trackTitle(track)}</Text>
                <Icon name="switch" size={14} color={colors.textMuted} />
              </View>
            </Touchable>
          ) : null}
        </TabHeader>

        {loading && !progress ? (
          <PracticeSkeleton styles={styles} />
        ) : loadError && !progress ? (
          offline ? (
            <EmptyState
              art="empty-offline"
              title="You're offline"
              body="Practice needs a connection to mark your singing. Check it, then try again."
              onRetry={() => { setLoading(true); void load(); }}
              styles={styles}
            />
          ) : (
            <Card style={styles.card}>
              <Text style={styles.body}>{loadError}</Text>
              <Button label="Try again" icon="retry" variant="secondary" onPress={() => { setLoading(true); void load(); }} />
            </Card>
          )
        ) : progress ? (
          <>
            <ProgressLine
              progress={progress}
              styles={styles}
              colors={colors}
              onOpen={() => {
                if (busy) return;
                nav.navigate("PracticeProgress");
              }}
            />

            {showPicker ? (
              <TrackPicker
                current={track}
                saving={savingTrack}
                error={trackError}
                onPick={(t) => void chooseTrack(t)}
                onCancel={track ? () => setPicking(false) : undefined}
              />
            ) : null}

            {buddyShown ? (
              <View style={styles.buddy} accessible accessibilityLabel={`Doh, your practice buddy, says: ${buddy.line}`}>
                <CostumedArt name={mascotArt(buddy.mood)} width={68} costume={costume} />
                <View style={styles.buddyBubble}>
                  <Text style={styles.buddyText}>{buddy.line}</Text>
                </View>
              </View>
            ) : null}

            {/* ── Today's drill (its stand-in while a new track's drill comes) ── */}
            {savingTrack && !showPicker ? (
              <DrillSkeleton styles={styles} />
            ) : drill && !showPicker ? (
              <View>
                <Card style={playful ? { ...styles.card, ...styles.cardPlayful } : styles.card}>
                  {/* Ink, not blue: the eyebrow is a label, not a control (board n-ux-low Q2a c). Playful's is its orange. */}
                  <Text style={[styles.eyebrow, playful && styles.eyebrowPlayful]}>
                    {playful ? "Your singing game" : `Practice path · ${drill.levelName}`}
                  </Text>
                  {/* Above the section titles round it (18): the thing to sing reads first, a second line wraps. */}
                  <Text style={styles.drillTitle} accessibilityRole="header">
                    {drill.title}
                  </Text>
                  <Text style={styles.meta}>
                    {playful
                      ? `${drill.dohHeader} · ${drill.notes.length} notes`
                      : `${drill.dohHeader} · ${drill.key} · ${drill.tempoBpm} BPM${focused ? ` · ${drill.notes.length} notes` : ""}`}
                  </Text>

                  <View style={styles.solfaRow} accessible accessibilityLabel={`Sing: ${drill.notes.map((n) => n.solfa + n.octaveMark).join(" ")}`}>
                    {drill.notes.map((n, i) => (
                      <View key={i} style={[styles.solfaChip, playful && styles.solfaChipPlayful, due === i && styles.solfaChipOn]}>
                        <Text style={[styles.solfa, playful && styles.solfaPlayful, due === i && styles.solfaOn]}>{n.solfa}{n.octaveMark}</Text>
                      </View>
                    ))}
                  </View>

                  {/* The unit bar by the buttons (board n-ux-low Q2a a): a tenth in at a unit's first drill, 6 px, in ink on
                      a stronger track, with the unit and drill beside it; the grade stays in the eyebrow (Playful's eyebrow
                      has none, so its line keeps it). */}
                  {where ? (
                    <View style={styles.unitRow} accessible accessibilityLabel={where}>
                      <View style={styles.unitBar}>
                        <View style={[styles.unitBarFill, { width: `${Math.round(unitBarFraction(drill) * 100)}%` }]} />
                      </View>
                      <Text style={styles.unitLabel}>{playful ? where : unitLine(drill) ?? where}</Text>
                    </View>
                  ) : null}

                  {phase === "leadin" || phase === "singing" ? (
                    <View style={styles.live}>
                      <Text style={styles.liveLabel}>{phase === "leadin" ? `Starting note… sing in ${countdown}` : "Sing!"}</Text>
                      <Button label="Stop" variant="secondary" icon="stop" onPress={stop} />
                    </View>
                  ) : phase === "grading" ? (
                    <>
                      <Button label={MARKING_LINE[marking]} icon="waiting" loading />
                      <MarkingBar />
                    </>
                  ) : (
                    // The main action takes two parts of the row and Hear it one (board n-ux-low Q2a b).
                    <View style={styles.actions}>
                      <Button label={playful ? "Listen" : "Hear it"} icon="hear" variant="secondary" onPress={hear} style={styles.action} snug />
                      {resendable ? (
                        <Button label="Send it again" icon="retry" onPress={sendAgain} style={styles.actionMain} />
                      ) : (
                        <Button
                          // The day's marked drills all sung: the button says the day is done, not a greyed "Sing it".
                          label={doneForToday ? "Done for today" : onward ? onward.label : playful ? "Sing it!" : "Sing it"}
                          icon={doneForToday ? "check" : onward && !onward.same ? "next" : "mic"}
                          onPress={() => void (onward && !onward.same ? goNext() : sing())}
                          loading={starting === "main"}
                          disabled={doneForToday || starting === "again"}
                          style={styles.actionMain}
                        />
                      )}
                    </View>
                  )}
                  {phase === "idle" && ((onward && !onward.same) || resendable) ? (
                    <Button label={playful ? "Sing again!" : "Sing it again"} icon="mic" variant="secondary" onPress={() => void sing("again")} loading={starting === "again"} disabled={left === 0 || starting === "main"} />
                  ) : null}

                  {/* Marking takes up to a minute and the button shows only its spinner, so the line under it says so. */}
                  {phase === "grading" ? (
                    <Text style={styles.allowance} accessibilityLiveRegion="polite">
                      {marking === "slow" ? "Your take is safe. On a slow connection it can take up to a minute." : "Marking your take, note by note."}
                    </Text>
                  ) : allowance ? (
                    // The count is a label (13); once they are all sung it is good news in a sentence (16).
                    <Text style={left === 0 ? styles.body : styles.allowance}>{allowanceLine(allowance)}</Text>
                  ) : null}
                  {error ? <ProblemNote sentence>{error}</ProblemNote> : null}
                  {error === MIC_REFUSED && micBlocked ? (
                    <Button
                      label="Open settings"
                      variant="text"
                      size="sm"
                      onPress={() => void Linking.openSettings().catch(() => undefined)}
                      style={styles.settingsLink}
                    />
                  ) : null}
                  {grade?.milestone ? (
                    <View style={styles.milestone} accessibilityLiveRegion="polite">
                      <Text style={styles.milestoneTitle}>{grade.milestone.title}</Text>
                      <Text style={styles.meta}>{grade.milestone.description}</Text>
                    </View>
                  ) : null}
                  {grade && playful ? <StarGrade grade={grade} notes={drill.notes} showEarned={!rewardToasted} fresh /> : null}
                  {grade && !playful ? <GradeMarks grade={grade} notes={drill.notes} showEarned={!rewardToasted} fresh /> : null}
                  {grade && focused ? (
                    <View style={styles.focusRow}>
                      <Text style={styles.focusTuning}>{tuningLine(grade.tuningCents)}</Text>
                      {takeUri ? (
                        <Button label="Replay my take" icon="play" variant="secondary" onPress={replay} disabled={busy} />
                      ) : null}
                    </View>
                  ) : null}
                </Card>
              </View>
            ) : null}
            {!drill && !showPicker && !savingTrack ? (
              <EmptyState
                art="empty-no-drill"
                title="No drill yet"
                body="Your next drill isn't here yet. Pull down, or try again in a moment."
                onRetry={() => void onRefresh()}
                styles={styles}
              />
            ) : null}

            {/* ── The season's path: a short side-path with its own place, never the main path's ── */}
            {seasonPath && pathSeason && !showPicker ? (
              <SeasonPathCard
                season={seasonPath}
                doh={cardDoh}
                costume={costume}
                styles={styles}
                c={colors}
                onOpen={() => {
                  if (busy) return;
                  void logAnalyticsEvent(seasonWords(pathSeason).opened, { sung: seasonPath.sung });
                  nav.navigate("SeasonPath", { season: pathSeason, track });
                }}
              />
            ) : null}

            {/* ── Quick games: tapped, not sung, about a minute each (board s-practice-fun/s3) ── */}
            {!showPicker ? (
              <View style={styles.games}>
                <View style={styles.gamesHead}>
                  <Text style={styles.modesTitle} accessibilityRole="header">Quick games</Text>
                  <Text style={styles.gamesNote}>No mic · about a minute</Text>
                </View>
                <GameTiles
                  track={track}
                  onOpen={(game) => {
                    if (busy) return;
                    void logAnalyticsEvent("practice_game_opened", { game });
                    nav.navigate("PracticeGame", { game, track });
                  }}
                />
              </View>
            ) : null}

            {/* ── More ways to practise: the modes the server says are live ── */}
            {modeRows.length > 0 && !showPicker ? (
              <View style={styles.modes}>
                <View style={styles.modesHead}>
                  <View style={styles.modesHeadText}>
                    <Text style={styles.modesTitle} accessibilityRole="header">{modesHeading(track)}</Text>
                    {dohLine ? <Text style={styles.modesDoh}>“{dohLine}”</Text> : null}
                  </View>
                  {dohLine ? <CostumedArt name="doh-wave" width={56} costume={costume} /> : null}
                </View>
                <ModeList
                  rows={modeRows}
                  track={track}
                  onOpen={(mode) => {
                    if (busy) return;
                    void logAnalyticsEvent("practice_mode_opened", { mode });
                    nav.navigate("PracticeMode", { mode, track });
                  }}
                />
              </View>
            ) : null}

          </>
        ) : null}
      </Screen>

      <Confetti burst={burst} reduceMotion={reduceMotion} />

      {toast ? (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[
            styles.toast,
            { bottom: Math.max(insets.bottom, spacing.sm) + spacing.xs + 64 + spacing.lg },
            {
              opacity: toastAnim,
              transform: [{ translateY: reduceMotion ? 0 : toastAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
            },
          ]}
        >
          {toast.art ? <Art name={toast.art} width={28} /> : <Icon name="reward" size={16} color={playful ? colors.play : colors.icon} />}
          <Text style={styles.toastText}>{toast.line}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

/** Three tiny still bats in the Midnight path card's corner: [left, top, width, degrees], px within the corner. */
const CARD_BATS: [number, number, number, number][] = [
  [4, 10, 14, -10],
  [58, 0, 11, 8],
  [80, 30, 9, -4],
];

/**
 * The season's card (boards d-christmas/03, j-halloween/03): until when, six segments for six drills, how many are
 * sung and what is next, and the way in. The carols' card is pine and the Midnight path's pumpkin, each a tint here,
 * never a second accent; candle or moon cream labels it on Night. The Midnight path's corner holds three tiny still
 * bats and, with `doh`, Doh in his witch hat with Boo beside him.
 */
function SeasonPathCard({
  season,
  doh,
  costume,
  styles,
  c,
  onOpen,
}: {
  season: PracticeSeason;
  doh: boolean;
  costume: Costume | null;
  styles: Styles;
  c: Palette;
  onOpen: () => void;
}) {
  const card = seasonCard(season);
  const tint = seasonTint(c, card.season);
  const halloween = card.season === "halloween";
  return (
    <View style={[styles.carols, { backgroundColor: tint.soft, borderColor: tint.line }]} accessible={false}>
      {halloween ? (
        <View style={styles.cardBats} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {CARD_BATS.map(([left, top, width, deg], i) => (
            <View key={i} style={{ position: "absolute", left, top, opacity: 0.45, transform: [{ rotate: `${deg}deg` }] }}>
              <SvgXml xml={ART.bat} width={width} height={width / 2} color={c.bat} />
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.carolsTop}>
        <View style={styles.carolsText}>
          <Text style={[styles.carolsEyebrow, { color: tint.label }]}>{card.eyebrow}</Text>
          <Text style={styles.carolsTitle} accessibilityRole="header">{card.title}</Text>
          <Text style={styles.carolsBody}>{card.body}</Text>
        </View>
        {doh && halloween ? (
          <View style={styles.cardPair}>
            <CostumedArt name="doh-wave" width={72} costume={costume} />
            <Art name="boo" width={34} style={styles.cardBoo} />
          </View>
        ) : doh ? (
          <CostumedArt name="doh-wave" width={88} costume={costume} />
        ) : null}
      </View>
      <View style={styles.carolsBar} accessible accessibilityRole="progressbar" accessibilityLabel={card.label}>
        {card.segments.map((on, i) => (
          <View key={i} style={[styles.carolsSeg, on && { backgroundColor: tint.label }]} />
        ))}
      </View>
      <View style={styles.carolsFoot}>
        <View style={styles.carolsText}>
          <Text style={styles.carolsSung}>{card.sung}</Text>
          <Text style={styles.carolsNext} numberOfLines={2}>{card.next}</Text>
        </View>
        <Button label={card.action} icon="next" iconPosition="right" variant="secondary" size="sm" onPress={onOpen} />
      </View>
    </View>
  );
}

/** The streak and the level in one line at the top (board 6a); the full cards are under "Your progress". */
/**
 * The first read's stand-in, drawn where the streak line and the path card will sit, as the Library's rows are: a bare
 * spinner let the hub pop in all at once.
 */
function PracticeSkeleton({ styles }: { styles: Styles }) {
  return (
    <View accessible accessibilityLabel="Loading your practice" accessibilityState={{ busy: true }}>
      <View style={styles.progLine}>
        <Skeleton width={20} height={20} radius={10} />
        <Skeleton width="55%" height={13} radius={radii.sm} />
      </View>
      <DrillSkeleton styles={styles} />
    </View>
  );
}

/** The path card's stand-in: the first read's, and a new track's while its drill comes. */
function DrillSkeleton({ styles }: { styles: Styles }) {
  return (
    <Card style={styles.card}>
      <View accessible accessibilityLabel="Loading your drill" accessibilityState={{ busy: true }} style={styles.skeletonCard}>
        <Skeleton width="40%" height={11} radius={radii.sm} />
        <Skeleton width="70%" height={20} radius={radii.sm} />
        <View style={styles.solfaRow}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width={44} height={38} radius={radii.sm} />
          ))}
        </View>
        <View style={styles.actions}>
          <Skeleton height={48} radius={radii.pill} style={styles.action} />
          <Skeleton height={48} radius={radii.pill} style={styles.actionMain} />
        </View>
      </View>
    </Card>
  );
}

/** The streak, the level and the week in one line at the top; it opens "Your progress" (board s-practice-fun/s1). */
function ProgressLine({ progress, styles, colors, onOpen }: { progress: PracticeProgress; styles: Styles; colors: Palette; onOpen: () => void }) {
  const strip = progressStrip(progress);
  const week = progress.weeklyGoal;
  return (
    <Touchable onPress={onOpen} radius={radii.md} accessibilityRole="button" accessibilityLabel={`${strip.label}. ${week.daysDone} of ${week.target} days this week. Your progress`}>
    <View style={styles.progLine}>
      <Art name={flameArt(progress.streak)} width={20} />
      <Text style={styles.progStrong} numberOfLines={1}>{strip.streak}</Text>
      <View style={styles.progSep} />
      <Text style={styles.progText} numberOfLines={1}>
        <Text style={styles.progStrong}>{strip.level}</Text> · {strip.xp}
      </Text>
      <View style={styles.progBar}>
        <View style={[styles.progFill, { width: `${Math.round(strip.fraction * 100)}%` }]} />
      </View>
      {strip.toNext ? <Text style={styles.progText} numberOfLines={1}>{strip.toNext}</Text> : null}
      <View style={styles.progSep} />
      <Text style={styles.progStrong}>{week.daysDone}/{week.target}</Text>
      <Icon name="chevron" size={14} color={colors.textFaint} />
    </View>
    </Touchable>
  );
}

/** "No drill yet" and "You're offline": Doh's picture, a line, and a way to try again. */
function EmptyState({ art, title, body, onRetry, styles }: { art: ArtName; title: string; body: string; onRetry: () => void; styles: Styles }) {
  return (
    <Card style={styles.empty}>
      <Art name={art} width={200} />
      <Text style={styles.emptyTitle} accessibilityRole="header">{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      <Button label="Try again" icon="retry" variant="secondary" onPress={onRetry} />
    </Card>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
    /** Clears the floating tab bar. */
    screen: { paddingBottom: 120 },
    trackPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 44,
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    trackPillPlayful: { borderColor: c.playBorder, backgroundColor: c.playSoft },
    trackPillText: { ...typography.label, color: c.text, fontSize: 13 },

    buddy: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.md },
    buddyBubble: {
      flex: 1,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radii.lg,
      borderTopLeftRadius: 4,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    buddyText: { ...typography.label, color: c.text, lineHeight: 20 },
    card: { marginBottom: spacing.md, gap: spacing.sm },
    /** The card's own gap, inside the stand-in's one accessible element. */
    skeletonCard: { gap: spacing.sm },
    cardPlayful: { borderColor: c.playBorder, borderWidth: 1.5 },
    // Sentences are 16 px, meta and labels 13, and nothing is under 12 (board m-ux-medium P5c).
    body: { ...typography.body, color: c.textMuted, fontSize: 16, lineHeight: 23 },


    eyebrow: { ...typography.caption, color: c.textMuted, textTransform: "uppercase", letterSpacing: 1, fontSize: 12 },
    eyebrowPlayful: { color: c.play },
    cardTitle: { ...typography.label, color: c.text, fontSize: 16, fontFamily: fonts.bold },
    /** The drill's name, on both tracks: above the 18 px section titles round it (board n-ux-low Q2b f). */
    drillTitle: { ...typography.heading, color: c.text, fontSize: 20 },
    meta: { ...typography.caption, color: c.textMuted, fontSize: 13, lineHeight: 18 },
    unitRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 },
    // The track is the muted grey at 28 % (`47` in hex; both palettes' textMuted are six-digit hex): 1.56:1 to the card.
    unitBar: { flex: 1, minWidth: 48, height: 6, borderRadius: 3, backgroundColor: `${c.textMuted}47`, overflow: "hidden" },
    unitBarFill: { height: 6, borderRadius: 3, backgroundColor: c.text },
    unitLabel: { ...typography.caption, color: c.textMuted, fontSize: 13, lineHeight: 18, flexShrink: 1 },
    milestone: { gap: 2, padding: spacing.sm, borderRadius: radii.sm, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surfaceAlt },
    milestoneTitle: { ...typography.label, color: c.text, fontFamily: fonts.bold },
    solfaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: spacing.xs },
    solfaChip: {
      minWidth: 44,
      alignItems: "center",
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: radii.sm,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1.5,
      borderColor: c.border,
    },
    solfaChipPlayful: {
      minWidth: 56,
      minHeight: 56,
      justifyContent: "center",
      borderRadius: 28,
      borderWidth: 2,
      borderColor: c.playBorder,
      backgroundColor: c.playSoft,
    },
    solfaChipOn: { borderColor: c.accent, backgroundColor: c.accentSoft },
    solfa: { ...typography.mono, color: c.text, fontSize: 20 },
    solfaPlayful: { fontSize: 24 },
    solfaOn: { color: c.accent },
    actions: { flexDirection: "row", gap: spacing.sm },
    action: { flex: 1 },
    actionMain: { flex: 2 },
    live: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
    liveLabel: { ...typography.label, color: c.textMuted },
    allowance: { ...typography.caption, color: c.textMuted, fontSize: 13, lineHeight: 18 },
    /** Under the problem note, its word lined up with the note's (icon 15 + gap 6, less the button's 12 pad). */
    settingsLink: { alignSelf: "flex-start", marginLeft: 15 + 6 - 12 },
    focusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap" },
    focusTuning: { ...typography.label, color: c.textMuted, fontSize: 13 },



    progLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: -spacing.sm, marginBottom: spacing.md },
    progText: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted, flexShrink: 1 },
    progStrong: { fontFamily: fonts.semibold, fontSize: 13, color: c.text },
    progSep: { width: 1, height: 14, backgroundColor: c.border },
    progBar: { width: 48, height: 5, borderRadius: 3, backgroundColor: c.surfaceAlt, overflow: "hidden" },
    progFill: { height: 5, borderRadius: 3, backgroundColor: c.text },

    carols: {
      marginBottom: spacing.md,
      padding: spacing.lg,
      gap: spacing.md,
      borderRadius: radii.lg,
      borderWidth: 1,
      overflow: "hidden",
    },
    carolsTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    /** The Midnight path card's top right corner, where the still bats hang. */
    cardBats: { position: "absolute", top: 10, right: 12, width: 96, height: 44 },
    /** Doh with Boo at his shoulder (Halloween, Playful). */
    cardPair: { width: 72 + 22, height: 80, marginTop: spacing.sm },
    cardBoo: { position: "absolute", right: 0, top: -6 },
    carolsText: { flex: 1, minWidth: 0, gap: 4 },
    carolsEyebrow: { ...typography.caption, textTransform: "uppercase", letterSpacing: 1, fontSize: 12, fontFamily: fonts.semibold },
    carolsTitle: { ...typography.heading, color: c.text, fontSize: 20 },
    carolsBody: { ...typography.body, color: c.textMuted, fontSize: 14, lineHeight: 20 },
    carolsBar: { flexDirection: "row", gap: 6 },
    carolsSeg: { flex: 1, height: 5, borderRadius: 3, backgroundColor: c.surfaceAlt },
    carolsFoot: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    carolsSung: { ...typography.label, color: c.text, fontSize: 14 },
    carolsNext: { ...typography.caption, color: c.textMuted, fontSize: 13 },

    games: { marginTop: spacing.sm, marginBottom: spacing.lg },
    gamesHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm, marginBottom: spacing.sm },
    gamesNote: { ...typography.caption, color: c.textFaint, fontSize: 13 },
    modes: { marginTop: spacing.sm, marginBottom: spacing.lg },
    modesHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
    modesHeadText: { flex: 1, minWidth: 0, gap: 4 },
    modesTitle: { ...typography.heading, color: c.text },
    modesDoh: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, color: c.textMuted },



    empty: { marginBottom: spacing.md, gap: spacing.sm, alignItems: "center", paddingVertical: spacing.lg },
    emptyTitle: { ...typography.heading, color: c.text, textAlign: "center" },
    emptyBody: { ...typography.body, color: c.textMuted, fontSize: 16, lineHeight: 23, textAlign: "center", marginBottom: spacing.xs },
    toast: {
      position: "absolute",
      left: spacing.lg,
      right: spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.pill,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.border,
    },
    toastText: { ...typography.label, color: c.text, flex: 1 },
  });
