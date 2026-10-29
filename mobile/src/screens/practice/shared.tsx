/**
 * What the practice mode screens share: loading a mode's exercises, sending a take to be marked (and everything a
 * marked take does on the phone), the footer the actions sit in, and the small pieces every board draws the same way.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { practiceApi } from "../../api/endpoints";
import { toApiError } from "../../api/client";
import type { PracticeExercise, PracticeMode, PracticeModeGrade, PracticeModeId, PracticeTrack } from "../../api/types";
import { Button } from "../../components/Button";
import { ProblemNote } from "../../components/ProblemNote";
import { MarkingBar } from "../../components/practice/MarkingBar";
import { ModeHeader } from "../../components/practice/ModeHeader";
import { ModePath } from "../../components/practice/ModePath";
import { Screen } from "../../components/Screen";
import { showToast } from "../../lib/toast";
import { logAnalyticsEvent } from "../../lib/analytics";
import { countInFor, takeClip } from "../../lib/modeAudio";
import { allowanceLine } from "../../lib/practiceProgress";
import { acknowledgeGrade } from "../../lib/practiceReward";
import { modePath, modeTitle, pathStarsLabel, takeSeconds, unitJustCompleted, type ModePath as Path } from "../../lib/practiceModes";
import { MicDenied, type useModeTake } from "../../lib/useModeTake";
import { fonts, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";

type Take = ReturnType<typeof useModeTake>;

/** A mode's exercises for today, loaded on arrival; `refresh` re-reads them quietly after a mark (best scores, allowance). */
export function useModeExercises(mode: Exclude<PracticeModeId, "warm-up">) {
  const [data, setData] = useState<PracticeMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const m = await practiceApi.mode(mode);
      if (!live.current) return;
      setData(m);
      setError(null);
    } catch (e) {
      if (live.current && !quiet) setError(toApiError(e).message);
    } finally {
      if (live.current) setLoading(false);
    }
  }, [mode]);

  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: () => load(false), refresh: () => load(true) };
}

/**
 * Sings one take of an exercise: the count-in and what the mode plays under the singer, recorded, sent and marked by
 * the server. Returns the mark and the take's uri, or null when cancelled; a refusal comes back as a plain sentence.
 */
export function useGrade(take: Take) {
  const [error, setError] = useState<string | null>(null);
  const sing = useCallback(async (ex: PracticeExercise, headphones = false): Promise<{ grade: PracticeModeGrade; uri: string } | null> => {
    setError(null);
    const countIn = countInFor(ex);
    try {
      void logAnalyticsEvent("practice_mode_started", { mode: ex.mode, exercise: ex.id });
      const got = await take.record({
        // Built once the button shows its spinner: synthesising it first held the tap with nothing on screen.
        clipBase64: () => takeClip(ex, countIn, headphones),
        leadInSec: countIn.seconds,
        seconds: takeSeconds(ex, countIn.seconds),
        send: (uri) => practiceApi.gradeMode(uri, ex.id, countIn.seconds),
      });
      if (!got) return null;
      acknowledgeGrade({ score: got.value.score, reward: got.value.reward });
      void logAnalyticsEvent("practice_mode_marked", { mode: ex.mode, exercise: ex.id, score: got.value.score });
      return { grade: got.value, uri: got.uri };
    } catch (e) {
      setError(e instanceof MicDenied ? e.message : toApiError(e).message);
      return null;
    }
  }, [take]);
  return { sing, error, setError };
}

/** The actions at the foot of a mode's screen, above the home indicator; `status` sits at the left ("● Listening"). */
export function ModeFooter({
  status,
  marking = false,
  children,
}: {
  status?: React.ReactNode;
  /** A take is being marked: the moving bar under the row, the footer's full width (board m-ux-medium P5a). */
  marking?: boolean;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <View style={styles.footerRow}>
        {status ? <View style={styles.status}>{status}</View> : <View style={styles.status} />}
        <View style={styles.actions}>{children}</View>
      </View>
      {marking ? <MarkingBar /> : null}
    </View>
  );
}

/** "● Listening": the microphone is on (the one red dot the app keeps for a live recording). */
export function LiveDot({ label }: { label: string }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.liveRow} accessibilityLiveRegion="polite">
      <View style={[styles.dot, { backgroundColor: c.danger }]} />
      <Text style={styles.liveText}>{label}</Text>
    </View>
  );
}

/** Loading, a failure to load, or the day's allowance and any problem with the last take. */
export function ModeState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  if (loading) return <ActivityIndicator color={c.accent} style={styles.loading} />;
  if (!error) return null;
  return (
    <View style={styles.failed}>
      <ProblemNote>{error}</ProblemNote>
      <Button label="Try again" icon="retry" variant="secondary" onPress={onRetry} />
    </View>
  );
}

export function AllowanceLine({ data }: { data: PracticeMode | null }) {
  const styles = useThemedStyles(makeStyles);
  if (!data) return null;
  return <Text style={styles.allowance}>{allowanceLine(data.allowance)}</Text>;
}

/** Whether the day's marked drills are all used (a take would be refused). */
export function noneLeft(data: PracticeMode | null): boolean {
  return !!data && data.allowance.used >= data.allowance.limit;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    pathScreen: { flex: 1, backgroundColor: c.bg },
    pathContent: { paddingBottom: spacing.xl },
    footer: {
      gap: spacing.sm,
      paddingTop: spacing.md,
      paddingHorizontal: spacing.lg,
      backgroundColor: c.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    footerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    status: { flex: 1, minWidth: 0 },
    actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    liveRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    dot: { width: 9, height: 9, borderRadius: 5 },
    liveText: { fontFamily: fonts.medium, fontSize: 14, color: c.textMuted },
    loading: { marginTop: spacing.xxl },
    failed: { gap: spacing.md, marginTop: spacing.lg },
    allowance: { ...typography.caption, color: c.textMuted, marginTop: spacing.sm },
  });

/**
 * Every marked mode opens on its path (`ModePathView`); a stop opens its exercise and the exercise's back button returns
 * to the path. A take that stars a unit's last stop says so once ("Unit done!"), when the marks are read again.
 */
export function useModePath(data: PracticeMode | null, mode: Exclude<PracticeModeId, "warm-up">, track: PracticeTrack | null) {
  const [onPath, setOnPath] = useState(true);
  const title = modeTitle(mode, track);
  const path = useMemo(() => modePath(data?.exercises ?? [], title), [data, title]);
  const before = useRef<Path | null>(null);
  useEffect(() => {
    if (!data) return;
    const done = unitJustCompleted(before.current, path);
    if (done) showToast(`Unit done! ${done.title}`);
    before.current = path;
  }, [data, path]);
  return { onPath, setOnPath, path, title };
}

/** The path screen: the mode's name, its stars, the day's allowance, and its units of stops. */
export function ModePathView({
  title,
  path,
  data,
  loading,
  error,
  onRetry,
  onOpen,
}: {
  title: string;
  path: Path;
  data: PracticeMode | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (index: number) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.pathScreen}>
      <Screen scroll contentStyle={styles.pathContent}>
        <ModeHeader eyebrow="Path" title={title} pill={data ? pathStarsLabel(path) : null} />
        <ModeState loading={loading && !data} error={data ? null : error} onRetry={onRetry} />
        <AllowanceLine data={data} />
        {data ? <ModePath path={path} onOpen={onOpen} /> : null}
      </Screen>
    </View>
  );
}
