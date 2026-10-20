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
 * Board c-practice/6a: the path card stays the hero, the streak and level one line above it, then "More ways to
 * practise" (Playful: "More ways to play") — the modes the server says are live (`progress.modes`), each pushing
 * `PracticeMode` (screens/practice) — and the stat cards, the week and the badges below as "Your progress". One Doh on
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
import Svg, { Circle, Path, SvgXml } from "react-native-svg";
import { File, Paths } from "expo-file-system";
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
} from "expo-audio";

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
import type { Drill, GradeResult, PracticeBadge, PracticeDay, PracticeProgress, PracticeSeason, PracticeTrack, WeeklyGoal } from "../api/types";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { leadInFor, noteDueAt, partSeconds } from "../lib/take";
import { synthesizeMelodyWavBase64 } from "../lib/synth";
import { logAnalyticsEvent } from "../lib/analytics";
import { acknowledgeGrade } from "../lib/practiceReward";
import { rememberStreak } from "../lib/practiceReminder";
import {
  allowanceLine,
  levelFraction,
  nextAction,
  nextLevelLine,
  pathLine,
  unitFraction,
  sortBadges,
  streakLabel,
  streakLine,
  streakSnapshot,
  weekdayLetter,
} from "../lib/practiceProgress";
import {
  badgeArt,
  celebrationFor,
  flameArt,
  gradeAnnouncement,
  levelArt,
  mascotArt,
  mascotLine,
  mascotMood,
  playfulRewardLine,
  rewardArt,
  stickerTilt,
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
import { hubModes, modesDohLine, modesHeading, progressStrip } from "../lib/practiceModes";
import type { RootStackParams } from "../navigation/types";

type Phase = "idle" | "leadin" | "singing" | "grading";

const RECORDING = { ...RecordingPresets.HIGH_QUALITY, sampleRate: 22050, numberOfChannels: 1 };
/** Recording runs on this long after the last note, so a held ending is not cut (the server keeps four). */
const TAIL_SEC = 1;
const TOAST_MS = 3200;
const MIC_REFUSED = "Microphone permission is needed to sing the drill.";

export function PracticeScreen() {
  const colors = useColors();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const recorder = useAudioRecorder(RECORDING);

  const [progress, setProgress] = useState<PracticeProgress | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  /** The path's drill after a marked take, fetched with the fresh progress: what "Next drill" opens. */
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

  const [picking, setPicking] = useState(false);
  const [savingTrack, setSavingTrack] = useState<PracticeTrack | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [takeUri, setTakeUri] = useState<string | null>(null);

  /** The reward line, with the level's emblem or the badge's sticker beside it when it is one. */
  const [toast, setToast] = useState<{ line: string; art: ArtName | null } | null>(null);
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

  /** Saves the track, then loads the drill it offers today (each track has its own drill of the day). */
  async function chooseTrack(next: PracticeTrack) {
    if (phase !== "idle") return;
    setSavingTrack(next);
    setTrackError(null);
    try {
      const p = await practiceApi.setTrack(next);
      const d = await practiceApi.nextDrill();
      if (!live.current) return;
      setProgress(p);
      setDrill(d);
      setNext(null);
      setGrade(null);
      setTakeUri(null);
      setPicking(false);
      void logAnalyticsEvent("practice_track_chosen", { track: next });
    } catch (e) {
      if (live.current) setTrackError(toApiError(e).message);
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

  async function sing() {
    if (!drill || phase !== "idle" || startingRef.current) return;
    startingRef.current = true;
    cleanup();
    setError(null);
    setGrade(null);
    setTakeUri(null);
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
    }
  }

  async function finish(sung: Drill) {
    cleanup();
    setPhase("grading");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) throw new Error("The recording was lost.");
      const result = await practiceApi.gradeDrill(uri, sung.id, leadIn.current);
      if (!live.current) return;
      setGrade(result);
      setTakeUri(uri);
      setPhase("idle");
      void logAnalyticsEvent("drill_completed", { drill: sung.id, score: result.score, xp: result.reward?.xpGained ?? 0 });
      const moment = acknowledgeGrade(result);
      const how = celebrationFor(sung.track, result.score, result.reward, !!result.milestone);
      if (how === "burst") setBurst((b) => b + 1);
      const line = result.milestone?.title ?? (sung.track === "playful" ? playfulRewardLine(result.reward) : moment?.line);
      if (how !== "quiet" && line) showToast(line, rewardArt(result.reward));
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
      if (!live.current) return;
      setPhase("idle");
      setError(toApiError(e).message);
    }
  }

  /** On along the path: the drill fetched after the take (or fetched now), its marks cleared. */
  async function goNext() {
    if (phase !== "idle") return;
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
            <ProgressLine progress={progress} styles={styles} />

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

            {/* ── Today's drill ────────────────────────────────────────────── */}
            {drill && !showPicker ? (
              <Card style={playful ? { ...styles.card, ...styles.cardPlayful } : styles.card}>
                <Text style={[styles.eyebrow, playful && styles.eyebrowPlayful]}>
                  {playful ? "Your singing game" : `Practice path · ${drill.levelName}`}
                </Text>
                <Text style={[styles.cardTitle, playful && styles.cardTitlePlayful]}>{drill.title}</Text>
                {where ? (
                  <View accessible accessibilityLabel={where}>
                    <Text style={styles.pathLine}>{where}</Text>
                    <View style={styles.unitBar}>
                      <View style={[styles.unitBarFill, { width: `${Math.round(unitFraction(drill) * 100)}%` }]} />
                    </View>
                  </View>
                ) : null}
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

                {phase === "leadin" || phase === "singing" ? (
                  <View style={styles.live}>
                    <Text style={styles.liveLabel}>{phase === "leadin" ? `Starting note… sing in ${countdown}` : "Sing!"}</Text>
                    <Button label="Stop" variant="secondary" icon="stop" onPress={stop} />
                  </View>
                ) : phase === "grading" ? (
                  <Button label="Marking your take…" icon="waiting" loading />
                ) : (
                  <View style={styles.actions}>
                    <Button label={playful ? "Listen" : "Hear it"} icon="hear" variant="secondary" onPress={hear} style={styles.action} />
                    <Button
                      label={onward ? onward.label : playful ? "Sing it!" : "Sing it"}
                      icon={onward && !onward.same ? "next" : "mic"}
                      onPress={() => void (onward && !onward.same ? goNext() : sing())}
                      disabled={left === 0 && !(onward && !onward.same)}
                      style={styles.action}
                    />
                  </View>
                )}
                {phase === "idle" && onward && !onward.same ? (
                  <Button label={playful ? "Again!" : "Sing it again"} icon="mic" variant="secondary" onPress={() => void sing()} disabled={left === 0} />
                ) : null}

                {allowance ? <Text style={styles.allowance}>{allowanceLine(allowance)}</Text> : null}
                {error ? <ProblemNote>{error}</ProblemNote> : null}
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
                {grade && playful ? <StarGrade grade={grade} notes={drill.notes} /> : null}
                {grade && !playful ? <GradeMarks grade={grade} notes={drill.notes} /> : null}
                {grade && focused ? (
                  <View style={styles.focusRow}>
                    <Text style={styles.focusTuning}>{tuningLine(grade.tuningCents)}</Text>
                    {takeUri ? (
                      <Button label="Replay my take" icon="play" variant="secondary" onPress={replay} disabled={busy} />
                    ) : null}
                  </View>
                ) : null}
              </Card>
            ) : null}
            {!drill && !showPicker ? (
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

            {/* ── Your progress: streak and level, the week, the badges ────── */}
            <Text style={styles.sectionTitle}>Your progress</Text>
            <View style={styles.statsRow}>
              <Card style={styles.statCard}>
                <View style={styles.statHead}>
                  <Art name={flameArt(progress.streak)} width={32} />
                  <Text style={styles.statBig} accessibilityLabel={streakLabel(progress.streak.current, progress.streak.best)}>
                    {progress.streak.current}
                  </Text>
                </View>
                <Text style={styles.statLabel}>day streak</Text>
                <Text style={styles.statSub}>{streakLine(progress.streak)}</Text>
                <View style={styles.footRow}>
                  <Art name="freeze" width={16} style={!progress.streak.freezeAvailable && styles.spent} />
                  <Text style={[styles.statFoot, styles.footText]}>
                    {progress.streak.freezeAvailable ? "Streak freeze ready this week" : "Freeze used this week"}
                  </Text>
                </View>
              </Card>

              <Card style={styles.statCard}>
                <View style={styles.levelHead}>
                  <Art name={levelArt(progress.level.index)} width={44} />
                  <View style={styles.levelText}>
                    <Text style={[styles.levelName, progress.level.name.length > 6 && styles.levelNameLong]} numberOfLines={2}>
                      {progress.level.name}
                    </Text>
                    <Text style={styles.statLabel}>level {progress.level.index + 1} of 8</Text>
                  </View>
                </View>
                <View style={styles.barRow}>
                  <View
                    style={styles.barTrack}
                    accessible
                    accessibilityRole="progressbar"
                    accessibilityLabel={`${progress.xp} XP. ${nextLevelLine(progress.level)}`}
                  >
                    <View style={[styles.barFill, { width: `${Math.round(levelFraction(progress.level, progress.xp) * 100)}%` }]} />
                  </View>
                  {progress.level.nextName ? <Art name={levelArt(progress.level.index + 1)} width={22} /> : null}
                </View>
                <Text style={styles.statSub}>{progress.xp} XP</Text>
                <Text style={styles.statFoot}>{nextLevelLine(progress.level)}</Text>
              </Card>
            </View>

            {/* ── This week ────────────────────────────────────────────────── */}
            <Card style={styles.card}>
              <View style={styles.weekRow}>
                <GoalRing goal={progress.weeklyGoal} styles={styles} colors={colors} />
                <View style={styles.weekText}>
                  <Text style={styles.cardTitle}>
                    {progress.weeklyGoal.daysDone} of {progress.weeklyGoal.target} days this week
                  </Text>
                  <Text style={styles.meta}>
                    {progress.weeklyGoal.daysDone >= progress.weeklyGoal.target ? "Weekly goal met." : "Practise five days a week to meet the goal."}
                  </Text>
                </View>
              </View>
              <View style={styles.days}>
                {progress.lastSevenDays.map((d) => (
                  <DayDot key={d.date} day={d} styles={styles} colors={colors} />
                ))}
              </View>
              <Text style={styles.meta}>
                {progress.xpToday} of {progress.dailyXpCap} XP today
              </Text>
            </Card>

            {/* ── Badges: stickers on Playful, a plain list on Focused ──────── */}
            <Text style={styles.sectionTitle}>{playful ? "My stickers" : "Badges"}</Text>
            {playful ? (
              <View style={styles.stickerGrid}>
                {sortBadges(progress.badges).map((b) => (
                  <Sticker key={b.code} badge={b} styles={styles} />
                ))}
              </View>
            ) : focused ? (
              <Card style={styles.badgeList} padded={false}>
                {sortBadges(progress.badges).map((b, i) => (
                  <BadgeRow key={b.code} badge={b} first={i === 0} styles={styles} colors={colors} />
                ))}
              </Card>
            ) : (
              <View style={styles.badgeGrid}>
                {sortBadges(progress.badges).map((b) => (
                  <BadgeTile key={b.code} badge={b} styles={styles} />
                ))}
              </View>
            )}

            <Text style={styles.foot}>
              {playful
                ? `Every singing game earns XP and stars. Up to ${progress.dailyXpCap} XP a day.`
                : `Practice counts when a take is marked: a drill on your path, Sing it, or Learn my part. Up to ${progress.dailyXpCap} XP a day.`}
            </Text>
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
      <Card style={styles.card}>
        <Skeleton width="40%" height={11} radius={radii.sm} />
        <Skeleton width="70%" height={20} radius={radii.sm} />
        <View style={styles.solfaRow}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width={44} height={38} radius={radii.sm} />
          ))}
        </View>
        <View style={styles.actions}>
          <Skeleton height={48} radius={radii.pill} style={styles.action} />
          <Skeleton height={48} radius={radii.pill} style={styles.action} />
        </View>
      </Card>
    </View>
  );
}

