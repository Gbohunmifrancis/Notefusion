/**
 * PracticeScreen — the daily habit: today's free solfa drill (hear it, a count-in, sing it, marked note by
 * note), the streak, XP toward the next sol-fa level, the weekly goal, the last seven days and the badges.
 *
 * Every number here is the server's (`GET /api/practice/progress`), read off the takes it has marked; the
 * phone never reports a score. A marked take comes back with what it earned, which is celebrated with one
 * line and a tap — and without motion when the system asks for reduced motion.
 *
 * Two tracks, chosen by style (never by age) on the first visit and changeable any time (`lib/practiceTrack`):
 * Playful — stars and a friendly word instead of the number, a practice buddy, stickers, a confetti burst; and
 * Focused — the exact score and cents, the take's overall tuning, "Replay my take", and less fuss. The server picks
 * each track's drills; XP, levels, streaks and badges are the same on both.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useReducedMotion } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
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
import { Touchable } from "../components/Touchable";
import { GradeMarks } from "../components/GradeMarks";
import { TrackPicker } from "../components/practice/TrackPicker";
import { StarGrade } from "../components/practice/StarGrade";
import { Confetti } from "../components/practice/Confetti";
import { practiceApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import type { Drill, GradeResult, PracticeBadge, PracticeDay, PracticeProgress, PracticeTrack } from "../api/types";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { leadInFor, noteDueAt, partSeconds } from "../lib/take";
import { synthesizeMelodyWavBase64 } from "../lib/synth";
import { logAnalyticsEvent } from "../lib/analytics";
import { acknowledgeGrade } from "../lib/practiceReward";
import { rememberStreak } from "../lib/practiceReminder";
import {
  levelFraction,
  nextLevelLine,
  sortBadges,
  streakLabel,
  streakSnapshot,
  weekdayLetter,
  weeklyFraction,
} from "../lib/practiceProgress";
import {
  buddyLine,
  celebrationFor,
  playfulRewardLine,
  stickerTilt,
  trackTitle,
  tuningLine,
} from "../lib/practiceTrack";
import type { RootStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "Practice">;
type Phase = "idle" | "leadin" | "singing" | "grading";
type IconName = keyof typeof Ionicons.glyphMap;

const RECORDING = { ...RecordingPresets.HIGH_QUALITY, sampleRate: 22050, numberOfChannels: 1 };
/** Recording runs on this long after the last note, so a held ending is not cut (the server keeps four). */
const TAIL_SEC = 1;
const TOAST_MS = 3200;

const BADGE_ICONS: Record<string, IconName> = {
  first_drill: "musical-note",
  streak_3: "flame",
  first_100: "star",
  drills_10: "medal",
  first_part: "people",
  streak_7: "flame",
  whole_part_80: "ribbon",
  streak_30: "trophy",
};

