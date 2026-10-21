/**
 * Learn my part — a choir singer's practice on one screen: pick the part, hear it loud with the
 * others soft (or alone, or all equal), tap two bars to loop them, slow them down, then sing them
 * back and see every note marked on the part itself. It drives the sheet's one player (`usePractice`);
 * the screen renders the mix and the slower tempo (lib/practice.ts) into it while this is open.
 *
 * Practising is free wherever the parts show; marking a take is Pro, as Sing is. The take is a
 * count-in and then the singer alone: the grader follows one pitch, and a piano coming back into
 * the microphone would be a second one.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "../Icon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { File, Paths } from "expo-file-system";
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
} from "expo-audio";

import { Button } from "../Button";
import { Touchable } from "../Touchable";
import { transcriptionsApi } from "../../api/endpoints";
import { toApiError } from "../../api/client";
import type { GradeResult, NoteEvent } from "../../api/types";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import type { VoiceName } from "../../lib/choir";
import { leadInFor, noteDueAt } from "../../lib/take";
import { logAnalyticsEvent } from "../../lib/analytics";
import * as haptics from "../../lib/haptics";
import { acknowledgeGrade } from "../../lib/practiceReward";
import { rewardMoment } from "../../lib/practiceProgress";
import { markGlyph } from "../../lib/markShape";
import {
  bars as barStrip,
  gradeTarget,
  marksByNote,
  practiceTempo,
  sliceBars,
  sliceSeconds,
  TAIL_SEC,
  tapBar,
  tooLong,
  type Balance,
  type BarSlice,
} from "../../lib/practice";
import type { Practice } from "./usePractice";
import { ProblemNote } from "../ProblemNote";
import { MarkingBar } from "../practice/MarkingBar";

const RECORDING = { ...RecordingPresets.HIGH_QUALITY, sampleRate: 22050, numberOfChannels: 1 };
const BALANCE_LABELS: { value: Balance; label: string }[] = [
  { value: "balance", label: "Mine loud" },
  { value: "alone", label: "Mine alone" },
  { value: "equal", label: "All equal" },
];
const NAMES: Record<VoiceName, string> = { soprano: "Soprano (the tune)", alto: "Alto", tenor: "Tenor", bass: "Bass" };

type Phase = "idle" | "leadin" | "singing" | "grading";
type Styles = ReturnType<typeof makeStyles>;

/** One choice of a few, as the night design draws a segmented control. */
function Segment<T extends string | number>({
  options,
  value,
  onChange,
  label,
  busy,
  styles,
}: {
  options: { value: T; label: string; a11y?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  busy: boolean;
  styles: Styles;
}) {
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.seg} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Touchable
              key={String(o.value)}
              onPress={() => { if (!busy && !on) { haptics.play("light"); onChange(o.value); } }}
              style={[styles.segItem, on && styles.segItemOn]}
              radius={9}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: busy }}
              accessibilityLabel={o.a11y ?? o.label}
            >
              <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
            </Touchable>
          );
        })}
      </View>
    </View>
  );
}


