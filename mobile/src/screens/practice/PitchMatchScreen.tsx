/**
 * Pitch match (board c-practice/6b) on the phone: eight notes in one timed take, each heard (the app plays its tone)
 * and then held for four beats, and the whole set marked once by the server (one of the day's marked drills): the
 * score, "6 of 8 notes spot on, 2 close.", every note's mark and cents, and one suggestion drawn from the marks.
 *
 * Hold and mark, no live needle: a phone has no pitch stream until a store build adds one (the web has the needle).
 * While the set runs, the screen shows the note in hand, whether to listen or hold, and the hold filling.
 */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "../../components/Icon";
import type { PracticeExercise, PracticeModeGrade, PracticeTrack } from "../../api/types";
import { Screen } from "../../components/Screen";
import { Button } from "../../components/Button";
import { ProblemNote } from "../../components/ProblemNote";
import { Touchable } from "../../components/Touchable";
import { ModeHeader } from "../../components/practice/ModeHeader";
import { ModeResult } from "../../components/practice/ModeResult";
import { hearClip, countInFor } from "../../lib/modeAudio";
import {
  modeTitle,
  noteCaption,
  noteMarks,
  pitchAdvice,
  pitchMomentAt,
  pitchSlots,
  flatKey,
  written,
} from "../../lib/practiceModes";
import { tuningLine } from "../../lib/practiceTrack";
import { useModeTake } from "../../lib/useModeTake";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { AllowanceLine, LiveDot, ModeFooter, ModeState, noneLeft, useGrade, useModeExercises } from "./shared";