export function PracticeScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const recorder = useAudioRecorder(RECORDING);

  const [progress, setProgress] = useState<PracticeProgress | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [grade, setGrade] = useState<GradeResult | null>(null);

  const [picking, setPicking] = useState(false);
  const [savingTrack, setSavingTrack] = useState<PracticeTrack | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [takeUri, setTakeUri] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const leadIn = useRef(0);
  const player = useRef<AudioPlayer | null>(null);
  const audioFile = useRef<File | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopAt = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const live = useRef(true);

  const load = useCallback(async () => {
    try {
      const [p, d] = await Promise.all([practiceApi.progress(), practiceApi.todayDrill()]);
      if (!live.current) return;
      setProgress(p);
      setDrill(d);
      setLoadError(null);
      void rememberStreak(streakSnapshot(p));
    } catch (e) {
      if (live.current) setLoadError(toApiError(e).message);
    } finally {
      if (live.current) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
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

  function showToast(line: string) {
    setToast(line);
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
      const d = await practiceApi.todayDrill();
      if (!live.current) return;
      setProgress(p);
      setDrill(d);
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
    if (!drill || phase !== "idle") return;
    cleanup();
    setError(null);
    setGrade(null);
    setTakeUri(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { setError("Microphone permission is needed to sing the drill."); return; }
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
      const result = await practiceApi.gradeDrill(uri, sung.id);
      if (!live.current) return;
      setGrade(result);
      setTakeUri(uri);
      setPhase("idle");
      void logAnalyticsEvent("drill_completed", { drill: sung.id, score: result.score, xp: result.reward?.xpGained ?? 0 });
      const moment = acknowledgeGrade(result);
      const how = celebrationFor(sung.track, result.score, result.reward);
      if (how === "burst") setBurst((b) => b + 1);
      const line = sung.track === "playful" ? playfulRewardLine(result.reward) : moment?.line;
      if (how !== "quiet" && line) showToast(line);
      const fresh = await practiceApi.progress().catch(() => null);
      if (fresh && live.current) {
        setProgress(fresh);
        setDrill((d) => (d ? { ...d, allowance: fresh.drills } : d));
      }
    } catch (e) {
      if (!live.current) return;
      setPhase("idle");
      setError(toApiError(e).message);
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

  return (
    <View style={styles.flex}>
      <Screen
        scroll
        contentStyle={styles.screen}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
      >
        <View style={styles.headerRow}>
          <Touchable
            onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Tabs", { screen: "Home" }))}
            accessibilityLabel="Go back"
            hitSlop={8}
            ripple="borderless"
          >
            <View style={styles.backCircle}>
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </View>
          </Touchable>
          <View style={styles.titleBlock}>
            <Text style={styles.titleLabel}>Daily practice</Text>
            <Text style={styles.titleMain}>Practice</Text>
          </View>
          {track && !showPicker && !busy ? (
            <Touchable
              onPress={() => { setTrackError(null); setPicking(true); }}
              accessibilityRole="button"
              accessibilityLabel={`Practice style: ${trackTitle(track)}. Change it`}
              radius={radii.pill}
            >
              <View style={[styles.trackPill, playful && styles.trackPillPlayful]}>
                <Ionicons name={playful ? "happy" : "musical-notes"} size={15} color={playful ? colors.premium : colors.accent} />
                <Text style={styles.trackPillText}>{trackTitle(track)}</Text>
                <Ionicons name="swap-horizontal" size={14} color={colors.textMuted} />
              </View>
            </Touchable>
          ) : null}
        </View>

        {loading && !progress ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        ) : loadError && !progress ? (
          <Card style={styles.card}>
            <Text style={styles.body}>{loadError}</Text>
            <Button label="Try again" icon="refresh" variant="secondary" onPress={() => { setLoading(true); void load(); }} />
          </Card>
        ) : progress ? (
          <>
            {showPicker ? (
              <TrackPicker
                current={track}
                saving={savingTrack}
                error={trackError}
                onPick={(t) => void chooseTrack(t)}
                onCancel={track ? () => setPicking(false) : undefined}
              />
            ) : null}

            {playful && !showPicker ? (
              <View style={styles.buddy} accessible accessibilityLabel={`Your practice buddy says: ${buddyLine(progress)}`}>
                <View style={styles.buddyFace}>
                  <Ionicons name="happy" size={26} color={colors.premium} />
                </View>
                <View style={styles.buddyBubble}>
                  <Text style={styles.buddyText}>{buddyLine(progress)}</Text>
                </View>
              </View>
            ) : null}

            {/* ── Streak and level ─────────────────────────────────────────── */}
            <View style={styles.statsRow}>
              <Card style={styles.statCard}>
                <View style={styles.statHead}>
                  <Ionicons
                    name={progress.streak.current > 0 ? "flame" : "flame-outline"}
                    size={22}
                    color={progress.streak.current > 0 ? colors.premium : colors.textFaint}
                  />
                  <Text style={styles.statBig} accessibilityLabel={streakLabel(progress.streak.current)}>
                    {progress.streak.current}
                  </Text>
                </View>
                <Text style={styles.statLabel}>day streak</Text>
                <Text style={styles.statSub}>
                  {progress.streak.todayDone
                    ? "Done for today"
                    : progress.streak.atRisk
                      ? "Sing today to keep it"
                      : "Sing a drill to start one"}
                </Text>
                <Text style={styles.statFoot}>
                  {progress.streak.freezeAvailable ? "Streak freeze ready this week" : "Freeze used this week"}
                </Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.levelName} numberOfLines={1}>{progress.level.name}</Text>
                <Text style={styles.statLabel}>level {progress.level.index + 1} of 8</Text>
                <View
                  style={styles.barTrack}
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel={`${progress.xp} XP. ${nextLevelLine(progress.level)}`}
                >
                  <View style={[styles.barFill, { width: `${Math.round(levelFraction(progress.level, progress.xp) * 100)}%` }]} />
                </View>
                <Text style={styles.statSub}>{progress.xp} XP</Text>
                <Text style={styles.statFoot}>{nextLevelLine(progress.level)}</Text>
              </Card>
            </View>

            {/* ── Today's drill ────────────────────────────────────────────── */}
            {drill && !showPicker ? (
              <Card style={playful ? { ...styles.card, ...styles.cardPlayful } : styles.card}>
                <Text style={[styles.eyebrow, playful && styles.eyebrowPlayful]}>
                  {playful ? "Today's singing game" : `Today's drill · ${drill.levelName}`}
                </Text>
                <Text style={[styles.cardTitle, playful && styles.cardTitlePlayful]}>{drill.title}</Text>
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
                  <Button label="Marking your take…" icon="hourglass-outline" loading />
                ) : (
                  <View style={styles.actions}>
                    <Button label={playful ? "Listen" : "Hear it"} icon="volume-high-outline" variant="secondary" onPress={hear} style={styles.action} />
                    <Button
                      label={playful ? (grade ? "Again!" : "Sing it!") : grade ? "Sing it again" : "Sing it"}
                      icon="mic"
                      onPress={() => void sing()}
                      disabled={left === 0}
                      style={styles.action}
                    />
                  </View>
                )}

                {left != null ? (
                  <Text style={styles.allowance}>
                    {left === 0
                      ? "That's today's marked drills done. Come back tomorrow."
                      : `${left} of ${allowance!.limit} marked drills left today`}
                  </Text>
                ) : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
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

            {/* ── This week ────────────────────────────────────────────────── */}
            <Card style={styles.card}>
              <View style={styles.weekRow}>
                <GoalRing fraction={weeklyFraction(progress.weeklyGoal)} styles={styles} colors={colors} />
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
                {sortBadges(progress.badges).map((b, i) => (
                  <Sticker key={b.code} badge={b} index={i} styles={styles} colors={colors} />
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
                  <BadgeTile key={b.code} badge={b} styles={styles} colors={colors} />
                ))}
              </View>
            )}

            <Text style={styles.foot}>
              {playful
                ? `Every singing game earns XP and stars. Up to ${progress.dailyXpCap} XP a day.`
                : `Practice counts when a take is marked: the daily drill, Sing it, or Learn my part. Up to ${progress.dailyXpCap} XP a day.`}
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
            {
              opacity: toastAnim,
              transform: [{ translateY: reduceMotion ? 0 : toastAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
            },
          ]}
        >
          <Ionicons name="sparkles" size={16} color={colors.premium} />
          <Text style={styles.toastText}>{toast}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function GoalRing({ fraction, styles, colors }: { fraction: number; styles: Styles; colors: Palette }) {
  const size = 64;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <View style={styles.ring} accessible accessibilityRole="progressbar" accessibilityLabel={`Weekly goal ${Math.round(fraction * 100)} percent`}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceAlt} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.success}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={styles.ringText}>{Math.round(fraction * 100)}%</Text>
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
          day.status === "frozen" && { borderColor: colors.accentAlt },
          day.status === "today" && { borderColor: colors.text, borderStyle: "dashed" },
          day.status === "none" && { opacity: 0.4 },
        ]}
      >
        {day.status === "done" ? <Ionicons name="checkmark" size={14} color={colors.onAccent} /> : null}
        {day.status === "frozen" ? <Ionicons name="snow-outline" size={13} color={colors.accentAlt} /> : null}
      </View>
      <Text style={styles.dayLetter}>{weekdayLetter(day.date)}</Text>
    </View>
  );
}