function ProgressLine({ progress, styles }: { progress: PracticeProgress; styles: Styles }) {
  const strip = progressStrip(progress);
  return (
    <View style={styles.progLine} accessible accessibilityLabel={strip.label}>
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
    </View>
  );
}

/**
 * The weekly goal as the art draws it: one arc per practice day of the goal, lit as the days are sung, and a ticked
 * disc in the middle once the week is met.
 */
function GoalRing({ goal, styles, colors }: { goal: WeeklyGoal; styles: Styles; colors: Palette }) {
  const size = 64;
  const stroke = 7;
  const c = size / 2;
  const r = c - stroke / 2 - 1;
  const n = Math.max(1, Math.min(7, goal.target));
  const done = Math.min(goal.daysDone, n);
  const met = goal.daysDone >= goal.target && goal.target > 0;
  const seg = 360 / n;
  const gap = n > 1 ? 14 : 0;
  const at = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  };
  return (
    <View
      style={styles.ring}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Weekly goal: ${goal.daysDone} of ${goal.target} days${met ? ", met" : ""}`}
    >
      <Svg width={size} height={size}>
        {n === 1 ? (
          <Circle cx={c} cy={c} r={r} stroke={done ? colors.success : colors.surfaceAlt} strokeWidth={stroke} fill="none" />
        ) : (
          Array.from({ length: n }, (_, i) => (
            <Path
              key={i}
              d={`M${at(i * seg + gap / 2)}A${r} ${r} 0 0 1 ${at((i + 1) * seg - gap / 2)}`}
              stroke={i < done ? colors.success : colors.surfaceAlt}
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
            />
          ))
        )}
        {met ? <Circle cx={c} cy={c} r={r - 9} fill={colors.success} /> : null}
      </Svg>
      {met ? <Icon name="check" size={22} strokeWidth={2.25} color={colors.bg} style={styles.ringTick} /> : null}
    </View>
  );
}

const DAY_A11Y: Record<PracticeDay["status"], string> = {
  done: "practised",
  frozen: "missed, kept by the streak freeze",
  missed: "missed",
  today: "today, not practised yet",
  none: "before your first practice",
};

function DayDot({ day, styles, colors }: { day: PracticeDay; styles: Styles; colors: Palette }) {
  return (
    <View style={styles.day} accessible accessibilityLabel={`${day.date}: ${DAY_A11Y[day.status]}`}>
      <View
        style={[
          styles.dayDot,
          day.status === "done" && { backgroundColor: colors.accent, borderColor: colors.accent },
          day.status === "frozen" && { borderColor: "transparent" },
          day.status === "today" && { borderColor: colors.text, borderStyle: "dashed" },
          day.status === "none" && { opacity: 0.4 },
        ]}
      >
        {day.status === "done" ? <Icon name="check" size={14} strokeWidth={2.25} color={colors.onAccent} /> : null}
        {day.status === "frozen" ? <Art name="freeze" width={26} /> : null}
      </View>
      <Text style={styles.dayLetter}>{weekdayLetter(day.date)}</Text>
    </View>
  );
}

function badgeLabel(badge: PracticeBadge, sticker = false): string {
  return `${badge.title}${sticker ? " sticker" : ""}. ${badge.description} ${badge.earned ? "Earned." : `${badge.progress} of ${badge.target}.`}`;
}

/** No track chosen yet: the badges as tiles under the picker. */
function BadgeTile({ badge, styles }: { badge: PracticeBadge; styles: Styles }) {
  return (
    <View style={[styles.badge, !badge.earned && styles.badgeLocked]} accessible accessibilityLabel={badgeLabel(badge)}>
      <Art name={badgeArt(badge.code, badge.earned)} width={40} />
      <Text style={styles.badgeTitle} numberOfLines={1}>{badge.title}</Text>
      <Text style={styles.badgeDesc} numberOfLines={2}>{badge.description}</Text>
      {!badge.earned ? (
        <View style={styles.badgeProgressRow}>
          <View style={styles.badgeTrack}>
            <View style={[styles.badgeFill, { width: `${Math.round((badge.progress / Math.max(1, badge.target)) * 100)}%` }]} />
          </View>
          <Text style={styles.badgeCount}>{badge.progress}/{badge.target}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Playful's sticker book: each badge its own die-cut sticker, tilted as if stuck by hand; locked ones grey and flat. */
function Sticker({ badge, styles }: { badge: PracticeBadge; styles: Styles }) {
  return (
    <View style={styles.sticker} accessible accessibilityLabel={badgeLabel(badge, true)}>
      <Art
        name={badgeArt(badge.code, badge.earned)}
        width={76}
        style={badge.earned ? { transform: [{ rotate: `${stickerTilt(badge.code)}deg` }] } : undefined}
      />
      <Text style={[styles.stickerTitle, !badge.earned && { color: styles.badgeDesc.color }]} numberOfLines={2}>{badge.title}</Text>
      {!badge.earned ? <Text style={styles.badgeCount}>{badge.progress}/{badge.target}</Text> : null}
    </View>
  );
}

/** Focused's badges: the same stickers, small and flat, in a plain list. */
function BadgeRow({ badge, first, styles, colors }: { badge: PracticeBadge; first: boolean; styles: Styles; colors: Palette }) {
  return (
    <View style={[styles.badgeRow, !first && styles.badgeRowRule]} accessible accessibilityLabel={badgeLabel(badge)}>
      <Art name={badgeArt(badge.code, badge.earned)} width={34} />
      <View style={styles.badgeRowText}>
        <Text style={[styles.badgeTitle, !badge.earned && { color: colors.textMuted }]}>{badge.title}</Text>
        <Text style={styles.badgeDesc} numberOfLines={1}>{badge.description}</Text>
      </View>
      <Text style={styles.badgeRowCount}>{badge.earned ? "Earned" : `${badge.progress}/${badge.target}`}</Text>
    </View>
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
    cardPlayful: { borderColor: c.playBorder, borderWidth: 1.5 },
    body: { ...typography.body, color: c.textMuted, fontSize: 13, lineHeight: 20 },

    statsRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
    statCard: { flex: 1, gap: 2 },
    statHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    statBig: { ...typography.title, color: c.text, fontSize: 30 },
    levelName: { ...typography.title, color: c.text, fontSize: 24 },
    /** "Choir-ready" beside its emblem in half a phone's width: smaller, and free to break at the hyphen. */
    levelNameLong: { fontSize: 18, lineHeight: 21 },
    statLabel: { ...typography.caption, color: c.textMuted },
    statSub: { ...typography.label, color: c.text, fontSize: 13, marginTop: spacing.xs },
    statFoot: { ...typography.caption, color: c.textFaint, fontSize: 11 },
    footRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
    footText: { flex: 1 },
    spent: { opacity: 0.4 },
    levelHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    levelText: { flex: 1, minWidth: 0 },
    barRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
    barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: "hidden" },
    barFill: { height: 8, borderRadius: 4, backgroundColor: c.accent },

    eyebrow: { ...typography.caption, color: c.accent, textTransform: "uppercase", letterSpacing: 1, fontSize: 10 },
    eyebrowPlayful: { color: c.play },
    cardTitle: { ...typography.label, color: c.text, fontSize: 15, fontFamily: fonts.bold },
    cardTitlePlayful: { ...typography.heading, fontSize: 20 },
    meta: { ...typography.caption, color: c.textMuted, lineHeight: 17 },
    pathLine: { ...typography.caption, color: c.textMuted, fontSize: 12 },
    unitBar: { height: 3, borderRadius: 2, backgroundColor: c.surfaceAlt, overflow: "hidden", marginTop: 4 },
    unitBarFill: { height: 3, borderRadius: 2, backgroundColor: c.accent },
    milestone: { gap: 2, padding: spacing.sm, borderRadius: radii.sm, borderWidth: 1.5, borderColor: c.accent, backgroundColor: c.accentSoft },
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
    live: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
    liveLabel: { ...typography.label, color: c.textMuted },
    allowance: { ...typography.caption, color: c.textMuted },
    /** Under the problem note, its word lined up with the note's (icon 15 + gap 6, less the button's 12 pad). */
    settingsLink: { alignSelf: "flex-start", marginLeft: 15 + 6 - 12 },
    focusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap" },
    focusTuning: { ...typography.label, color: c.textMuted, fontSize: 13 },

    weekRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    weekText: { flex: 1, gap: 2 },
    ring: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
    ringTick: { position: "absolute" },
    days: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs },
    day: { alignItems: "center", gap: 4 },
    dayDot: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    dayLetter: { ...typography.caption, color: c.textFaint, fontSize: 11 },

    sectionTitle: { ...typography.heading, color: c.text, marginTop: spacing.sm, marginBottom: spacing.sm },

    progLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: -spacing.sm, marginBottom: spacing.md },
    progText: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted, flexShrink: 1 },
    progStrong: { fontFamily: fonts.semibold, fontSize: 13, color: c.text },
    progSep: { width: 1, height: 14, backgroundColor: c.border },
    progBar: { width: 48, height: 5, borderRadius: 3, backgroundColor: c.surfaceAlt, overflow: "hidden" },
    progFill: { height: 5, borderRadius: 3, backgroundColor: c.accent },

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
    carolsEyebrow: { ...typography.caption, textTransform: "uppercase", letterSpacing: 1, fontSize: 10.5, fontFamily: fonts.semibold },
    carolsTitle: { ...typography.heading, color: c.text, fontSize: 20 },
    carolsBody: { ...typography.body, color: c.textMuted, fontSize: 13.5, lineHeight: 20 },
    carolsBar: { flexDirection: "row", gap: 6 },
    carolsSeg: { flex: 1, height: 5, borderRadius: 3, backgroundColor: c.surfaceAlt },
    carolsFoot: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    carolsSung: { ...typography.label, color: c.text, fontSize: 14 },
    carolsNext: { ...typography.caption, color: c.textMuted, fontSize: 12.5 },

    modes: { marginTop: spacing.sm, marginBottom: spacing.lg },
    modesHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
    modesHeadText: { flex: 1, minWidth: 0, gap: 4 },
    modesTitle: { ...typography.heading, color: c.text },
    modesDoh: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
    badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    badge: {
      width: "48%",
      flexGrow: 1,
      backgroundColor: c.surface,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
      gap: 4,
    },
    badgeLocked: { opacity: 0.55 },
    badgeTitle: { ...typography.label, color: c.text, fontSize: 13 },
    badgeDesc: { ...typography.caption, color: c.textMuted, fontSize: 11, lineHeight: 15 },
    badgeProgressRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: 2 },
    badgeTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.surfaceAlt, overflow: "hidden" },
    badgeFill: { height: 4, borderRadius: 2, backgroundColor: c.textMuted },
    badgeCount: { ...typography.caption, color: c.textFaint, fontSize: 10 },

    stickerGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.md },
    sticker: { width: "33.33%", paddingHorizontal: spacing.xs, alignItems: "center", gap: 6 },
    stickerTitle: { ...typography.caption, color: c.text, textAlign: "center", fontFamily: fonts.semibold, lineHeight: 15 },

    badgeList: { overflow: "hidden" },
    badgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minHeight: 48 },
    badgeRowRule: { borderTopWidth: 1, borderTopColor: c.border },
    badgeRowText: { flex: 1 },
    badgeRowCount: { ...typography.caption, color: c.textFaint, fontFamily: fonts.medium },

    foot: { ...typography.caption, color: c.textFaint, lineHeight: 17, marginTop: spacing.lg },
    empty: { marginBottom: spacing.md, gap: spacing.sm, alignItems: "center", paddingVertical: spacing.lg },
    emptyTitle: { ...typography.heading, color: c.text, textAlign: "center" },
    emptyBody: { ...typography.body, color: c.textMuted, fontSize: 13, lineHeight: 20, textAlign: "center", marginBottom: spacing.xs },
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
