/**
 * Intervals and Sing the harmony: the two modes marked note by note like the daily drill, drawn after boards
 * c-practice/6b–6c. Intervals: hear doh, sing it, then jump to the note asked ("soh above doh"), in the order RCM and
 * Trinity teach them. Harmony: a line a third above (or the alto under) a tune; "Hear it" plays the line with the tune
 * soft under it, and the take plays the tune in the singer's ears only with headphones on — without them it would
 * reach the microphone, and the grader follows one line — so without, the singer hears it first and sings alone.
 */

import React, { useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { Icon } from "../../components/Icon";
import type { PracticeModeGrade, PracticeTrack } from "../../api/types";
import { Screen } from "../../components/Screen";
import { Button } from "../../components/Button";
import { ProblemNote } from "../../components/ProblemNote";
import { Touchable } from "../../components/Touchable";
import { ModeHeader } from "../../components/practice/ModeHeader";
import { ModeResult } from "../../components/practice/ModeResult";
import { countInFor, hearClip } from "../../lib/modeAudio";
import { intervalParts, modeTitle, noteDue, noteMarks, written } from "../../lib/practiceModes";
import { useModeTake } from "../../lib/useModeTake";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { AllowanceLine, LiveDot, ModeFooter, ModeState, noneLeft, useGrade, useModeExercises } from "./shared";

export function SingNotesScreen({ mode, track }: { mode: "intervals" | "harmony"; track: PracticeTrack | null }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const take = useModeTake();
  const { sing, error } = useGrade(take);
  const { data, error: loadError, loading, reload, refresh } = useModeExercises(mode);
  const [index, setIndex] = useState(0);
  const [grade, setGrade] = useState<PracticeModeGrade | null>(null);
  const [headphones, setHeadphones] = useState(false);

  const playful = (data?.track ?? track) === "playful";
  const exercises = data?.exercises ?? [];
  const ex = exercises[index];
  const busy = take.phase !== "idle";
  const countInSec = ex ? countInFor(ex).seconds : 0;
  const due = ex && (take.phase === "live" || take.playing === "hear")
    ? noteDue(ex.notes, ex.tempoBpm, take.playing === "hear" ? take.elapsed : take.elapsed - countInSec)
    : -1;
  const jump = ex && mode === "intervals" ? intervalParts(ex) : null;
  const next = exercises.length > 1 ? exercises[(index + 1) % exercises.length] : undefined;

  async function start() {
    if (!ex) return;
    setGrade(null);
    take.stopPlaying();
    const got = await sing(ex, headphones);
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
        <ModeHeader eyebrow={modeTitle(mode, track)} title={ex?.title ?? modeTitle(mode, track)} pill={ex?.dohHeader ?? null} />
        <ModeState loading={loading && !data} error={data ? null : loadError} onRetry={reload} />
        {ex ? (
          <>
            {jump ? (
              <View style={styles.jump} accessible accessibilityLabel={`From ${jump.from}, ${jump.up ? "up" : "down"} ${jump.size ?? ""} to ${jump.to}`}>
                <View style={[styles.jumpNote, due === 0 && styles.jumpOn]}>
                  <Text style={styles.jumpSolfa}>{written(ex.notes[0]!)}</Text>
                  <Text style={styles.jumpName}>{jump.from}</Text>
                </View>
                <View style={styles.jumpArrow}>
                  <Icon name={jump.up ? "arrow-up" : "arrow-down"} size={22} color={c.icon} />
                  {jump.size ? <Text style={styles.jumpSize}>{jump.size}</Text> : null}
                </View>
                <View style={[styles.jumpNote, styles.jumpTarget, due === 1 && styles.jumpOn]}>
                  <Text style={styles.jumpSolfa}>{written(ex.notes[1]!)}</Text>
                  <Text style={styles.jumpName}>{jump.to}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.lines}>
                <Text style={styles.lineLabel}>Your line{ex.group ? ` · ${ex.group.toLowerCase()}` : ""}</Text>
                <View style={styles.chips}>
                  {ex.notes.map((n, i) => (
                    <View key={i} style={[styles.chip, due === i && styles.chipOn]}>
                      <Text style={[styles.chipText, due === i && styles.chipTextOn]}>{written(n)}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.lineLabel}>The tune</Text>
                <View style={styles.chips}>
                  {ex.backing.map((n, i) => (
                    <View key={i} style={[styles.chip, styles.chipTune]}>
                      <Text style={[styles.chipText, styles.chipTextTune]}>{written(n)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            <Text style={styles.prompt}>{ex.prompt}</Text>
            {mode === "harmony" ? (
              <View style={styles.phones}>
                <Icon name="headphones" size={20} color={c.icon} />
                <View style={styles.phonesText}>
                  <Text style={styles.phonesTitle}>I'm wearing headphones</Text>
                  <Text style={styles.phonesHint}>
                    {headphones ? "The tune plays softly in your ears while you sing." : "Without them, hear it first, then sing your line alone."}
                  </Text>
                </View>
                <Switch
                  value={headphones}
                  onValueChange={setHeadphones}
                  disabled={busy}
                  trackColor={{ false: c.grabber, true: c.primary }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor={c.grabber}
                  accessibilityLabel="I'm wearing headphones"
                />
              </View>
            ) : null}

            {take.phase === "leadin" ? <Text style={styles.status}>Starting note… sing in {Math.max(1, Math.ceil(countInSec - take.elapsed))}</Text> : null}
            {take.phase === "sending" ? <Text style={styles.status}>Marking your take…</Text> : null}

            {grade?.marks ? (
              <View style={styles.result}>
                <ModeResult
                  score={grade.score}
                  summary={grade.summary}
                  marks={noteMarks(grade.marks, ex.notes).map((m) => ({ key: m.index, text: m.text, sub: m.cents, tone: m.tone }))}
                  legend={playful ? null : "✓ in tune · ~ close · struck through: off. Numbers are cents off."}
                  reward={grade.reward}
                  playful={playful}
                />
              </View>
            ) : null}
            {error ? <ProblemNote>{error}</ProblemNote> : null}
            {!busy ? <AllowanceLine data={data} /> : null}

            {!busy && exercises.length > 1 ? (
              <>
                <Text style={styles.section}>{mode === "intervals" ? (playful ? "More jumps" : "More intervals") : "More lines"}</Text>
                <View style={styles.list}>
                  {exercises.map((e, i) => (
                    <Touchable key={e.id} onPress={() => open(i)} scaleTo={0.99} accessibilityLabel={`${e.title}${e.group ? `, ${e.group}` : ""}`}>
                      <View style={styles.row}>
                        <View style={styles.rowText}>
                          <Text style={[styles.rowTitle, i === index && styles.rowTitleOn]} numberOfLines={1}>{e.title}</Text>
                          <Text style={styles.rowSub} numberOfLines={1}>{e.group ?? e.notes.map(written).join(" ")}</Text>
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
        <ModeFooter marking={take.phase === "sending"} status={take.phase === "leadin" || take.phase === "live" ? <LiveDot label={take.phase === "live" ? "Sing!" : "Listening"} /> : null}>
          {take.phase === "leadin" || take.phase === "live" ? (
            <Button label="Stop" icon="stop" variant="secondary" onPress={take.cancel} />
          ) : take.phase === "sending" ? (
            <Button label="Marking…" loading />
          ) : grade ? (
            <>
              <Button label="Again" variant="secondary" onPress={() => void start()} loading={take.starting} disabled={noneLeft(data)} />
              {next ? <Button label={mode === "intervals" ? (playful ? "Next jump" : "Next interval") : "Next line"} onPress={() => open((index + 1) % exercises.length)} /> : null}
            </>
          ) : (
            <>
              <Button label={take.playing === "hear" ? "Stop" : playful ? "Listen" : "Hear it"} icon={take.playing === "hear" ? "stop" : "hear"} variant="secondary" onPress={hear} />
              <Button label={playful ? "Sing it!" : "Sing it"} icon="mic" onPress={() => void start()} loading={take.starting} disabled={noneLeft(data)} />
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
    jump: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md, paddingVertical: spacing.xl },
    jumpNote: { width: 96, paddingVertical: spacing.md, borderRadius: radii.lg, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surface, alignItems: "center" },
    jumpTarget: { borderColor: c.primary, backgroundColor: c.accentSoft },
    jumpOn: { borderColor: c.success },
    jumpSolfa: { ...typography.mono, fontSize: 40, color: c.text },
    jumpName: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted, marginTop: 2 },
    jumpArrow: { alignItems: "center", gap: 2, maxWidth: 90 },
    jumpSize: { fontFamily: fonts.medium, fontSize: 12, color: c.textMuted, textAlign: "center" },
    lines: { gap: spacing.sm, paddingVertical: spacing.md },
    lineLabel: { fontFamily: fonts.semibold, fontSize: 13, color: c.textFaint },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { minWidth: 44, height: 44, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surfaceAlt, alignItems: "center", justifyContent: "center" },
    chipOn: { borderColor: c.primary, backgroundColor: c.accentSoft },
    chipTune: { backgroundColor: "transparent", borderStyle: "dashed" },
    chipText: { ...typography.mono, fontSize: 19, color: c.text },
    chipTextOn: { color: c.link },
    chipTextTune: { color: c.textMuted, fontSize: 16 },
    prompt: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: c.textMuted, textAlign: "center" },
    phones: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.lg, padding: spacing.md, borderRadius: radii.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    phonesText: { flex: 1, minWidth: 0 },
    phonesTitle: { fontFamily: fonts.medium, fontSize: 15, color: c.text },
    phonesHint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.textMuted, marginTop: 2 },
    status: { fontFamily: fonts.semibold, fontSize: 15, color: c.link, textAlign: "center", marginTop: spacing.md },
    result: { marginTop: spacing.lg },
    section: { fontFamily: fonts.semibold, fontSize: 13, color: c.textFaint, marginTop: spacing.xl, marginBottom: spacing.sm },
    list: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radii.md, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 58, paddingHorizontal: spacing.md, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { fontFamily: fonts.medium, fontSize: 16, color: c.text },
    rowTitleOn: { color: c.link },
    rowSub: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 2 },
    rowValue: { fontFamily: fonts.medium, fontSize: 13, color: c.textFaint },
  });