function BadgeTile({ badge, styles, colors }: { badge: PracticeBadge; styles: Styles; colors: Palette }) {
  const icon = BADGE_ICONS[badge.code] ?? "ribbon";
  return (
    <View
      style={[styles.badge, !badge.earned && styles.badgeLocked]}
      accessible
      accessibilityLabel={`${badge.title}. ${badge.description} ${badge.earned ? "Earned." : `${badge.progress} of ${badge.target}.`}`}
    >
      <View style={[styles.badgeIcon, badge.earned && { backgroundColor: colors.premiumSoft, borderColor: colors.premiumBorder }]}>
        <Ionicons name={badge.earned ? icon : (`${icon}-outline` as IconName)} size={20} color={badge.earned ? colors.premium : colors.textFaint} />
      </View>
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

/** Playful's sticker fills, in turn: deep enough for the white icon and edge in Night and Day alike. */
const STICKER_FILLS = ["ink", "premiumDeep", "danger", "purpleDark"] as const;

function Sticker({ badge, index, styles, colors }: { badge: PracticeBadge; index: number; styles: Styles; colors: Palette }) {
  const icon = BADGE_ICONS[badge.code] ?? "ribbon";
  return (
    <View
      style={styles.sticker}
      accessible
      accessibilityLabel={`${badge.title} sticker. ${badge.description} ${badge.earned ? "Earned." : `${badge.progress} of ${badge.target}.`}`}
    >
      {badge.earned ? (
        <View style={[styles.stickerDisc, { backgroundColor: colors[STICKER_FILLS[index % STICKER_FILLS.length]!], transform: [{ rotate: `${stickerTilt(badge.code)}deg` }] }]}>
          <Ionicons name={icon} size={30} color={colors.onInk} />
        </View>
      ) : (
        <View style={styles.stickerSlot}>
          <Ionicons name={`${icon}-outline` as IconName} size={26} color={colors.textFaint} />
        </View>
      )}
      <Text style={styles.stickerTitle} numberOfLines={2}>{badge.title}</Text>
      {!badge.earned ? <Text style={styles.badgeCount}>{badge.progress}/{badge.target}</Text> : null}
    </View>
  );
}

function BadgeRow({ badge, first, styles, colors }: { badge: PracticeBadge; first: boolean; styles: Styles; colors: Palette }) {
  const icon = BADGE_ICONS[badge.code] ?? "ribbon";
  return (
    <View
      style={[styles.badgeRow, !first && styles.badgeRowRule]}
      accessible
      accessibilityLabel={`${badge.title}. ${badge.description} ${badge.earned ? "Earned." : `${badge.progress} of ${badge.target}.`}`}
    >
      <Ionicons name={badge.earned ? icon : (`${icon}-outline` as IconName)} size={18} color={badge.earned ? colors.premium : colors.textFaint} />
      <View style={styles.badgeRowText}>
        <Text style={[styles.badgeTitle, !badge.earned && { color: colors.textMuted }]}>{badge.title}</Text>
        <Text style={styles.badgeDesc} numberOfLines={1}>{badge.description}</Text>
      </View>
      <Text style={styles.badgeRowCount}>{badge.earned ? "Earned" : `${badge.progress}/${badge.target}`}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
    screen: { paddingBottom: spacing.xxxl },
    headerRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm, marginBottom: spacing.xl },
    backCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    titleBlock: { flex: 1, marginHorizontal: spacing.md },
    titleLabel: { ...typography.caption, color: c.textFaint, textTransform: "uppercase", letterSpacing: 1, fontSize: 10 },
    titleMain: { ...typography.title, color: c.text, fontSize: 22, letterSpacing: -0.4, marginTop: 1 },
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
    trackPillPlayful: { borderColor: c.premiumBorder, backgroundColor: c.premiumSoft },
    trackPillText: { ...typography.label, color: c.text, fontSize: 13 },

    buddy: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
    buddyFace: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.premiumSoft,
      borderWidth: 1.5,
      borderColor: c.premiumBorder,
    },
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
    loading: { marginTop: spacing.xxl },
    card: { marginBottom: spacing.md, gap: spacing.sm },
    cardPlayful: { borderColor: c.premiumBorder, borderWidth: 1.5 },
    body: { ...typography.body, color: c.textMuted, fontSize: 13, lineHeight: 20 },

    statsRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
    statCard: { flex: 1, gap: 2 },
    statHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    statBig: { ...typography.title, color: c.text, fontSize: 30 },
    levelName: { ...typography.title, color: c.text, fontSize: 24 },
    statLabel: { ...typography.caption, color: c.textMuted },
    statSub: { ...typography.label, color: c.text, fontSize: 13, marginTop: spacing.xs },
    statFoot: { ...typography.caption, color: c.textFaint, fontSize: 11 },
    barTrack: { height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: "hidden", marginTop: spacing.sm },
    barFill: { height: 8, borderRadius: 4, backgroundColor: c.accent },

    eyebrow: { ...typography.caption, color: c.accent, textTransform: "uppercase", letterSpacing: 1, fontSize: 10 },
    eyebrowPlayful: { color: c.premium },
    cardTitle: { ...typography.label, color: c.text, fontSize: 15, fontFamily: fonts.bold },
    cardTitlePlayful: { ...typography.heading, fontSize: 20 },
    meta: { ...typography.caption, color: c.textMuted, lineHeight: 17 },
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
      borderColor: c.premiumBorder,
      backgroundColor: c.premiumSoft,
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
    error: { ...typography.caption, color: c.danger },
    focusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap" },
    focusTuning: { ...typography.label, color: c.textMuted, fontSize: 13 },

    weekRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    weekText: { flex: 1, gap: 2 },
    ring: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
    ringText: { ...typography.caption, color: c.text, position: "absolute", fontFamily: fonts.semibold },
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
    badgeIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: 2,
    },
    badgeTitle: { ...typography.label, color: c.text, fontSize: 13 },
    badgeDesc: { ...typography.caption, color: c.textMuted, fontSize: 11, lineHeight: 15 },
    badgeProgressRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: 2 },
    badgeTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.surfaceAlt, overflow: "hidden" },
    badgeFill: { height: 4, borderRadius: 2, backgroundColor: c.textMuted },
    badgeCount: { ...typography.caption, color: c.textFaint, fontSize: 10 },

    stickerGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.md },
    sticker: { width: "33.33%", paddingHorizontal: spacing.xs, alignItems: "center", gap: 6 },
    stickerDisc: {
      width: 68,
      height: 68,
      borderRadius: 34,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 4,
      borderColor: "#FFFFFF", // the sticker's white peel edge, in either theme
      shadowColor: "#000000",
      shadowOpacity: 0.25,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    stickerSlot: {
      width: 68,
      height: 68,
      borderRadius: 34,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderStyle: "dashed",
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
    },
    stickerTitle: { ...typography.caption, color: c.text, textAlign: "center", fontFamily: fonts.semibold, lineHeight: 15 },

    badgeList: { overflow: "hidden" },
    badgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minHeight: 48 },
    badgeRowRule: { borderTopWidth: 1, borderTopColor: c.border },
    badgeRowText: { flex: 1 },
    badgeRowCount: { ...typography.caption, color: c.textFaint, fontFamily: fonts.medium },

    foot: { ...typography.caption, color: c.textFaint, lineHeight: 17, marginTop: spacing.lg },
    toast: {
      position: "absolute",
      left: spacing.lg,
      right: spacing.lg,
      bottom: spacing.xxl,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.pill,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.premiumBorder,
    },
    toastText: { ...typography.label, color: c.text, flex: 1 },
  });
