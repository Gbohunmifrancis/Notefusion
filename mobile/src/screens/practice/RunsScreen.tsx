/**
 * Riffs & runs (board c-practice/6c): a run drawn as blocks with its solfa, heard and sung at 60–100 %. Up to the
 * speed where its quick notes still last 0.3 s it is marked note by note (the drill grader's marks and cents); past
 * that the server marks its shape and the note it lands on (the run grader), and the singer's own pitch line is drawn
 * over the pattern. A pass (80 or more) lights the speed and offers the next, as the path moves on.
 */

import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "../../components/Icon";
import type { PracticeExercise, PracticeModeGrade, PracticeTrack } from "../../api/types";
import { Screen } from "../../components/Screen";
import { Button } from "../../components/Button";
import { ProblemNote } from "../../components/ProblemNote";
import { Touchable } from "../../components/Touchable";
import { ModeHeader } from "../../components/practice/ModeHeader";
import { ModeResult } from "../../components/practice/ModeResult";
import { NoteRoll } from "../../components/practice/NoteRoll";
import { countInFor, hearClip } from "../../lib/modeAudio";
import {
  PASS_SCORE,
  firstOpenRun,
  markingBands,
  modeTitle,
  nextSpeed,
  noteDue,
  noteMarks,
  runAdvice,
  runRoll,
  runShapeLines,
  speedCaption,
  speedSteps,
  takeSeconds,
  traceOnRoll,
  unitRuns,
  written,
  type SpeedStep,
} from "../../lib/practiceModes";
import { rewardMoment } from "../../lib/practiceProgress";
import { useModeTake } from "../../lib/useModeTake";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { AllowanceLine, LiveDot, ModeFooter, ModeState, noneLeft, useGrade, useModeExercises, ModePathView, useModePath } from "./shared";

/** The exercise at one speed: the same notes, that speed's id, tempo and grader. */
function atSpeed(ex: PracticeExercise, s: SpeedStep): PracticeExercise {
  return { ...ex, id: s.exerciseId, tempoBpm: s.tempoBpm, grader: s.grader, speedPercent: s.percent, bestScore: s.bestScore };
}