export function PracticeView({
  onClose,
  onRehearse,
  practice: p,
  names,
  part,
  onPart,
  balance,
  onBalance,
  speed,
  speeds,
  onSpeed,
  partNotes,
  tempo,
  timeSignature,
  barCount,
  isPro,
  onRequirePro,
  sheetId,
}: {
  onClose: () => void;
  /** Rehearse the whole sheet (every part, any speed): the dock's Practise opens this view, so Rehearse is here. */
  onRehearse: () => void;
  practice: Practice;
  names: readonly VoiceName[];
  part: VoiceName;
  onPart: (v: VoiceName) => void;
  balance: Balance;
  onBalance: (b: Balance) => void;
  speed: number;
  speeds: readonly number[];
  onSpeed: (s: number) => void;
  /** The chosen part's notes, labelled from the soprano's doh. */
  partNotes: readonly NoteEvent[];
  /** The sheet's tempo (the player runs at it times `speed`). */
  tempo: number;
  timeSignature: string;
  barCount: number;
  isPro: boolean;
  onRequirePro: () => void;
  /** The saved sheet this is, so the practice is recorded against it; absent for an unsaved result. */
  sheetId?: string;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RECORDING);

  const [pending, setPending] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  /** The last take's verdict, with the part and bars it was sung against. */
  const [graded, setGraded] = useState<{ grade: GradeResult; marks: ReturnType<typeof marksByNote>; key: string } | null>(null);

  const take = useRef<{ slice: BarSlice; leadIn: number; tempo: number } | null>(null);
  const player = useRef<AudioPlayer | null>(null);
  const leadFile = useRef<File | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopAt = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const live = useRef(true);

  const rangeKey = `${part}:${p.loopFrom}-${p.loopTo}`;
  const marks = graded && graded.key === rangeKey ? graded.marks : null;
  const strip = useMemo(() => barStrip(partNotes, timeSignature, barCount), [partNotes, timeSignature, barCount]);
  const busy = phase !== "idle";
  const barNow = p.isPlaying && p.barSec > 0 ? p.barAt(p.position) : 0;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      cleanup();
      // Closed mid-take: the microphone is released and nothing is sent.
      take.current = null;
      try {
        void recorder.stop().catch(() => undefined);
      } catch {
        // already released with the view
      }
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    };
    // The recorder is this view's; it is released with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanup() {
    if (tick.current) clearInterval(tick.current);
    if (stopAt.current) clearTimeout(stopAt.current);
    tick.current = null;
    stopAt.current = null;
    try { player.current?.remove(); } catch { /* already released */ }
    player.current = null;
    try { if (leadFile.current?.exists) leadFile.current.delete(); } catch { /* already gone */ }
    leadFile.current = null;
  }

  function setRange(from: number, to: number) {
    p.setLoopFrom(from);
    p.setLoopTo(to);
  }

  function onBar(bar: number) {
    if (busy) return;
    haptics.play("light");
    const next = tapBar(pending, bar);
    setPending(next.pending);
    setRange(next.range.from, next.range.to);
    if (next.pending == null) void logAnalyticsEvent("practice_loop_set", { bars: next.range.to - next.range.from + 1 });
  }

  async function sing() {
    if (busy) return;
    if (!isPro) {
      void logAnalyticsEvent("practice_sing_locked");
      onRequirePro();
      return;
    }
    setStatus(null);
    const slice = sliceBars(partNotes, p.loopFrom, p.loopTo, timeSignature);
    if (slice.notes.length === 0) {
      setStatus("There is nothing to sing in these bars. Choose bars with notes in your part.");
      return;
    }
    const playTempo = practiceTempo(tempo, speed);
    const lead = leadInFor(slice.notes, playTempo, timeSignature);
    if (tooLong(slice, tempo, speed, lead.seconds)) {
      setStatus("That is more than two minutes to sing. Loop fewer bars, or a faster speed, and try again.");
      return;
    }
    p.pause();
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { setStatus("Microphone permission is needed to record a take."); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldRouteThroughEarpiece: false });
      take.current = { slice, leadIn: lead.seconds, tempo: playTempo };
      const file = new File(Paths.cache, `notefusion-practice-leadin-${Date.now()}.wav`);
      file.write(lead.wavBase64, { encoding: "base64" });
      leadFile.current = file;
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      player.current = createAudioPlayer({ uri: file.uri });
      player.current.play();
      setPhase("leadin");
      setElapsed(0);
      void logAnalyticsEvent("practice_take_started", { part });
      tick.current = setInterval(() => {
        const t = (Date.now() - startedAt.current) / 1000;
        setElapsed(t);
        if (t >= lead.seconds) setPhase((ph) => (ph === "leadin" ? "singing" : ph));
      }, 100);
      const total = lead.seconds + sliceSeconds(slice, tempo, speed) + TAIL_SEC;
      stopAt.current = setTimeout(() => void finish(), total * 1000);
    } catch (e) {
      cleanup();
      setPhase("idle");
      if (__DEV__) console.warn("[practice] start failed", e);
      setStatus("Could not start recording. Please try again.");
    }
  }

  async function finish() {
    const t = take.current;
    cleanup();
    if (!t) return;
    setPhase("grading");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) throw new Error("The recording was lost.");
      const grade = await transcriptionsApi.grade(uri, "take.m4a", gradeTarget(t.slice, tempo, speed, t.leadIn), {
        transcriptionId: sheetId,
        part,
      });
      if (!live.current) return;
      setGraded({ grade, marks: marksByNote(grade, t.slice), key: rangeKey });
      setPhase("idle");
      acknowledgeGrade(grade);
      void logAnalyticsEvent("practice_take_marked", { part, score: grade.score });
    } catch (e) {
      if (!live.current) return;
      setPhase("idle");
      setStatus(toApiError(e).message);
    }
  }

  function cancel() {
    cleanup();
    take.current = null;
    void recorder.stop().catch(() => undefined);
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    setPhase("idle");
  }

  const statusColor = (s: string) =>
    s === "hit" ? colors.successText : s === "near" ? colors.warningText : s === "wrong" ? colors.textMuted : colors.textFaint;
  const t = take.current;
  const due = phase === "singing" && t ? noteDueAt(t.slice.notes, t.tempo, t.leadIn, elapsed) : -1;
  const first = t?.slice.notes[0];
  const syl = (n: NoteEvent | undefined) => (n ? `${n.solfa}${n.octaveMark}` : "");
  const rangeText = `${p.loopFrom === p.loopTo ? `Bar ${p.loopFrom}` : `Bars ${p.loopFrom}–${p.loopTo}`} of ${barCount}`;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <ScrollView
          contentContainerStyle={[styles.body, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Touchable onPress={onClose} style={styles.iconBtn} radius={20} accessibilityRole="button" accessibilityLabel="Close Learn my part">
              <Icon name="down" size={20} color={colors.text} />
            </Touchable>
            <Text style={styles.title}>Learn my part</Text>
            <View style={styles.iconSpacer} />
          </View>

          <Segment
            label="MY PART"
            options={names.map((v) => ({ value: v, label: v[0]!.toUpperCase(), a11y: NAMES[v] }))}
            value={part}
            onChange={onPart}
            busy={busy}
            styles={styles}
          />
          <Segment label="HEAR" options={BALANCE_LABELS} value={balance} onChange={onBalance} busy={busy} styles={styles} />
          <Segment
            label="SPEED"
            options={speeds.map((s) => ({ value: s, label: `${Math.round(s * 100)}%` }))}
            value={speed}
            onChange={onSpeed}
            busy={busy}
            styles={styles}
          />

          <View style={styles.loopHead}>
            <Text style={styles.label}>LOOP</Text>
            <Text style={styles.range} accessibilityLiveRegion="polite">{rangeText}</Text>
            <Touchable
              onPress={() => { if (!busy) { setPending(null); setRange(1, barCount); } }}
              disabled={busy || (p.loopFrom === 1 && p.loopTo === barCount)}
              style={styles.whole}
              radius={10}
              accessibilityRole="button"
            >
              <Text style={styles.wholeText}>Whole tune</Text>
            </Touchable>
          </View>
          <Text style={styles.hint}>
            {pending != null ? "Now tap the last bar to loop." : "Tap a bar, then another, to loop the bars between them."}
          </Text>
          <View style={styles.bars}>
            {strip.map((b) => {
              const inside = b.bar >= p.loopFrom && b.bar <= p.loopTo;
              const text = b.notes.map((x) => syl(x.note)).join(" ");
              return (
                <Touchable
                  key={b.bar}
                  onPress={() => onBar(b.bar)}
                  style={[styles.bar, inside && styles.barIn, b.bar === pending && styles.barPending, b.bar === barNow && styles.barNow]}
                  radius={10}
                  accessibilityRole="button"
                  accessibilityState={{ selected: inside }}
                  accessibilityLabel={`Bar ${b.bar}${text ? `: ${text}` : ", rest"}`}
                >
                  <Text style={styles.barNum}>{b.bar}</Text>
                  <Text style={styles.barNotes}>
                    {b.notes.length === 0
                      ? "–"
                      : b.notes.map((x, k) => {
                          const m = marks?.[x.i];
                          return (
                            <Text
                              key={x.i}
                              style={m ? [styles.markNote, { color: statusColor(m.status) }, m.status === "wrong" && styles.struck] : undefined}
                            >
                              {syl(x.note)}
                              {m ? markGlyph(m.status) : ""}
                              {k < b.notes.length - 1 ? " " : ""}
                            </Text>
                          );
                        })}
                  </Text>
                </Touchable>
              );
            })}
          </View>

          {phase === "leadin" || phase === "singing" ? (
            <View style={styles.live} accessibilityLiveRegion="polite">
              <Text style={styles.liveLabel}>
                {phase === "leadin" ? `Starting note… sing in ${Math.max(0, Math.ceil((t?.leadIn ?? 0) - elapsed))}` : "Sing!"}
              </Text>
              <Text style={styles.liveNote}>{phase === "leadin" ? syl(first) : due >= 0 ? syl(t?.slice.notes[due]) : "·"}</Text>
              <Button label="Stop" variant="secondary" icon="stop" onPress={cancel} />
            </View>
          ) : (
            <View style={styles.transport}>
              <Button
                label={p.isPlaying ? "Pause" : "Play"}
                icon={p.isPlaying ? "pause" : "play"}
                onPress={() => void p.togglePlay()}
                disabled={!p.ready || busy}
                style={styles.transportBtn}
              />
              <Button
                label={phase === "grading" ? "Marking…" : "Sing it back"}
                variant="secondary"
                icon={isPro ? "mic" : "lock"}
                loading={phase === "grading"}
                onPress={() => void sing()}
                style={styles.transportBtn}
              />
            </View>
          )}
          {phase === "grading" ? <MarkingBar style={styles.marking} /> : null}

          {status ? <ProblemNote>{status}</ProblemNote> : null}

          {graded && marks ? (
            <View style={styles.result}>
              <View style={styles.scoreRow}>
                <Text
                  style={[
                    styles.score,
                    { color: graded.grade.score >= 80 ? colors.successText : graded.grade.score >= 50 ? colors.warningText : colors.textMuted },
                  ]}
                >
                  {graded.grade.score}
                </Text>
                <View style={styles.scoreText}>
                  <Text style={styles.summary}>{graded.grade.summary}</Text>
                  {graded.grade.octaveShift !== 0 ? (
                    <Text style={styles.meta}>Sung {graded.grade.octaveShift > 0 ? "an octave up" : "an octave down"} — that's fine.</Text>
                  ) : null}
                </View>
              </View>
              <Text style={styles.meta}>Marked on your part above: ✓ in tune · ~ close · struck through: off the note · – not sung.</Text>
              {rewardMoment(graded.grade.reward) ? (
                <Text style={styles.earned}>{rewardMoment(graded.grade.reward)!.line}</Text>
              ) : null}
              <Button label="Try again" icon="retry" onPress={() => void sing()} disabled={busy} style={styles.again} />
            </View>
          ) : null}

          <Touchable
            onPress={onRehearse}
            disabled={busy}
            style={styles.rehearse}
            radius={radii.md}
            accessibilityRole="button"
            accessibilityLabel="Rehearse: loop, slow down and choose the parts"
          >
            <Icon name="rehearse" size={20} color={colors.icon} />
            <View style={styles.rehearseText}>
              <Text style={styles.rehearseLabel}>Rehearse</Text>
              <Text style={styles.rehearseHint}>Loop, slow down and choose the parts</Text>
            </View>
            <Icon name="chevron" size={16} color={colors.textFaint} />
          </Touchable>

          <Text style={styles.foot}>
            You hear the starting note and a bar of clicks, then sing the bars on your own — the others drop out so only your voice is marked.
          </Text>
          {/* The hook's error can be a platform message; this says it plainly instead. */}
          {p.error ? <ProblemNote>This sheet could not be played. Close it and open it again.</ProblemNote> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    body: { flexGrow: 1, paddingHorizontal: 20 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: spacing.md },
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
    iconSpacer: { width: 40 },
    title: { flex: 1, textAlign: "center", fontFamily: fonts.semibold, fontSize: 17, color: c.text },
    block: { marginTop: spacing.md, gap: 6 },
    label: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.8, color: c.textMuted },
    seg: { flexDirection: "row", gap: 2, padding: 4, borderRadius: 12, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
    segItem: { flex: 1, minHeight: 38, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
    segItemOn: { backgroundColor: c.surface },
    segText: { fontFamily: fonts.semibold, fontSize: 14, color: c.textMuted },
    segTextOn: { color: c.text },
    loopHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg },
    range: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    whole: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
    wholeText: { fontFamily: fonts.semibold, fontSize: 13, color: c.text },
    hint: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 6, marginBottom: 8 },
    bars: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    bar: {
      width: "23.5%",
      minHeight: 54,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    barIn: { borderColor: c.ink, backgroundColor: c.accentSoft },
    barPending: { borderStyle: "dashed", borderWidth: 2 },
    barNow: { borderColor: c.ink, borderWidth: 2 },
    barNum: { fontFamily: fonts.semibold, fontSize: 10, color: c.textMuted },
    barNotes: { fontFamily: typography.mono.fontFamily, fontSize: 15, color: c.text, marginTop: 2 },
    markNote: { fontWeight: "700" },
    struck: { textDecorationLine: "line-through" },
    transport: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
    transportBtn: { flex: 1 },
    /** 8 px under the buttons while the take is marked (board m-ux-medium P5a). */
    marking: { marginTop: spacing.sm },
    live: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
    liveLabel: { ...typography.label, color: c.textMuted },
    liveNote: { ...typography.hero, color: c.accent },
    result: { marginTop: spacing.md, backgroundColor: c.surfaceAlt, borderRadius: radii.md, padding: spacing.md, gap: spacing.sm },
    scoreRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    score: { ...typography.display, minWidth: 64, textAlign: "center" },
    scoreText: { flex: 1 },
    summary: { ...typography.body, color: c.text, lineHeight: 20 },
    meta: { ...typography.caption, color: c.textMuted, lineHeight: 17 },
    earned: { ...typography.label, color: c.accent },
    again: { alignSelf: "flex-start" },
    rehearse: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      minHeight: 56,
      marginTop: spacing.lg,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    rehearseText: { flex: 1 },
    rehearseLabel: { fontFamily: fonts.medium, fontSize: 15, color: c.text },
    rehearseHint: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 2 },
    foot: { fontFamily: fonts.regular, fontSize: 12, color: c.textFaint, marginTop: spacing.lg, lineHeight: 17 },
  });
