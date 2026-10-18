/**
 * The Christmas carols path (board d-christmas/03), pushed from the Practice hub's pine card while the season is on:
 * six short drills from carols we hold — a Gloria warm-up, Joy to the World all the way down, Silent Night in thirds
 * (the piano keeps the tune) and sung along with its words, Hark! the Herald's leap and the First Noel's climb.
 *
 * A side-path with its own place: each drill is heard, counted in, sung and marked by `drills/grade` like any drill
 * (XP, the day's allowance and the streak as ever) and never moves the main path. The next unsung drill is open; any
 * other can be tapped and sung again. All six sung earn the Carol singer sticker: the reward sheet, a burst of
 * snowflakes and quavers (none with Reduce Motion) and the whole first line of Joy to the World on the piano (only
 * with the app's sound on). Playful has Doh, in his cap, over the path; Focused has the longer takes and no Doh.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useReducedMotion } from "react-native-reanimated";

import { practiceApi } from "../../api/endpoints";
import { toApiError } from "../../api/client";
import type { CarolDrill, CarolsPath, GradeResult } from "../../api/types";
import { Screen } from "../../components/Screen";
import { Button } from "../../components/Button";
import { ProblemNote } from "../../components/ProblemNote";
import { Touchable } from "../../components/Touchable";
import { GradeMarks } from "../../components/GradeMarks";
import { Sheet, SheetActions } from "../../components/Sheet";
import { ModeHeader } from "../../components/practice/ModeHeader";
import { StarGrade } from "../../components/practice/StarGrade";
import { Confetti } from "../../components/practice/Confetti";
import { Art } from "../../components/practice/Art";
import { CappedArt } from "../../components/season/Cap";
import { logAnalyticsEvent } from "../../lib/analytics";
import { leadInPlan } from "../../lib/practice";
import { allowanceLine, rewardMoment } from "../../lib/practiceProgress";
import { acknowledgeGrade } from "../../lib/practiceReward";
import { SEASON_CONFETTI_ART, badgeArt, celebrationFor, playfulRewardLine, starsFor } from "../../lib/practiceTrack";
import { MODE_TAIL_SEC, TUNE_LEVEL, takeSound } from "../../lib/practiceModes";
import { JOY_LINE, carolsBuddyLine, carolsView, earnedCarolSinger, solfaLine } from "../../lib/season";
import { playCarol } from "../../lib/seasonChime";
import { noteDueAt, partSeconds } from "../../lib/take";
import { synthesizeVoicesWavBase64 } from "../../lib/synth";
import { showToast } from "../../lib/toast";
import { MicDenied, useModeTake } from "../../lib/useModeTake";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import type { RootStackParams } from "../../navigation/types";

/** The synth rings each note on this long past its end; a clip's length includes it. */
const RING_SEC = 0.4;

