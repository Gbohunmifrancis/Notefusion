/**
 * Rhythm ("Clap it back" on Playful), drawn after boards c-practice/6b–6c: hear a rhythm (claps over a quiet beat),
 * then after the count-in clap it back (tapping a table works too). The server hears the claps' onsets and marks
 * each one in time (within 70 ms), close (within 140 ms) or off; a tap on the screen would be the phone's own report,
 * so it is the microphone that is marked, never the screen.
 */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "../../components/Icon";
import type { PracticeModeGrade, PracticeTrack } from "../../api/types";
import { Screen } from "../../components/Screen";
import { Button } from "../../components/Button";
import { ProblemNote } from "../../components/ProblemNote";
import { Touchable } from "../../components/Touchable";
import { ModeHeader } from "../../components/practice/ModeHeader";
import { ModeResult } from "../../components/practice/ModeResult";
import { countInFor, hearClip } from "../../lib/modeAudio";
import { beatSeconds, centsText, clapLayout, clapMarks, clapSyllable, modeTitle, rhythmAdvice } from "../../lib/practiceModes";
import { useModeTake } from "../../lib/useModeTake";
import { fonts, radii, spacing, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { AllowanceLine, LiveDot, ModeFooter, ModeState, noneLeft, useGrade, useModeExercises } from "./shared";

/** "Hear it" counts a bar in first (lib/modeAudio). */
const HEAR_COUNT_IN_BEATS = 4;

export function RhythmScreen({ track }: { track: PracticeTrack | null }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const take = useModeTake();
  const { sing, error } = useGrade(take);
  const { data, error: loadError, loading, reload, refresh } = useModeExercises("rhythm");
  const [index, setIndex] = useState(0);
  const [grade, setGrade] = useState<PracticeModeGrade | null>(null);

  const playful = (data?.track ?? track) === "playful";
  const exercises = data?.exercises ?? [];
  const ex = exercises[index];
  const busy = take.phase !== "idle";
  const layout = ex ? clapLayout(ex.claps) : null;
  const countInSec = ex ? countInFor(ex).seconds : 0;
  const beat = ex
    ? take.phase === "live"
      ? (take.elapsed - countInSec) / beatSeconds(ex.tempoBpm)
      : take.playing === "hear"
        ? take.elapsed / beatSeconds(ex.tempoBpm) - HEAR_COUNT_IN_BEATS
        : -1
    : -1;
  const due = ex ? ex.claps.findIndex((cl) => beat >= cl.startBeat && beat < cl.startBeat + Math.min(cl.durBeats, 0.5)) : -1;
  const next = exercises.length > 1 ? exercises[(index + 1) % exercises.length] : undefined;
  const marks = grade?.rhythm ? clapMarks(grade.rhythm) : [];

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
    const clip = hearClip(ex);
    take.play(clip.wav, clip.seconds, "hear");
  }

  function open(i: number) {
    take.stopPlaying();
    setGrade(null);
    setIndex(i);
  }

  return (
    <View style={styles.flex}>
      <Screen scroll contentStyle={styles.screen}>
        <ModeHeader eyebrow={modeTitle("rhythm", track)} title={ex?.title ?? modeTitle("rhythm", track)} pill={ex ? `${ex.tempoBpm} BPM` : null} />
        <ModeState loading={loading && !data} error={data ? null : loadError} onRetry={reload} />
        {ex && layout ? (
          <>
            <View style={styles.grid} accessible accessibilityRole="image" accessibilityLabel={`The rhythm: ${ex.claps.map((cl) => clapSyllable(cl.durBeats)).join(" ")}`}>
              <View style={styles.lane}>
                {Array.from({ length: layout.beats }, (_, b) => (
                  <View key={b} style={[styles.beatLine, { left: `${(b / layout.beats) * 100}%` }, b % 4 === 0 && styles.barLine]} />
                ))}
                {layout.blocks.map((b) => {
                  const m = marks[b.index];
                  const tone = m ? (m.tone === "hit" ? c.success : m.tone === "near" ? c.warning : c.textFaint) : null;
                  return (
                    <View
                      key={b.index}
                      style={[
                        styles.clap,
                        { left: `${b.x * 100}%`, width: `${Math.max(3, b.w * 100 - 1.2)}%` },
                        due === b.index && styles.clapOn,
                        tone ? { backgroundColor: tone } : null,
                        m?.tone === "missed" && styles.clapMissed,
                      ]}
                    />
                  );
                })}
              </View>
              <View style={styles.syllables}>
                {ex.claps.map((cl, i) => (
                  <Text key={i} style={[styles.syllable, { left: `${(cl.startBeat / layout.beats) * 100}%` }]}>{clapSyllable(cl.durBeats)}</Text>
                ))}
              </View>
            </View>
            <Text style={styles.prompt}>
              {take.phase === "leadin"
                ? `Get ready… clap in ${Math.max(1, Math.ceil(countInSec - take.elapsed))}`
                : take.phase === "live"
                  ? "Clap!"
                  : take.phase === "sending"
                    ? "Marking your claps…"
                    : `${ex.prompt} Clap after the count-in; tapping the table works too.`}
            </Text>

            {grade?.rhythm ? (
              <View style={styles.result}>
                <ModeResult
                  score={grade.score}
                  summary={grade.summary}
                  marks={marks.map((m, i) => ({ key: m.index, text: String(m.index + 1), sub: m.tone === "missed" ? "—" : centsText(grade.rhythm!.claps[i]?.errorMs), tone: m.tone }))}
                  legend={playful ? "✓ in time · ~ close · struck through: off" : "✓ in time · ~ close · struck through: off. Numbers are ms early (−) or late (+)."}
                  reward={grade.reward}
                  playful={playful}
                >
                  {rhythmAdvice(grade.rhythm) ? <Text style={styles.advice}>{rhythmAdvice(grade.rhythm)}</Text> : null}
                </ModeResult>
              </View>
            ) : null}
            {error ? <ProblemNote>{error}</ProblemNote> : null}
            {!busy ? <AllowanceLine data={data} /> : null}

            {!busy && exercises.length > 1 ? (
              <>
                <Text style={styles.section}>More rhythms</Text>
                <View style={styles.list}>
                  {exercises.map((e, i) => (
                    <Touchable key={e.id} onPress={() => open(i)} scaleTo={0.99} accessibilityLabel={e.title}>
                      <View style={styles.row}>
                        <View style={styles.rowText}>
                          <Text style={[styles.rowTitle, i === index && styles.rowTitleOn]} numberOfLines={1}>{e.title}</Text>
                          <Text style={styles.rowSub} numberOfLines={1}>{e.claps.map((cl) => clapSyllable(cl.durBeats)).join(" ")}</Text>
                        </View>
                        {e.bestScore != null && !playful ? <Text style={styles.rowValue}>Best {e.bestScore}</Text> : null}
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
        <ModeFooter marking={take.phase === "sending"} status={take.phase === "leadin" || take.phase === "live" ? <LiveDot label="Listening" /> : null}>
          {take.phase === "leadin" || take.phase === "live" ? (
            <Button label="Stop" icon="stop" variant="secondary" onPress={take.cancel} />
          ) : take.phase === "sending" ? (
            <Button label="Marking…" loading />
          ) : grade ? (
            <>
              <Button label="Again" variant="secondary" onPress={() => void start()} disabled={noneLeft(data)} />
              {next ? <Button label="Next rhythm" onPress={() => open((index + 1) % exercises.length)} /> : null}
            </>
          ) : (
            <>
              <Button label={take.playing === "hear" ? "Stop" : playful ? "Listen" : "Hear it"} icon={take.playing === "hear" ? "stop" : "hear"} variant="secondary" onPress={hear} />
              <Button label="Clap it" icon="rhythm" onPress={() => void start()} disabled={noneLeft(data)} />
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
    grid: { marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    lane: { height: 44, position: "relative" },
    beatLine: { position: "absolute", top: 4, bottom: 4, width: 1, backgroundColor: c.border },
    barLine: { backgroundColor: c.textFaint, top: 0, bottom: 0 },
    clap: { position: "absolute", top: 10, height: 24, borderRadius: 6, backgroundColor: c.primary },
    clapOn: { backgroundColor: c.accentAlt, transform: [{ scaleY: 1.25 }] },
    clapMissed: { backgroundColor: "transparent", borderWidth: 1.5, borderStyle: "dashed", borderColor: c.textFaint },
    syllables: { height: 22, position: "relative", marginTop: 6 },
    syllable: { position: "absolute", fontFamily: fonts.medium, fontSize: 12, color: c.textMuted },
    prompt: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: c.textMuted, textAlign: "center", marginTop: spacing.lg },
    result: { marginTop: spacing.lg },
    advice: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: c.text },
    section: { fontFamily: fonts.semibold, fontSize: 13, color: c.textFaint, marginTop: spacing.xl, marginBottom: spacing.sm },
    list: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radii.md, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 58, paddingHorizontal: spacing.md, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { fontFamily: fonts.medium, fontSize: 15.5, color: c.text },
    rowTitleOn: { color: c.link },
    rowSub: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 2 },
    rowValue: { fontFamily: fonts.medium, fontSize: 12.5, color: c.textFaint },
  });