export function RunsScreen({ track }: { track: PracticeTrack | null }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const take = useModeTake();
  const { sing, error } = useGrade(take);
  const { data, error: loadError, loading, reload, refresh } = useModeExercises("runs");
  const [code, setCode] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [grade, setGrade] = useState<PracticeModeGrade | null>(null);
  const [takeUri, setTakeUri] = useState<string | null>(null);

  const playful = (data?.track ?? track) === "playful";
  const exercises = data?.exercises ?? [];
  const ex = exercises.find((e) => e.code === code) ?? firstOpenRun(exercises) ?? undefined;
  const steps = ex ? speedSteps(ex) : [];
  // Open on the first speed not yet passed.
  const step = steps.find((s) => s.percent === percent) ?? steps.find((s) => !s.passed) ?? steps[steps.length - 1];
  const sung = ex && step ? atSpeed(ex, step) : null;
  const roll = ex ? runRoll(ex.notes) : null;
  const unit = ex ? unitRuns(exercises, ex) : [];
  const place = ex ? unit.findIndex((r) => r.code === ex.code) + 1 : 0;
  const busy = take.phase !== "idle";

  useEffect(() => { if (ex && code == null) setCode(ex.code); }, [ex, code]);

  const countInSec = sung ? countInFor(sung).seconds : 0;
  const due = sung && (take.phase === "live" || take.playing === "hear")
    ? noteDue(sung.notes, sung.tempoBpm, take.playing === "hear" ? take.elapsed : take.elapsed - countInSec)
    : -1;

  async function start() {
    if (!sung || !step) return;
    // The speed sung stays chosen: a pass refreshes the best marks, which must not move the stepper under the mark.
    setPercent(step.percent);
    setGrade(null);
    setTakeUri(null);
    take.stopPlaying();
    const got = await sing(sung);
    if (got) {
      setGrade(got.grade);
      setTakeUri(got.uri);
      void refresh();
    }
  }

  function hear(full = false) {
    if (!ex || !step) return;
    const s = full ? steps[steps.length - 1]! : step;
    if (take.playing) { take.stopPlaying(); return; }
    const clip = hearClip(atSpeed(ex, s));
    take.play(clip.wav, clip.seconds, full ? "full" : "hear");
  }

  function choose(p: number) {
    if (busy) return;
    take.stopPlaying();
    setGrade(null);
    setTakeUri(null);
    setPercent(p);
  }

  function openRun(c2: string) {
    take.stopPlaying();
    setGrade(null);
    setTakeUri(null);
    setPercent(null);
    setCode(c2);
  }

  const marked = grade && sung && step;
  const next = marked ? nextSpeed(steps, step.percent, grade.score) : null;
  const nextRun = ex ? unit.find((r, i) => i >= place && r.code !== ex.code) ?? unit.find((r) => r.code !== ex.code) : undefined;
  const advice = grade?.marks && sung ? runAdvice(grade.marks, sung.notes, next) : null;
  const landing = sung ? sung.notes[sung.notes.length - 1] ?? null : null;

  const pathState = useModePath(data, "runs", track);
  function backToPath() {
    if (take.phase !== "idle") take.cancel();
    take.stopPlaying();
    pathState.setOnPath(true);
  }
  if (pathState.onPath) {
    return (
      <ModePathView
        title={pathState.title}
        path={pathState.path}
        data={data}
        loading={loading}
        error={loadError}
        onRetry={reload}
        onOpen={(i) => { { const e = (data?.exercises ?? [])[i]; if (e) openRun(e.code); }; pathState.setOnPath(false); }}
      />
    );
  }

  return (
    <View style={styles.flex}>
      <Screen scroll contentStyle={styles.screen}>
        <ModeHeader onBack={backToPath} eyebrow={modeTitle("runs", track)} title={ex?.title ?? "Riffs & runs"} pill={ex?.dohHeader ?? null} />
        <ModeState loading={loading && !data} error={data ? null : loadError} onRetry={reload} />
        {ex && roll && step && sung ? (
          <>
            {ex.group ? <Text style={styles.where}>{ex.group} · {place} of {unit.length}</Text> : null}

            {grade?.run ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Your run, over the pattern</Text>
                <NoteRoll roll={roll} trace={traceOnRoll(grade.run.trace, roll, sung.tempoBpm)} label={`Your pitch line over ${ex.notes.map(written).join(" ")}`} />
                {runShapeLines(grade.run, landing).map((l, i) => (
                  <View key={i} style={styles.check}>
                    <Icon name={l.ok ? "done" : "step"} size={20} color={l.ok ? c.success : c.textMuted} />
                    <View style={styles.checkText}>
                      <Text style={styles.checkTitle}>{l.title}</Text>
                      <Text style={styles.checkSub}>{l.sub}</Text>
                    </View>
                  </View>
                ))}
                <View style={styles.earnedRow}>
                  <Icon name="reward" size={15} color={c.icon} />
                  <Text style={styles.earned}>
                    {[rewardMoment(grade.reward)?.line ?? `Score ${grade.score}`, grade.score >= PASS_SCORE ? "run learned" : null].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.rollBlock}>
                <NoteRoll roll={roll} active={due} label={`The run: ${ex.notes.map(written).join(" ")}`} />
                <View style={styles.solfaRow} accessible={false}>
                  {ex.notes.map((n, i) => (
                    <Text key={i} style={[styles.solfa, i === ex.notes.length - 1 && styles.solfaLand, i === due && styles.solfaOn]}>
                      {written(n)}
                    </Text>
                  ))}
                </View>
              </View>
            )}

            <View style={styles.speedHead}>
              <Text style={styles.speedLabel}>Speed</Text>
              <Text style={styles.speedCaption}>{speedCaption(step)}</Text>
            </View>
            <View style={styles.seg} accessibilityRole="radiogroup" accessibilityLabel="Speed">
              {steps.map((s) => {
                const on = s.percent === step.percent;
                return (
                  <Touchable
                    key={s.percent}
                    onPress={() => choose(s.percent)}
                    scaleTo={0.97}
                    radius={9}
                    ripple={false}
                    style={[styles.segItem, on && styles.segOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${s.label}${s.passed ? ", passed" : ""}`}
                  >
                    <Text style={[styles.segText, on && styles.segTextOn, s.passed && !on && styles.segDone]}>{s.label}</Text>
                    {s.passed ? <Icon name="check" size={11} strokeWidth={2.25} color={c.success} /> : null}
                  </Touchable>
                );
              })}
            </View>
            <View style={styles.bands}>
              {markingBands(steps).map((b) => (
                <View key={b.label} style={[styles.band, { flex: b.to - b.from + 1 }]}>
                  <View style={styles.bandLine} />
                  <Text style={styles.bandText} numberOfLines={1}>{b.label}</Text>
                </View>
              ))}
            </View>
            {!busy && !grade && step.percent !== 100 ? (
              <View style={styles.fullLink}>
                <Button label={take.playing === "full" ? "Stop" : "Hear it at 100%"} icon="hear" variant="text" size="sm" onPress={() => hear(true)} />
              </View>
            ) : null}

            {grade?.marks ? (
              <View style={styles.resultBlock}>
                <ModeResult
                  score={grade.score}
                  summary={grade.summary}
                  sub={grade.score >= PASS_SCORE ? `Clean at ${step.percent}%` : `At ${step.percent}%`}
                  marks={noteMarks(grade.marks, sung.notes).map((m) => ({ key: m.index, text: m.text, sub: m.cents, tone: m.tone }))}
                  legend={playful ? null : "✓ in tune · ~ close · struck through: off. Numbers are cents off."}
                  reward={grade.reward}
                  playful={playful}
                >
                  {!playful && takeUri ? (
                    <View style={styles.replayRow}><Button label={take.playing === "replay" ? "Stop" : "Replay my take"} icon={take.playing === "replay" ? "stop" : "play"} variant="text" size="sm" onPress={() => (take.playing ? take.stopPlaying() : take.replay(takeUri, takeSeconds(sung, countInSec)))} /></View>
                  ) : null}
                </ModeResult>
                {advice && (advice.lead || advice.rest) ? (
                  <Text style={styles.advice}>
                    {advice.lead ? <Text style={styles.adviceLead}>{advice.lead} </Text> : null}
                    {advice.rest}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {error ? <ProblemNote>{error}</ProblemNote> : null}
            {!busy ? <AllowanceLine data={data} /> : null}

            {!busy && unit.length > 1 ? (
              <>
                <Text style={styles.section}>{grade ? "Next in this unit" : "In this unit"}</Text>
                <View style={styles.list}>
                  {(grade && nextRun ? [nextRun] : unit).map((r) => (
                    <Touchable key={r.code} onPress={() => openRun(r.code)} scaleTo={0.99} accessibilityLabel={`${r.title}: ${r.solfa}. ${r.state}`}>
                      <View style={styles.row}>
                        <Text style={[styles.rowTitle, r.state === "current" && styles.rowTitleOn]} numberOfLines={1}>{r.title}</Text>
                        <Text style={styles.rowSolfa} numberOfLines={1}>{r.solfa}</Text>
                        {r.state === "learned" ? (
                          <Icon name="done" size={18} color={c.success} />
                        ) : r.state === "current" ? (
                          <View style={styles.dotOn} />
                        ) : (
                          <View style={[styles.dotOff, r.state === "started" && styles.dotStarted]} />
                        )}
                      </View>
                    </Touchable>
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </Screen>
      {ex && sung ? (
        <ModeFooter marking={take.phase === "sending"} status={take.phase === "leadin" || take.phase === "live" ? <LiveDot label={take.phase === "leadin" ? `Starting in ${Math.max(1, Math.ceil(countInSec - take.elapsed))}` : "Sing!"} /> : null}>
          {take.phase === "leadin" || take.phase === "live" ? (
            <Button label="Stop" icon="stop" variant="secondary" onPress={take.cancel} />
          ) : take.phase === "sending" ? (
            <Button label="Marking…" loading />
          ) : grade ? (
            <>
              <Button label="Again" variant="secondary" onPress={() => void start()} loading={take.starting} disabled={noneLeft(data)} />
              {next ? (
                <Button label={`Try ${next.percent}%`} onPress={() => choose(next.percent)} />
              ) : nextRun ? (
                <Button label="Next run" onPress={() => openRun(nextRun.code)} />
              ) : null}
            </>
          ) : (
            <>
              <Button label={take.playing === "hear" ? "Stop" : "Hear it"} icon={take.playing === "hear" ? "stop" : "hear"} variant="secondary" onPress={() => hear(false)} />
              <Button label="Sing it" icon="mic" onPress={() => void start()} loading={take.starting} disabled={noneLeft(data)} />
            </>
          )}
        </ModeFooter>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
    screen: { paddingBottom: spacing.xl },
    where: { fontFamily: fonts.regular, fontSize: 14, color: c.textMuted, marginBottom: spacing.md },
    rollBlock: { gap: spacing.sm },
    solfaRow: { flexDirection: "row", gap: 10, paddingHorizontal: spacing.sm, alignItems: "baseline" },
    solfa: { ...typography.mono, fontSize: 20, color: c.text },
    solfaLand: { marginLeft: spacing.sm },
    solfaOn: { color: c.link },
    card: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
    cardTitle: { fontFamily: fonts.semibold, fontSize: 16, color: c.text },
    check: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
    checkText: { flex: 1 },
    checkTitle: { fontFamily: fonts.medium, fontSize: 16, color: c.text },
    checkSub: { fontFamily: fonts.regular, fontSize: 14, color: c.textMuted, marginTop: 2 },
    earned: { fontFamily: fonts.semibold, fontSize: 14, color: c.text },
    speedHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: spacing.xl, marginBottom: spacing.sm },
    speedLabel: { fontFamily: fonts.medium, fontSize: 14, color: c.textMuted },
    speedCaption: { fontFamily: fonts.regular, fontSize: 14, color: c.textMuted },
    seg: { flexDirection: "row", gap: 2, padding: 4, borderRadius: 12, backgroundColor: c.surfaceAlt },
    segItem: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: "center", justifyContent: "center" },
    segOn: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    segText: { fontFamily: fonts.semibold, fontSize: 14, color: c.textMuted },
    segTextOn: { color: c.text },
    segDone: { color: c.successText },
    bands: { flexDirection: "row", gap: 6, marginTop: 6 },
    band: { alignItems: "center" },
    bandLine: { alignSelf: "stretch", height: 6, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: c.border, marginHorizontal: 4 },
    bandText: { fontFamily: fonts.regular, fontSize: 12, color: c.textFaint, marginTop: 4 },
    resultBlock: { gap: spacing.md, marginTop: spacing.lg },
    advice: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 21, color: c.textMuted },
    adviceLead: { fontFamily: fonts.semibold, color: c.text },
    section: { fontFamily: fonts.semibold, fontSize: 13, color: c.textFaint, marginTop: spacing.xl, marginBottom: spacing.sm },
    list: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radii.md, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 54, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    rowTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 16, color: c.text },
    rowTitleOn: { color: c.link },
    rowSolfa: { ...typography.mono, fontSize: 13, color: c.textMuted, maxWidth: "45%" },
    dotOn: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.primary, marginHorizontal: 4 },
    dotOff: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: c.textFaint, marginHorizontal: 3 },
    dotStarted: { borderColor: c.link },
    fullLink: { alignItems: "flex-end", marginTop: spacing.xs },
    earnedRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    replayRow: { alignItems: "flex-start" },
  });