export function PitchMatchScreen({ track }: { track: PracticeTrack | null }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const take = useModeTake();
  const { sing, error } = useGrade(take);
  const { data, error: loadError, loading, reload, refresh } = useModeExercises("pitch-match");
  const [index, setIndex] = useState(0);
  const [grade, setGrade] = useState<PracticeModeGrade | null>(null);
  const [hearError, setHearError] = useState<string | null>(null);

  const playful = (data?.track ?? track) === "playful";
  const exercises = data?.exercises ?? [];
  const ex: PracticeExercise | undefined = exercises[index];
  const next = exercises.length > 1 ? exercises[(index + 1) % exercises.length] : undefined;
  const busy = take.phase !== "idle";
  const flats = flatKey(ex?.dohHeader);

  const countInSec = ex ? countInFor(ex).seconds : 0;
  const t = take.elapsed - countInSec;
  const slots = ex ? pitchSlots(ex) : [];
  const moment = busy && take.phase !== "sending" ? pitchMomentAt(slots, t) : null;
  const focus = moment ? Math.max(0, moment.index) : 0;
  const shown = ex?.notes[focus];

  async function start() {
    if (!ex) return;
    setGrade(null);
    take.stopPlaying();
    const got = await sing(ex);
    if (got) {
      setGrade(got.grade);
      void refresh();
    }
  }

  function hear() {
    if (!ex) return;
    if (take.playing === "hear") { take.stopPlaying(); return; }
    setHearError(null);
    try {
      const clip = hearClip(ex);
      take.play(clip.wav, clip.seconds, "hear");
    } catch {
      setHearError("Could not play the notes. Please try again.");
    }
  }

  function open(i: number) {
    take.stopPlaying();
    setGrade(null);
    setIndex(i);
  }

  const advice = grade?.marks && ex ? pitchAdvice(grade.marks, ex.notes) : null;

  return (
    <View style={styles.flex}>
      <Screen scroll contentStyle={styles.screen}>
        <ModeHeader eyebrow={modeTitle("pitch-match", track)} title={grade ? "Your set" : ex?.title ?? "Hold each note"} pill={ex?.dohHeader ?? null} />
        <ModeState loading={loading && !data} error={data ? null : loadError} onRetry={reload} />
        {ex ? (
          <>
            <View style={styles.chips} accessible accessibilityLabel={`The set: ${ex.notes.map(written).join(" ")}`}>
              {ex.notes.map((n, i) => (
                <View key={i} style={[styles.chip, moment && i < focus && styles.chipDone, moment && i === focus && styles.chipOn]}>
                  <Text style={[styles.chipText, moment && i === focus && styles.chipTextOn]}>{written(n)}</Text>
                </View>
              ))}
            </View>

            {grade ? (
              <View style={styles.resultBlock}>
                <ModeResult
                  score={grade.score}
                  summary={grade.summary}
                  sub={!playful && grade.marks ? tuningLine(grade.marks.tuningCents) : null}
                  marks={noteMarks(grade.marks, ex.notes).map((m) => ({ key: m.index, text: m.text, sub: m.cents, tone: m.tone }))}
                  legend={playful ? "Green spot on · amber close · grey not quite" : "Green in tune · amber close · grey off. Numbers are cents off."}
                  reward={grade.reward}
                  playful={playful}
                />
                {advice ? (
                  <View style={styles.advice}>
                    <Text style={styles.adviceTitle}>{advice.title}</Text>
                    <Text style={styles.adviceBody}>{advice.body}</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.stage} accessibilityLiveRegion="polite">
                <Text style={styles.big}>{shown ? written(shown) : ""}</Text>
                {shown ? <Text style={styles.caption}>{noteCaption(shown, focus, ex.notes.length, flats)}</Text> : null}
                {moment ? (
                  moment.phase === "hold" ? (
                    <View style={styles.holdCard}>
                      <View style={styles.holdHead}>
                        <Text style={styles.holdTitle}>Hold it <Text style={styles.holdMuted}>· 4 beats</Text></Text>
                        <Text style={styles.holdMuted}>{Math.min(moment.held, moment.holdSeconds).toFixed(1)} of {moment.holdSeconds.toFixed(0)} s</Text>
                      </View>
                      <View style={styles.holdTrack}>
                        <View style={[styles.holdFill, { width: `${Math.min(100, (moment.held / Math.max(0.1, moment.holdSeconds)) * 100)}%` }]} />
                      </View>
                      <Text style={styles.hint}>Sing “ah” and keep it steady. We mark the whole set when it ends.</Text>
                    </View>
                  ) : (
                    <View style={styles.listenRow}>
                      <Icon name="hear" size={18} color={c.icon} />
                      <Text style={styles.listen}>{take.phase === "leadin" ? `Starting in ${Math.max(1, Math.ceil(countInSec - take.elapsed))}` : "Listen…"}</Text>
                    </View>
                  )
                ) : take.phase === "sending" ? (
                  <Text style={styles.hint}>Marking your set…</Text>
                ) : (
                  <Text style={styles.hint}>{ex.prompt} Eight notes, one take.</Text>
                )}
              </View>
            )}

            {error || hearError ? <ProblemNote>{error ?? hearError}</ProblemNote> : null}
            {!busy ? <AllowanceLine data={data} /> : null}

            {!busy && next ? (
              <>
                <Text style={styles.section}>{grade ? "Next set" : "Other sets"}</Text>
                <View style={styles.list}>
                  {(grade ? [next] : exercises.filter((_, i) => i !== index)).map((e) => (
                    <Touchable key={e.id} onPress={() => open(exercises.indexOf(e))} scaleTo={0.99} accessibilityLabel={`${e.title}. ${e.dohHeader ?? ""}`}>
                      <View style={styles.row}>
                        <View style={styles.tile}>
                          <Icon name="pitch" size={20} color={c.icon} />
                        </View>
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle}>{e.title}</Text>
                          <Text style={styles.rowSolfa} numberOfLines={1}>{e.notes.map(written).join(" ")}</Text>
                        </View>
                        <Text style={styles.rowValue}>{e.bestScore != null && !playful ? `Best ${e.bestScore}` : e.dohHeader}</Text>
                        <Icon name="chevron" size={16} color={c.textFaint} />
                      </View>
                    </Touchable>
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </Screen>
      {ex ? (
        <ModeFooter status={take.phase === "leadin" || take.phase === "live" ? <LiveDot label="Listening" /> : null}>
          {take.phase === "leadin" || take.phase === "live" ? (
            <Button label="Stop" icon="stop" variant="secondary" onPress={take.cancel} />
          ) : take.phase === "sending" ? (
            <Button label="Marking…" loading />
          ) : grade ? (
            <>
              <Button label="Again" variant="secondary" onPress={() => void start()} disabled={noneLeft(data)} />
              {next ? <Button label="Next set" onPress={() => open(exercises.indexOf(next))} /> : null}
            </>
          ) : (
            <>
              <Button label={take.playing === "hear" ? "Stop" : "Hear it"} icon={take.playing === "hear" ? "stop" : "hear"} variant="secondary" onPress={hear} />
              <Button label={playful ? "Sing it!" : "Start"} icon="mic" onPress={() => void start()} disabled={noneLeft(data)} />
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
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: spacing.xs },
    chip: { minWidth: 38, height: 36, paddingHorizontal: 8, borderRadius: 9, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" },
    chipDone: { opacity: 0.5 },
    chipOn: { borderColor: c.primary, backgroundColor: c.accentSoft },
    chipText: { ...typography.mono, fontSize: 15, color: c.textMuted },
    chipTextOn: { color: c.text },
    stage: { alignItems: "center", paddingVertical: spacing.xl, gap: spacing.sm },
    big: { fontFamily: fonts.bold, fontSize: 96, lineHeight: 104, color: c.text },
    caption: { fontFamily: fonts.regular, fontSize: 15, color: c.textMuted },
    hint: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 21, color: c.textMuted, textAlign: "center", marginTop: spacing.sm },
    listenRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.lg, minHeight: 44 },
    listen: { fontFamily: fonts.semibold, fontSize: 18, color: c.link },
    holdCard: { alignSelf: "stretch", marginTop: spacing.lg, padding: spacing.md, borderRadius: radii.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, gap: spacing.sm },
    holdHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
    holdTitle: { fontFamily: fonts.semibold, fontSize: 14, color: c.text },
    holdMuted: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted },
    holdTrack: { height: 10, borderRadius: 5, backgroundColor: c.surfaceAlt, overflow: "hidden" },
    holdFill: { height: 10, borderRadius: 5, backgroundColor: c.success },
    resultBlock: { gap: spacing.md, marginTop: spacing.md },
    advice: { padding: spacing.md, borderRadius: radii.md, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border, gap: 4 },
    adviceTitle: { fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    adviceBody: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: c.textMuted },
    section: { fontFamily: fonts.semibold, fontSize: 13, color: c.textFaint, marginTop: spacing.xl, marginBottom: spacing.sm },
    list: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radii.md, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60, paddingHorizontal: spacing.md, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    tile: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.sheetTile, alignItems: "center", justifyContent: "center" },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    rowSolfa: { ...typography.mono, fontSize: 12.5, color: c.textMuted, marginTop: 2 },
    rowValue: { fontFamily: fonts.medium, fontSize: 12.5, color: c.textFaint },
  });