export function CarolsScreen() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const route = useRoute<RouteProp<RootStackParams, "Carols">>();
  const reduceMotion = useReducedMotion();
  const take = useModeTake();

  const [path, setPath] = useState<CarolsPath | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [grade, setGrade] = useState<{ index: number; result: GradeResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [headphones, setHeadphones] = useState(false);
  const [sticker, setSticker] = useState<GradeResult | null>(null);
  const [burst, setBurst] = useState(0);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const p = await practiceApi.carols();
      if (!live.current) return;
      setPath(p);
      setLoadError(null);
    } catch (e) {
      if (!live.current || quiet) return;
      const err = toApiError(e);
      setLoadError(err.code === "PRACTICE_SEASON_OFF" ? "The carols are put away until next Christmas." : err.message);
    } finally {
      if (live.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const track = path?.drills[0]?.drill.track ?? route.params?.track ?? null;
  const playful = track === "playful";
  const view = path ? carolsView(path.season, chosen) : null;
  const open = path?.drills.find((d) => d.step.index === view?.open) ?? null;
  const busy = take.phase !== "idle";
  const allowance = open?.drill.allowance ?? null;
  const left = allowance ? Math.max(0, allowance.limit - allowance.used) : null;

  function choose(index: number) {
    if (busy) return;
    take.stopPlaying();
    setChosen(index);
    setGrade(null);
    setError(null);
  }

  /** "Listen": the drill once at its tempo, with the tune soft under a part. */
  function hear(d: CarolDrill) {
    if (busy) return;
    if (take.playing === "hear") { take.stopPlaying(); return; }
    try {
      const voices = [{ notes: d.drill.notes, gain: 1 }, ...(d.backing ? [{ notes: d.backing, gain: TUNE_LEVEL }] : [])];
      const end = Math.max(partSeconds(d.drill.notes, d.drill.tempoBpm), d.backing ? partSeconds(d.backing, d.drill.tempoBpm) : 0);
      take.play(synthesizeVoicesWavBase64(voices, d.drill.tempoBpm), end + RING_SEC, "hear");
    } catch {
      setError("Could not play the carol. Please try again.");
    }
  }

  /** "Sing it": the count-in (the first note held, then clicks), the tune in the ears only with headphones on, marked. */
  async function sing(d: CarolDrill) {
    if (busy) return;
    setError(null);
    setGrade(null);
    // The drill stays open with its marks when the path moves on underneath it.
    setChosen(d.step.index);
    take.stopPlaying();
    const plan = leadInPlan(d.drill.tempoBpm, d.drill.timeSignature);
    const countIn = { beats: plan.beats, holdBeats: plan.holdBeats, beatsPerBar: plan.beatsPerBar, beatSec: plan.beatSec, seconds: plan.seconds };
    const sound = takeSound({ mode: d.backing ? "harmony" : "intervals", notes: d.drill.notes, backing: d.backing ?? [] }, countIn, headphones);
    const clip = synthesizeVoicesWavBase64(sound.voices, d.drill.tempoBpm, {
      countInBeats: sound.countInBeats,
      beatsPerBar: sound.beatsPerBar,
      // The first bar line falls after the pickup, so the count-in's accent lands where the carol's would.
      downbeat: d.pickupBeats,
    });
    const natural = plan.seconds + partSeconds(d.drill.notes, d.drill.tempoBpm) + MODE_TAIL_SEC;
    const seconds = d.drill.maxTakeSeconds > 0 ? Math.min(d.drill.maxTakeSeconds, natural) : natural;
    void logAnalyticsEvent("carol_started", { drill: d.drill.id, step: d.step.index });
    try {
      const got = await take.record({
        clipBase64: clip,
        leadInSec: plan.seconds,
        seconds,
        send: (uri) => practiceApi.gradeDrill(uri, d.drill.id, plan.seconds),
      });
      if (!got || !live.current) return;
      const result = got.value;
      setGrade({ index: d.step.index, result });
      void logAnalyticsEvent("carol_marked", { drill: d.drill.id, step: d.step.index, score: result.score });
      const moment = acknowledgeGrade(result);
      if (earnedCarolSinger(result.reward?.newBadges, path?.season.badgeCode)) {
        setSticker(result);
        if (!reduceMotion) setBurst((b) => b + 1);
        void playCarol(JOY_LINE);
      } else {
        const how = celebrationFor(track, result.score, result.reward, false);
        if (how === "burst" && !reduceMotion) setBurst((b) => b + 1);
        const line = playful ? playfulRewardLine(result.reward) : moment?.line ?? rewardMoment(result.reward)?.line;
        if (how !== "quiet" && line) showToast(line);
      }
      void load(true);
    } catch (e) {
      if (live.current) setError(e instanceof MicDenied ? e.message : toApiError(e).message);
    }
  }

  const header = (
    <ModeHeader eyebrow={view?.eyebrow ?? "Christmas"} title="Carols" />
  );

  if (loading && !path) {
    return (
      <Screen>
        {header}
        <ActivityIndicator color={c.accent} style={styles.loading} />
      </Screen>
    );
  }
  if (!path || !view) {
    return (
      <Screen>
        {header}
        <View style={styles.failed}>
          <ProblemNote>{loadError ?? "The carols didn't load."}</ProblemNote>
          <Button label="Try again" icon="refresh" variant="secondary" onPress={() => void load()} />
        </View>
      </Screen>
    );
  }

  const season = path.season;
  const dohPose = take.phase === "leadin" || take.phase === "live" ? "doh-sing" : view.allSung ? "doh-cheer" : "doh-wave";
  const passedNow = grade && grade.result.score >= 80;
  const nextStep = season.next && season.next.index !== view.open ? season.next.index : null;
  const earned = season.next == null;

  return (
    <View style={styles.flex}>
      <Screen scroll contentStyle={styles.screen}>
        {header}

        {playful ? (
          <View style={styles.buddy} accessible accessibilityLabel={`Doh says: ${carolsBuddyLine(season)}`}>
            <CappedArt name={dohPose} width={72} cap />
            <View style={styles.bubble}>
              <Text style={styles.bubbleText}>{carolsBuddyLine(season)}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.list}>
          {view.rows.map((row, k) => {
            const d = path.drills.find((x) => x.step.index === row.index);
            const after = view.rows[k + 1];
            const rule = after && after.state !== "open" && row.state !== "open" ? <View style={styles.rule} /> : null;
            if (row.state === "open" && d) {
              return (
                <OpenCarol
                  key={row.index}
                  d={d}
                  line={row.line}
                  playful={playful}
                  take={take}
                  headphones={headphones}
                  onHeadphones={setHeadphones}
                  grade={grade?.index === row.index ? grade.result : null}
                  error={error}
                  left={left}
                  allowanceText={allowance ? allowanceLine(allowance) : null}
                  onHear={() => hear(d)}
                  onSing={() => void sing(d)}
                  onNext={passedNow && nextStep ? () => choose(nextStep) : null}
                  styles={styles}
                  c={c}
                />
              );
            }
            return (
              <React.Fragment key={row.index}>
                <Touchable
                  onPress={() => choose(row.index)}
                  disabled={busy}
                  style={styles.row}
                  radius={radii.md}
                  accessibilityLabel={`${row.title}, ${row.line}${row.state === "done" ? ", sung" : ""}`}
                >
                  {row.state === "done" ? (
                    <View style={[styles.dot, styles.dotDone]}>
                      <Ionicons name="checkmark" size={18} color={c.onAccent} />
                    </View>
                  ) : (
                    <View style={styles.dot}>
                      <Text style={styles.dotText}>{row.index}</Text>
                    </View>
                  )}
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{row.title}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>{row.line}</Text>
                  </View>
                  {row.state === "done" && row.bestScore != null ? (
                    playful ? (
                      <Text style={styles.stars} accessibilityLabel={`${starsFor(row.bestScore)} stars`}>
                        {"★".repeat(starsFor(row.bestScore))}
                        <Text style={styles.starsOff}>{"☆".repeat(3 - starsFor(row.bestScore))}</Text>
                      </Text>
                    ) : (
                      <Text style={styles.best}>{row.bestScore}</Text>
                    )
                  ) : null}
                </Touchable>
                {rule}
              </React.Fragment>
            );
          })}
        </View>

        <View style={[styles.reward, earned && styles.rewardEarned]} accessible accessibilityLabel={earned ? "Carol singer sticker: yours to keep." : "Carol singer sticker for all six. It stays in your book after Christmas."}>
          <Art name={badgeArt(season.badgeCode, earned)} width={52} />
          <Text style={styles.rewardText}>
            <Text style={styles.rewardStrong}>Carol singer sticker</Text>
            {earned ? ": yours to keep, after Christmas too." : " for all six. It stays in your book after Christmas."}
          </Text>
        </View>
      </Screen>

      <Confetti burst={burst} reduceMotion={reduceMotion} art={SEASON_CONFETTI_ART} />

      <Sheet visible={sticker !== null} onClose={() => setSticker(null)}>
        {sticker ? (
          <View style={styles.sheet}>
            <Art name={badgeArt(season.badgeCode, true)} width={132} />
            <Text style={styles.sheetTitle} accessibilityRole="header">Carol singer</Text>
            <Text style={styles.sheetBody}>You sang all six carols. This sticker stays in your book after Christmas.</Text>
            {sticker.reward && sticker.reward.xpGained > 0 ? (
              <Text style={styles.sheetXp}>+{sticker.reward.xpGained} XP · same XP rules as every drill</Text>
            ) : null}
            <View style={styles.sheetLine} accessible accessibilityLabel={`Joy to the World: ${solfaLine(JOY_LINE)}`}>
              <Ionicons name="musical-notes" size={15} color={c.candle} />
              <Text style={styles.sheetSolfa}>{solfaLine(JOY_LINE)}</Text>
            </View>
            <SheetActions style={styles.sheetActions}>
              <Button
                label="See my stickers"
                variant="text"
                onPress={() => {
                  setSticker(null);
                  nav.navigate("Tabs", { screen: "Practice" });
                }}
              />
              <Button label="Done" onPress={() => setSticker(null)} />
            </SheetActions>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;
type Take = ReturnType<typeof useModeTake>;

/** The drill open for singing: its notes (the piano's tune over a part, a sing-along's words), Listen and Sing it. */
function OpenCarol({
  d,
  line,
  playful,
  take,
  headphones,
  onHeadphones,
  grade,
  error,
  left,
  allowanceText,
  onHear,
  onSing,
  onNext,
  styles,
  c,
}: {
  d: CarolDrill;
  line: string;
  playful: boolean;
  take: Take;
  headphones: boolean;
  onHeadphones: (on: boolean) => void;
  grade: GradeResult | null;
  error: string | null;
  left: number | null;
  allowanceText: string | null;
  onHear: () => void;
  onSing: () => void;
  onNext: (() => void) | null;
  styles: Styles;
  c: Palette;
}) {
  const drill = d.drill;
  const busy = take.phase !== "idle";
  const plan = leadInPlan(drill.tempoBpm, drill.timeSignature);
  const due = take.phase === "live"
    ? noteDueAt(drill.notes, drill.tempoBpm, plan.seconds, take.elapsed)
    : take.playing === "hear"
      ? noteDueAt(drill.notes, drill.tempoBpm, 0, take.elapsed)
      : -1;
  const syllables = d.syllables && d.syllables.length > 0 ? d.syllables : null;
  const label = (i: number) => (drill.notes[i]!.solfa ?? "") + (drill.notes[i]!.octaveMark ?? "");

  return (
    <View style={[styles.open, playful && styles.openPlayful]}>
      <View style={styles.openHead}>
        <View style={[styles.dot, styles.dotOpen, playful && styles.dotOpenPlayful]}>
          <Text style={[styles.dotText, styles.dotTextOpen, playful && styles.dotTextPlayful]}>{d.step.index}</Text>
        </View>
        <View style={styles.rowText}>
          <Text style={styles.openTitle} accessibilityRole="header">{d.step.title}</Text>
          <Text style={styles.rowSub}>{d.backing ? `${d.step.carol} · ${drill.dohHeader} · ${drill.notes.length} notes` : line}</Text>
        </View>
      </View>

      {d.words && d.words.length > 0 ? (
        <Text style={styles.words}>{d.words.join("\n")}</Text>
      ) : null}

      {d.backing ? (
        <View style={styles.lane}>
          <Text style={styles.laneLabel}>Piano{"\n"}tune</Text>
          <View style={styles.chips}>
            {d.backing.map((n, i) => (
              <View key={i} style={[styles.chip, styles.chipTune]}>
                <Text style={[styles.chipText, styles.chipTextTune]}>{n.solfa}{n.octaveMark}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={d.backing ? styles.lane : undefined}>
        {d.backing ? <Text style={styles.laneLabel}>You{"\n"}alto</Text> : null}
        <View
          style={styles.chips}
          accessible
          accessibilityLabel={`Sing: ${drill.notes.map((_, i) => label(i)).join(" ")}`}
        >
          {drill.notes.map((_, i) => (
            <View key={i} style={syllables ? styles.syllableCell : undefined}>
              <View style={[styles.chip, syllables && styles.chipSmall, due === i && styles.chipOn]}>
                <Text style={[styles.chipText, syllables && styles.chipTextSmall, due === i && styles.chipTextOn]}>{label(i)}</Text>
              </View>
              {syllables ? <Text style={styles.syllable} numberOfLines={1}>{syllables[i] ?? ""}</Text> : null}
            </View>
          ))}
        </View>
      </View>

      {d.backing ? (
        <View style={styles.phones}>
          <Ionicons name="headset-outline" size={20} color={c.link} />
          <View style={styles.phonesText}>
            <Text style={styles.phonesTitle}>Headphones help</Text>
            <Text style={styles.phonesHint}>
              {headphones ? "The piano keeps the tune for you while you sing." : "With them on, the piano keeps the tune for you."}
            </Text>
          </View>
          <Switch
            value={headphones}
            onValueChange={onHeadphones}
            disabled={busy}
            trackColor={{ false: c.grabber, true: c.primary }}
            thumbColor="#FFFFFF"
            ios_backgroundColor={c.grabber}
            accessibilityLabel="I'm wearing headphones"
          />
        </View>
      ) : null}

      {take.phase === "leadin" || take.phase === "live" ? (
        <View style={styles.liveRow}>
          <Text style={styles.liveText}>
            {take.phase === "leadin" ? `Starting note… sing in ${Math.max(1, Math.ceil(plan.seconds - take.elapsed))}` : playful ? "Sing!" : "Singing…"}
          </Text>
          <Button label="Stop" variant="secondary" icon="stop" size="sm" onPress={() => void take.finish()} />
        </View>
      ) : take.phase === "sending" ? (
        <Button label="Marking your take…" icon="hourglass-outline" loading />
      ) : onNext ? (
        <View style={styles.actions}>
          <Button label={playful ? "Again!" : "Sing it again"} icon="mic" variant="secondary" onPress={onSing} disabled={left === 0} style={styles.action} />
          <Button label="Next carol" icon="arrow-forward" iconPosition="right" onPress={onNext} style={styles.action} />
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            label={take.playing === "hear" ? "Stop" : "Listen"}
            icon={take.playing === "hear" ? "stop" : "volume-high-outline"}
            variant="secondary"
            onPress={onHear}
            style={styles.action}
          />
          <Button label={playful ? "Sing it!" : "Sing it"} icon="mic" onPress={onSing} disabled={left === 0} style={styles.action} />
        </View>
      )}

      {allowanceText ? <Text style={styles.allowance}>{allowanceText}</Text> : null}
      {error ? <ProblemNote>{error}</ProblemNote> : null}
      {grade && playful ? <StarGrade grade={grade} notes={drill.notes} /> : null}
      {grade && !playful ? <GradeMarks grade={grade} notes={drill.notes} /> : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
    screen: { paddingBottom: spacing.xxl },
    loading: { marginTop: spacing.xxl },
    failed: { gap: spacing.md, marginTop: spacing.lg },

    buddy: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
    bubble: {
      flex: 1,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radii.lg,
      borderTopLeftRadius: 4,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    bubbleText: { ...typography.label, color: c.text, lineHeight: 20 },

    list: { gap: 0 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      minHeight: 64,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
    },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 36 + spacing.md + spacing.xs },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { fontFamily: fonts.medium, fontSize: 16, color: c.text },
    rowSub: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 2 },
    dot: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    dotDone: { backgroundColor: c.success, borderColor: c.success },
    dotOpen: { borderColor: c.accent },
    dotOpenPlayful: { borderColor: c.play },
    dotText: { fontFamily: fonts.semibold, fontSize: 14, color: c.textMuted },
    dotTextOpen: { color: c.accent },
    dotTextPlayful: { color: c.play },
    stars: { fontSize: 17, color: c.play, letterSpacing: 1 },
    starsOff: { color: c.textFaint },
    best: { fontFamily: typography.mono.fontFamily, fontSize: 14, color: c.textMuted },

    open: {
      marginVertical: spacing.sm,
      padding: spacing.lg,
      gap: spacing.md,
      borderRadius: radii.lg,
      borderWidth: 1.5,
      borderColor: c.accent,
      backgroundColor: c.surface,
    },
    openPlayful: { borderColor: c.playBorder },
    openHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    openTitle: { ...typography.heading, color: c.text, fontSize: 19 },
    words: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: c.textMuted },
    lane: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    laneLabel: { width: 46, fontFamily: fonts.medium, fontSize: 12, lineHeight: 15, color: c.textMuted },
    chips: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: {
      minWidth: 44,
      height: 44,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    chipSmall: { minWidth: 36, height: 36, paddingHorizontal: 6 },
    chipOn: { borderColor: c.primary, backgroundColor: c.accentSoft },
    chipTune: { backgroundColor: "transparent", borderStyle: "dashed", minWidth: 40, height: 40 },
    chipText: { ...typography.mono, fontSize: 20, color: c.text },
    chipTextSmall: { fontSize: 16 },
    chipTextOn: { color: c.link },
    chipTextTune: { color: c.textMuted, fontSize: 16 },
    syllableCell: { alignItems: "center", gap: 2, minWidth: 36 },
    syllable: { fontFamily: fonts.regular, fontSize: 11, color: c.textMuted, maxWidth: 48 },
    phones: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: c.surfaceAlt,
    },
    phonesText: { flex: 1, minWidth: 0 },
    phonesTitle: { fontFamily: fonts.medium, fontSize: 14.5, color: c.text },
    phonesHint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.textMuted, marginTop: 2 },
    actions: { flexDirection: "row", gap: spacing.sm },
    action: { flex: 1 },
    liveRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    liveText: { fontFamily: fonts.semibold, fontSize: 15, color: c.link },
    allowance: { ...typography.caption, color: c.textMuted },

    reward: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      marginTop: spacing.lg,
      padding: spacing.md,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: c.border,
    },
    rewardEarned: { borderStyle: "solid", borderColor: c.pineLine, backgroundColor: c.pineSoft },
    rewardText: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
    rewardStrong: { fontFamily: fonts.semibold, color: c.text },

    sheet: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.sm },
    sheetTitle: { ...typography.title, color: c.text, fontSize: 26, marginTop: spacing.sm },
    sheetBody: { ...typography.body, color: c.textMuted, textAlign: "center", lineHeight: 22, paddingHorizontal: spacing.md },
    sheetXp: { ...typography.caption, color: c.textMuted, fontSize: 13 },
    sheetLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.xs,
      paddingVertical: 8,
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      backgroundColor: c.pineSoft,
    },
    sheetSolfa: { ...typography.mono, fontSize: 15, color: c.candle, letterSpacing: 2 },
    sheetActions: { alignSelf: "stretch", flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
  });
