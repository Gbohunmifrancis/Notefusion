/**
 * The quick games (board s-practice-fun/s3), pushed from the Practice tab's arcade: Which note? (hear doh, then a note;
 * tap it on the Curwen modulator), Staff to solfa (Playful's "Note race": a note on the stave, its solfa tapped), Name
 * that hymn (a hymn's opening; its name picked) and Which scale? (a scale up and back down; its name picked). Tapped,
 * not sung: no microphone.
 *
 * The arcade, as the web plays it (web-site/assets/practice-game-view.js): each stage is the server's deal at the level
 * kept on this phone (`GET /api/practice/games/{game}?level=`, `lib/arcadeStore`), harder every level with no top. A
 * stage's answers go back to be marked (`POST …/games/grade`), which records the day's games that count (XP, the
 * streak) and says the `nextLevel`: up after a good stage, with the level-up screen; the same, or one down after a poor
 * one, said in a line and the next stage straight on — until the singer stops. Staff to solfa gives each note its own
 * time then (a note let run out is sent as "" and marked wrong). An older server deals a one-off game (no `level`) and
 * marks it without a `nextLevel`: that plays exactly as before — Staff to solfa a minute's race, then the end card.
 *
 * The rounds carry their answers, so a tap is told at once — a mint rung and a buzz, or the right one shown and played
 * again; wrong is grey, never red. Leaving mid-stage sends nothing; the level is kept.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useReducedMotion } from "react-native-reanimated";
import { File, Paths } from "expo-file-system";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import { practiceApi } from "../../api/endpoints";
import { toApiError } from "../../api/client";
import type { PracticeGame, PracticeGameGrade, PracticeGameId, PracticeGameRound } from "../../api/types";
import { Screen } from "../../components/Screen";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { ProblemNote } from "../../components/ProblemNote";
import { Touchable } from "../../components/Touchable";
import { ModeHeader } from "../../components/practice/ModeHeader";
import { ModeState } from "./shared";
import { Stave } from "../../components/practice/Stave";
import { Confetti } from "../../components/practice/Confetti";
import { Moments, type MomentBatch } from "../../components/practice/Moments";
import { Art } from "../../components/practice/Art";
import { synthesizeMelodyWavBase64 } from "../../lib/synth";
import { ensurePiano } from "../../lib/piano";
import { play as buzz } from "../../lib/haptics";
import { logAnalyticsEvent } from "../../lib/analytics";
import { rewardEvents, rewardMoment } from "../../lib/practiceProgress";
import { starsArt, starsFor, starWord } from "../../lib/practiceTrack";
import { deriveSolfa } from "../../lib/solfa";
import { openingLine } from "../../lib/hymnPack";
import { installedPack } from "../../lib/hymnPackStore";
import { resultFromHymn } from "../../lib/openSheet";
import {
  EAR_TEMPO,
  asNoteEvents,
  clock,
  comboOf,
  earNotes,
  gameIntro,
  gameTitle,
  resultLine,
  resultTitle,
  syllableName,
  verdict,
  type GameNoteLike,
} from "../../lib/practiceGames";
import {
  comingNext,
  isArcadeDeal,
  levelChange,
  levelNews,
  nextLevelOf,
  runAfter,
  stageFraction,
  stageGoal,
  stageNote,
  staffSeconds,
  toLevelUpLine,
} from "../../lib/practiceArcade";
import { recallArcade, rememberArcade } from "../../lib/arcadeStore";
import { gameColorsFor } from "../../design/gameColors";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useTheme, useThemedStyles } from "../../lib/theme";
import type { RootStackParams } from "../../navigation/types";

type Phase = "intro" | "playing" | "sending" | "done" | "levelup";

/** A wrong tap in Staff to solfa shows the right key this long before the next note. */
const RACE_MISS_MS = 650;
/** The "level 7 again" line shows this long at the top of the next stage. */
const NOTE_MS = 2600;

export function PracticeGameScreen({ route, navigation }: NativeStackScreenProps<RootStackParams, "PracticeGame">) {
  const { game } = route.params;
  const { mode, palette: c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const { width } = useWindowDimensions();

  const [deal, setDeal] = useState<PracticeGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [marks, setMarks] = useState<boolean[]>([]);
  /** The current round's tap, until Next (Staff to solfa moves on by itself). */
  const [picked, setPicked] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [grade, setGrade] = useState<PracticeGameGrade | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [moments, setMoments] = useState<MomentBatch | null>(null);
  const [canOpenHymn, setCanOpenHymn] = useState(false);
  /** The arcade's level to deal, and the best reached on this phone; null until read. */
  const [level, setLevel] = useState<number | null>(null);
  const [best, setBest] = useState<number | null>(null);
  /** Right answers in a row across the arcade's stages, and the longest run this visit. */
  const [run, setRun] = useState(0);
  const [bestRun, setBestRun] = useState(0);
  /** "Level 4 again: …" or "Back to level 3: …" over the next stage, for a moment. */
  const [note, setNote] = useState<string | null>(null);
  /** The server dealt an arcade stage: the screen stays the arcade while the next stage is dealt. */
  const [arcadeSeen, setArcadeSeen] = useState(false);

  const track = deal?.track ?? route.params.track ?? null;
  const playful = track === "playful";
  const title = gameTitle(game, track);
  const round: PracticeGameRound | undefined = deal?.rounds[index];
  const arcade = isArcadeDeal(deal) || arcadeSeen;
  const staff = game === "staff";
  /** The one-off Staff to solfa: a minute's race (the arcade gives each note its own time instead). */
  const race = staff && !arcade;
  const g = gameColorsFor(mode);

  const live = useRef(true);
  const startedAt = useRef(0);
  const player = useRef<AudioPlayer | null>(null);
  const clip = useRef<File | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The race's answers as tapped, read by the clock when it runs out between renders.
  const answersRef = useRef<string[]>([]);
  answersRef.current = answers;
  /** Rounds answered, counted as each tap lands: a second tap before the screen redraws is not a second answer. */
  const tapped = useRef(0);
  /** The arcade's first stage opens on its intro; every stage after starts straight on. */
  const firstStage = useRef(true);
  const runRef = useRef(0);

  const stopAudio = useCallback(() => {
    try { player.current?.remove(); } catch { /* released */ }
    player.current = null;
    try { if (clip.current?.exists) clip.current.delete(); } catch { /* gone */ }
    clip.current = null;
  }, []);

  const playNotes = useCallback((notes: readonly GameNoteLike[], tempo: number) => {
    if (notes.length === 0) return;
    stopAudio();
    try {
      const file = new File(Paths.cache, `notefusion-game-${Date.now()}.wav`);
      file.write(synthesizeMelodyWavBase64(asNoteEvents(notes), tempo), { encoding: "base64" });
      clip.current = file;
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      player.current = createAudioPlayer({ uri: file.uri });
      player.current.play();
    } catch (e) {
      if (__DEV__) console.warn("[game] play failed", e);
    }
  }, [stopAudio]);

  const clearTimers = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (advance.current) clearTimeout(advance.current);
    timer.current = null;
    advance.current = null;
  }, []);

  /** Plays what a round asks you to hear: doh then the note, or the hymn's opening. Staff to solfa plays on a right tap. */
  const hearRound = useCallback((r: PracticeGameRound | undefined) => {
    if (!r) return;
    if (game === "which-note") playNotes(earNotes(r), EAR_TEMPO);
    else if ((game === "hymn" || game === "which-scale") && r.notes) playNotes(r.notes, r.tempoBpm ?? 96);
  }, [game, playNotes]);

  /** The stage begins: the race's minute, or the first round's sound (the arcade's notes have their own clocks). */
  function start(d: PracticeGame | null = deal) {
    if (!d) return;
    firstStage.current = false;
    startedAt.current = Date.now();
    setPhase("playing");
    if (isArcadeDeal(d)) void logAnalyticsEvent("practice_game_stage_started", { game, level: d.level ?? 0 });
    else void logAnalyticsEvent("practice_game_started", { game });
    if (staff && !isArcadeDeal(d)) {
      const limit = d.timeLimitSeconds ?? 60;
      setTimeLeft(limit);
      timer.current = setInterval(() => {
        const left = limit - (Date.now() - startedAt.current) / 1000;
        setTimeLeft(left);
        if (left <= 0) void finishRef.current(answersRef.current);
      }, 200);
    } else if (!staff) {
      hearRound(d.rounds[0]);
    }
  }

  /** Deals a game (the arcade's stage at `at`); after the arcade's first stage, the next starts straight on. */
  const load = useCallback(async (at: number | null) => {
    clearTimers();
    stopAudio();
    setLoading(true);
    setLoadError(null);
    setDeal(null);
    setPhase("intro");
    setIndex(0);
    setAnswers([]);
    setMarks([]);
    tapped.current = 0;
    setPicked(null);
    setGrade(null);
    setSendError(null);
    try {
      const d = await practiceApi.game(game, at ?? undefined);
      if (!live.current) return;
      setDeal(d);
      setTimeLeft(d.timeLimitSeconds ?? 0);
      if (d.level != null) {
        setLevel(d.level);
        setArcadeSeen(true);
      }
      if (isArcadeDeal(d) && !firstStage.current) startRef.current(d);
    } catch (e) {
      if (live.current) setLoadError(toApiError(e).message);
    } finally {
      if (live.current) setLoading(false);
    }
  }, [clearTimers, game, stopAudio]);

  useEffect(() => {
    live.current = true;
    void ensurePiano();
    // The level kept on this phone, then its stage (an older server ignores the level and deals a one-off game).
    void recallArcade(game, route.params.track ?? null).then((kept) => {
      if (!live.current) return;
      setLevel(kept.level);
      setBest(kept.best);
      void load(kept.level);
    });
    if (game === "hymn") void installedPack().then((p) => { if (live.current) setCanOpenHymn(!!p); }).catch(() => undefined);
    return () => {
      live.current = false;
      clearTimers();
      stopAudio();
      if (noteTimer.current) clearTimeout(noteTimer.current);
    };
    // The track is read once, for the level a first visit starts at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimers, game, load, stopAudio]);

  // The arcade's Staff to solfa: each note its own time; one let run out is sent as "" (marked wrong) and the next comes.
  useEffect(() => {
    if (!deal || phase !== "playing" || !staff || !isArcadeDeal(deal)) return;
    const limit = deal.secondsPerRound ?? staffSeconds(deal.level ?? 1);
    const at = index;
    const t0 = Date.now();
    setTimeLeft(limit);
    const id = setInterval(() => {
      if (tapped.current > at) { clearInterval(id); return; }
      const left = limit - (Date.now() - t0) / 1000;
      setTimeLeft(left);
      if (left <= 0) {
        clearInterval(id);
        tapRef.current("");
      }
    }, 100);
    return () => clearInterval(id);
  }, [deal, index, phase, staff]);

  function showNote(line: string) {
    setNote(line);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => { if (live.current) setNote(null); }, NOTE_MS);
  }

  async function finish(sent: readonly string[]) {
    if (!deal) return;
    clearTimers();
    setPhase("sending");
    setSendError(null);
    const seconds = Math.round((Date.now() - startedAt.current) / 100) / 10;
    try {
      const graded = await practiceApi.gradeGame(deal.dealId, [...sent], seconds);
      if (!live.current) return;
      for (const e of rewardEvents(graded.reward)) void logAnalyticsEvent(e.name, e.params);
      const next = isArcadeDeal(deal) ? nextLevelOf(graded) : null;
      if (next != null && level != null) {
        // The arcade: keep the level dealt next, then the level-up screen or straight on to the next stage.
        const was = deal.level ?? level;
        const kept = await rememberArcade(game, next);
        if (!live.current) return;
        setBest(kept.best);
        setLevel(next);
        setGrade(graded);
        void logAnalyticsEvent("practice_game_stage", {
          game, level: was, score: graded.score, next, counted: graded.counted ? 1 : 0, xp: graded.reward?.xpGained ?? 0,
        });
        if (levelChange(was, next) === "up") {
          setPhase("levelup");
          setBurst((b) => b + 1);
          if (!reduceMotion) setMoments({ id: Date.now(), moments: [{ piece: "stars", values: { stars: graded.score >= 90 ? 3 : 2 } }] });
          buzz("success");
          AccessibilityInfo.announceForAccessibility(`Level ${next}! ${levelNews(game, next)}`);
          return;
        }
        const line = stageNote(was, next, deal.rounds.length);
        showNote(line);
        AccessibilityInfo.announceForAccessibility(line);
        void load(next);
        return;
      }
      setGrade(graded);
      setPhase("done");
      void logAnalyticsEvent("practice_game_finished", { game, score: graded.score, counted: graded.counted ? 1 : 0, xp: graded.reward?.xpGained ?? 0 });
      if (graded.counted && graded.score >= 80) {
        setBurst((b) => b + 1);
        buzz("success");
      }
      AccessibilityInfo.announceForAccessibility(`${resultTitle(graded)}. ${resultLine(graded, deal.gamesPerDay)}`);
    } catch (e) {
      if (!live.current) return;
      setSendError(toApiError(e).message);
    }
  }

  function tap(choice: string) {
    if (!deal || !round || phase !== "playing" || picked != null || tapped.current > index) return;
    tapped.current = index + 1;
    const right = choice === round.answer;
    const nextAnswers = [...answers, choice];
    setAnswers(nextAnswers);
    setMarks((m) => [...m, right]);
    runRef.current = runAfter(runRef.current, right);
    setRun(runRef.current);
    setBestRun((b) => Math.max(b, runRef.current));
    buzz(right ? "success" : "light");

    if (staff) {
      if (right && round.noteMidi != null) playNotes([{ pitchMidi: round.noteMidi, startBeat: 0, durBeats: 0.5 }], 120);
      const moveOn = () => {
        setPicked(null);
        if (index + 1 >= deal.rounds.length) void finish(nextAnswers);
        else setIndex(index + 1);
      };
      if (right) moveOn();
      else {
        setPicked(choice);
        advance.current = setTimeout(moveOn, RACE_MISS_MS);
      }
      return;
    }

    setPicked(choice);
    const said = verdict(game, round, choice);
    AccessibilityInfo.announceForAccessibility(`${said.title} ${said.line}`);
    // A wrong ear answer hears both again: doh, then the right note.
    if (!right && game === "which-note") hearRound(round);
  }

  // The clocks and `load` call these between renders: always the latest.
  const tapRef = useRef(tap);
  tapRef.current = tap;
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const startRef = useRef(start);
  startRef.current = start;

  function next() {
    if (!deal) return;
    if (index + 1 >= deal.rounds.length) {
      void finish(answers);
      return;
    }
    setPicked(null);
    setIndex(index + 1);
    hearRound(deal.rounds[index + 1]);
  }

  async function openHymn(slug: string) {
    const pack = await installedPack().catch(() => null);
    const h = pack?.hymns.find((x) => x.slug === slug);
    if (!h) return;
    stopAudio();
    navigation.navigate("Result", { result: resultFromHymn(h), title: h.title, openedFrom: "hymn" });
  }

  const combo = arcade ? run : comboOf(marks);
  const pill = arcade
    ? `Level ${deal?.level ?? level ?? ""}`
    : !deal ? null : race ? clock(phase === "intro" ? deal.timeLimitSeconds ?? 60 : timeLeft) : `${Math.min(index + 1, deal.rounds.length)} of ${deal.rounds.length}`;
  const said = round && picked != null && !staff ? verdict(game, round, picked) : null;
  const rounds = deal?.rounds.length ?? 0;
  const noteLimit = deal ? deal.secondsPerRound ?? staffSeconds(deal.level ?? 1) : 1;

  return (
    <View style={styles.flex}>
      <Screen scroll contentStyle={styles.screen}>
        {phase === "levelup" && grade && deal && level != null ? (
          <LevelUp
            game={game}
            title={title}
            level={level}
            grade={grade}
            bestRun={bestRun}
            styles={styles}
            g={g}
            onKeepGoing={() => void load(level)}
            onRest={() => navigation.goBack()}
          />
        ) : (
          <>
            <ModeHeader eyebrow={arcade ? "Arcade · no mic" : "Quick game · no mic"} title={title} pill={pill} pillIcon={race ? "clock" : undefined} />
            {note ? (
              <View style={styles.note} accessibilityLiveRegion="polite">
                <Text style={styles.noteText}>{note}</Text>
              </View>
            ) : null}
            <ModeState loading={loading && !deal} error={deal ? null : loadError} onRetry={() => void load(level)} />

            {/* The arcade's level and what it brought; while playing, the stage's bar toward the next level. */}
            {deal && arcade && level != null && phase !== "sending" ? (
              <View style={styles.levelBox}>
                <View style={styles.levelRow}>
                  <View style={[styles.levelChip, { backgroundColor: g.tones.blue.fill, borderBottomColor: g.tones.blue.lip }]}>
                    <Text style={[styles.levelChipText, { color: g.tones.blue.ink }]}>LEVEL {deal.level ?? level}</Text>
                  </View>
                  <Text style={styles.levelNews} numberOfLines={2}>{levelNews(game, deal.level ?? level)}</Text>
                </View>
                {phase === "playing" ? (
                  <View style={styles.stageRow}>
                    <View
                      style={styles.stageTrack}
                      accessible
                      accessibilityRole="progressbar"
                      accessibilityLabel={toLevelUpLine(marks, rounds, deal.level ?? level)}
                    >
                      <View style={[styles.stageFill, { width: `${Math.round(stageFraction(marks, rounds) * 100)}%`, backgroundColor: g.tones.green.fill }]} />
                    </View>
                    {combo >= 2 ? <Combo n={combo} styles={styles} c={c} /> : null}
                  </View>
                ) : null}
                {phase === "playing" ? <Text style={styles.meta}>{toLevelUpLine(marks, rounds, deal.level ?? level)}</Text> : null}
              </View>
            ) : null}

            {deal && phase === "intro" ? (
              <View style={styles.intro}>
                {arcade ? <Text style={styles.introEyebrow}>Arcade · never ends</Text> : null}
                <Text style={styles.introText}>
                  {arcade
                    ? gameIntro(game, track).replace(/, as many as you can in (a minute|60 seconds)\./, ", before its time runs out.")
                    : gameIntro(game, track)}
                </Text>
                {arcade && level != null ? (
                  <>
                    <Text style={styles.meta}>Level {deal.level ?? level}{best != null && best > (deal.level ?? level) ? ` · your best is ${best}` : ""}</Text>
                    <Text style={styles.meta}>{stageGoal(rounds)} of {rounds} right moves you up a level</Text>
                  </>
                ) : null}
                <Text style={styles.meta}>
                  {arcade
                    ? deal.gamesToday >= deal.gamesPerDay
                      ? `Today's ${deal.gamesPerDay} stages that earn XP are done: the rest are for fun.`
                      : `${deal.gamesPerDay - deal.gamesToday} of today's ${deal.gamesPerDay} stages earn XP.`
                    : deal.gamesToday >= deal.gamesPerDay
                      ? `Today's ${deal.gamesPerDay} games that earn XP are done. This one is for fun.`
                      : `Earns XP: ${deal.gamesPerDay - deal.gamesToday} of today's ${deal.gamesPerDay} games left.`}
                </Text>
                <Button label={playful ? "Let's play!" : "Start"} icon="play" block onPress={() => start()} />
              </View>
            ) : null}

            {deal && round && phase === "playing" ? (
              <>
                {race ? (
                  <View style={styles.raceTop}>
                    <View style={styles.timerTrack} accessibilityElementsHidden>
                      <View style={[styles.timerFill, { width: `${Math.max(0, Math.min(1, timeLeft / (deal.timeLimitSeconds ?? 60))) * 100}%` }]} />
                    </View>
                    <View style={styles.scoreLine}>
                      <Text style={styles.meta}>
                        <Text style={styles.scoreBig}>{marks.filter(Boolean).length}</Text> right
                      </Text>
                      {combo >= 2 ? <Combo n={combo} styles={styles} c={c} /> : null}
                    </View>
                  </View>
                ) : staff ? (
                  // The arcade's note clock: this note's time running out.
                  <View style={styles.timerTrack} accessibilityElementsHidden>
                    <View style={[styles.timerFill, { width: `${(picked != null ? 0 : Math.max(0, Math.min(1, timeLeft / noteLimit))) * 100}%` }]} />
                  </View>
                ) : !arcade ? (
                  <View style={styles.dotsRow}>
                    <View style={styles.dots}>
                      {deal.rounds.map((_, i) => (
                        <View key={i} style={[styles.dot, i < marks.length && (marks[i] ? styles.dotRight : styles.dotWrong), i === index && marks.length === i && styles.dotNow]} />
                      ))}
                    </View>
                    {combo >= 2 ? <Combo n={combo} styles={styles} c={c} /> : null}
                  </View>
                ) : null}

                {game === "which-note" ? (
                  <WhichNote round={round} picked={picked} onHear={() => hearRound(round)} onTap={tap} styles={styles} c={c} playful={playful} />
                ) : game === "staff" ? (
                  <StaffRound round={round} picked={picked} onTap={tap} styles={styles} width={width - spacing.lg * 2} />
                ) : game === "which-scale" ? (
                  <ScaleRound round={round} picked={picked} onHear={() => hearRound(round)} onTap={tap} styles={styles} />
                ) : (
                  <HymnRound
                    round={round}
                    picked={picked}
                    onHear={() => hearRound(round)}
                    onTap={tap}
                    onOpen={canOpenHymn ? (slug) => void openHymn(slug) : undefined}
                    styles={styles}
                  />
                )}

                {said ? (
                  <View style={styles.verdict} accessibilityLiveRegion="polite">
                    <View style={[styles.verdictMark, said.right ? styles.verdictRight : styles.verdictWrong]}>
                      <Icon name={said.right ? "check" : "close"} size={16} strokeWidth={2.4} color={said.right ? c.bg : c.textMuted} />
                    </View>
                    <View style={styles.verdictText}>
                      <Text style={styles.verdictTitle}>{said.right && arcade && run >= 3 ? `${said.title} ${run} in a row!` : said.title}</Text>
                      <Text style={styles.verdictLine} numberOfLines={2}>{said.line}</Text>
                    </View>
                    <Button label={index + 1 >= deal.rounds.length ? (arcade ? "Finish stage" : "Finish") : "Next"} size="sm" onPress={next} />
                  </View>
                ) : null}
              </>
            ) : null}

            {phase === "sending" ? (
              <View style={styles.intro}>
                <Text style={styles.introText}>
                  {sendError ? "Your answers didn't reach us." : arcade ? `${marks.filter(Boolean).length} of ${rounds} right. Checking your stage…` : "Marking your answers…"}
                </Text>
                {sendError ? (
                  <>
                    <ProblemNote sentence>{sendError}</ProblemNote>
                    <Button label="Send them again" icon="retry" block onPress={() => void finish(staff ? answersRef.current : answers)} />
                  </>
                ) : null}
              </View>
            ) : null}

            {grade && deal && phase === "done" ? (
              <View style={styles.done} accessibilityLiveRegion="polite">
                {playful ? <Art name={starsArt(starsFor(grade.score))} width={148} /> : <Text style={styles.doneScore}>{grade.score}</Text>}
                <Text style={styles.doneTitle}>{playful ? starWord(starsFor(grade.score)) : resultTitle(grade)}</Text>
                <Text style={styles.doneLine}>{playful ? `${resultTitle(grade)} · ${resultLine(grade, deal.gamesPerDay)}` : resultLine(grade, deal.gamesPerDay)}</Text>
                {grade.reward && rewardMoment(grade.reward)?.big ? <Text style={styles.doneReward}>{rewardMoment(grade.reward)!.line}</Text> : null}
                <Button label="Play again" icon="restart" block onPress={() => void load(level)} />
                <Button label="Back to Practice" variant="secondary" block onPress={() => navigation.goBack()} />
              </View>
            ) : null}
          </>
        )}
      </Screen>
      <Confetti burst={burst} reduceMotion={reduceMotion} />
      <Moments batch={moments} reduceMotion={reduceMotion} />
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

/**
 * The level-up screen (as the web's): Doh cheering, the new level and what it brings, the stage's numbers (right, the
 * best run, XP) in the game colours, what's coming at the next two levels and every level after, and on — or a break,
 * the level kept.
 */
function LevelUp({
  game,
  title,
  level,
  grade,
  bestRun,
  styles,
  g,
  onKeepGoing,
  onRest,
}: {
  game: PracticeGameId;
  title: string;
  level: number;
  grade: PracticeGameGrade;
  bestRun: number;
  styles: Styles;
  g: ReturnType<typeof gameColorsFor>;
  onKeepGoing: () => void;
  onRest: () => void;
}) {
  const xp = grade.counted && grade.reward ? grade.reward.xpGained : 0;
  const stats = [
    { head: "RIGHT", value: `${grade.score}%`, tone: g.tones.green },
    { head: "BEST RUN", value: `×${bestRun}`, tone: g.tones.orange },
    { head: "XP", value: `+${xp}`, tone: g.tones.cyan },
  ];
  return (
    <View style={styles.levelUp} accessibilityLiveRegion="polite">
      <Art name="doh-cheer" width={140} />
      <Text style={styles.introEyebrow}>{title.toUpperCase()} · LEVEL UP</Text>
      <Text style={styles.levelUpTitle} accessibilityRole="header">Level {level}!</Text>
      <Text style={styles.levelUpNews}>{levelNews(game, level)}</Text>
      <View style={styles.stats}>
        {stats.map((s) => (
          <View key={s.head} style={[styles.stat, { backgroundColor: s.tone.fill, borderBottomColor: s.tone.lip }]} accessible accessibilityLabel={`${s.head.toLowerCase()}: ${s.value}`}>
            <Text style={[styles.statHead, { color: s.tone.ink }]}>{s.head}</Text>
            <Text style={[styles.statValue, { color: s.tone.ink }]}>{s.value}</Text>
          </View>
        ))}
      </View>
      <View style={styles.coming}>
        <Text style={styles.comingHead}>WHAT'S COMING</Text>
        {comingNext(game, level).map((row) => (
          <View key={row.level ?? "after"} style={styles.comingRow}>
            <View style={[styles.comingNum, row.level === level + 1 && { backgroundColor: g.tones.blue.fill }]}>
              <Text style={[styles.comingNumText, row.level === level + 1 && { color: g.tones.blue.ink }]}>{row.level == null ? "∞" : row.level}</Text>
            </View>
            <Text style={styles.comingText}>{row.text}</Text>
          </View>
        ))}
      </View>
      <Button label="Keep going" icon="next" iconPosition="right" block onPress={onKeepGoing} />
      <Button label="Take a break (your level is kept)" variant="text" onPress={onRest} />
    </View>
  );
}

function Combo({ n, styles, c }: { n: number; styles: Styles; c: Palette }) {
  return (
    <View style={styles.combo} accessible accessibilityLabel={`${n} right in a row`}>
      <Icon name="streak" size={14} color={c.play} />
      <Text style={styles.comboText}>×{n}</Text>
    </View>
  );
}

/** Which note?: the play button and the modulator, top doh at the top, doh at the foot in the accent's wash. */
function WhichNote({
  round,
  picked,
  onHear,
  onTap,
  styles,
  c,
  playful,
}: {
  round: PracticeGameRound;
  picked: string | null;
  onHear: () => void;
  onTap: (choice: string) => void;
  styles: Styles;
  c: Palette;
  playful: boolean;
}) {
  const ladder = [...round.choices].reverse();
  return (
    <View style={styles.ask}>
      <Text style={styles.q}>Doh, then which note?</Text>
      <Text style={styles.sub}>Doh is {round.doh} · tap the {playful ? "step" : "rung"} you heard</Text>
      <Touchable onPress={onHear} radius={34} accessibilityRole="button" accessibilityLabel="Play doh and the note again" style={styles.playBig}>
        <Icon name="play" size={28} color={c.onAccent} />
      </Touchable>
      <View style={styles.ladder}>
        {ladder.map((s) => {
          const isAnswer = s === round.answer;
          const shown = picked != null;
          return (
            <Touchable
              key={s}
              onPress={() => onTap(s)}
              disabled={shown}
              radius={radii.md}
              accessibilityRole="button"
              accessibilityLabel={syllableName(s) + (s === "d'" ? ", top" : "")}
            >
              <View
                style={[
                  styles.rung,
                  playful && styles.rungPlayful,
                  s === "d" && styles.rungDoh,
                  shown && isAnswer && styles.rungRight,
                  shown && s === picked && !isAnswer && styles.rungWrong,
                ]}
              >
                <Text style={[styles.rungSolfa, shown && isAnswer && styles.rungRightText]}>{s}</Text>
                <Text style={[styles.rungName, shown && isAnswer && styles.rungRightText]}>{syllableName(s)}{shown && isAnswer ? " ✓" : ""}</Text>
              </View>
            </Touchable>
          );
        })}
      </View>
    </View>
  );
}

/** Staff to solfa: the stave, then the syllables in two rows; a miss shows the right key for a moment. */
function StaffRound({
  round,
  picked,
  onTap,
  styles,
  width,
}: {
  round: PracticeGameRound;
  picked: string | null;
  onTap: (choice: string) => void;
  styles: Styles;
  width: number;
}) {
  return (
    <>
      <View style={styles.staveCard} accessible accessibilityLabel={`Doh is ${round.doh}. The note is ${round.noteName}.`}>
        <Text style={styles.staveKey}>Doh is {round.doh}</Text>
        <Stave noteName={round.noteName ?? "B4"} fifths={round.fifths ?? 0} width={width - spacing.md * 2} />
      </View>
      <View style={styles.keys}>
        {round.choices.map((s) => (
          <Touchable key={s} onPress={() => onTap(s)} disabled={picked != null} radius={radii.md} accessibilityRole="button" accessibilityLabel={syllableName(s)} style={styles.keyCell}>
            <View style={[styles.key, picked != null && s === round.answer && styles.rungRight, picked === s && s !== round.answer && styles.rungWrong]}>
              <Text style={[styles.keyText, picked != null && s === round.answer && styles.rungRightText]}>{s}</Text>
            </View>
          </Touchable>
        ))}
      </View>
    </>
  );
}

/** Name that hymn: replay the opening, three hymns to pick from; the right one shows its opening in solfa. */
function HymnRound({
  round,
  picked,
  onHear,
  onTap,
  onOpen,
  styles,
}: {
  round: PracticeGameRound;
  picked: string | null;
  onHear: () => void;
  onTap: (choice: string) => void;
  onOpen?: (slug: string) => void;
  styles: Styles;
}) {
  const shown = picked != null;
  return (
    <View style={styles.ask}>
      <Text style={styles.q}>Which hymn opens like this?</Text>
      <Text style={styles.sub}>Its opening, on the piano</Text>
      <Button label="Play it again" icon="hear" variant="secondary" size="sm" onPress={onHear} style={styles.again} />
      <View style={styles.choices}>
        {(round.hymns ?? []).map((h) => {
          const isAnswer = h.slug === round.answer;
          return (
            <Touchable key={h.slug} onPress={() => onTap(h.slug)} disabled={shown} radius={radii.lg} accessibilityRole="button" accessibilityLabel={h.title}>
              <View style={[styles.choice, shown && isAnswer && styles.rungRight, shown && !isAnswer && styles.choiceDim]}>
                <Text style={[styles.choiceTitle, shown && isAnswer && styles.rungRightText]}>{h.title}{shown && isAnswer ? " ✓" : ""}</Text>
                {h.firstLine ? <Text style={styles.choiceLine} numberOfLines={1}>{h.firstLine}</Text> : null}
                {shown && isAnswer ? (
                  <>
                    <Text style={styles.choiceSolfa}>{openingSolfa(round)}</Text>
                    {onOpen ? <Button label="Open in Hymns" variant="text" size="sm" onPress={() => onOpen(h.slug)} style={styles.openHymn} /> : null}
                  </>
                ) : null}
              </View>
            </Touchable>
          );
        })}
      </View>
    </View>
  );
}

/** Which scale?: replay the scale, the scales to pick from; the right one shows its solfa up and back down. */
function ScaleRound({
  round,
  picked,
  onHear,
  onTap,
  styles,
}: {
  round: PracticeGameRound;
  picked: string | null;
  onHear: () => void;
  onTap: (choice: string) => void;
  styles: Styles;
}) {
  const shown = picked != null;
  return (
    <View style={styles.ask}>
      <Text style={styles.q}>Which scale is this?</Text>
      <Text style={styles.sub}>Up and back down, on the piano</Text>
      <Button label="Play it again" icon="hear" variant="secondary" size="sm" onPress={onHear} style={styles.again} />
      <View style={styles.choices}>
        {(round.scales ?? []).map((sc) => {
          const isAnswer = sc.code === round.answer;
          return (
            <Touchable key={sc.code} onPress={() => onTap(sc.code)} disabled={shown} radius={radii.lg} accessibilityRole="button" accessibilityLabel={sc.title}>
              <View style={[styles.choice, shown && isAnswer && styles.rungRight, shown && !isAnswer && styles.choiceDim]}>
                <Text style={[styles.choiceTitle, shown && isAnswer && styles.rungRightText]}>{sc.title}{shown && isAnswer ? " ✓" : ""}</Text>
                {shown && isAnswer ? <Text style={styles.choiceSolfa}>{sc.solfa}</Text> : null}
              </View>
            </Touchable>
          );
        })}
      </View>
    </View>
  );
}

/** A hymn's opening in solfa, labelled by the solfa engine in its key: "s, d m d m r d l,". */
function openingSolfa(round: PracticeGameRound): string {
  if (!round.notes?.length || !round.key) return "";
  return openingLine(deriveSolfa(asNoteEvents(round.notes), round.key, round.timeSignature ?? "4/4").notes, 12);
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
    screen: { paddingBottom: spacing.xxl },
    meta: { ...typography.caption, color: c.textMuted, fontSize: 13 },
    intro: { marginTop: spacing.lg, gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    introText: { ...typography.body, color: c.text, fontSize: 17, lineHeight: 24 },

    dotsRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
    dots: { flex: 1, flexDirection: "row", gap: 5 },
    dot: { flex: 1, height: 6, borderRadius: 3, backgroundColor: c.surfaceAlt },
    dotRight: { backgroundColor: c.success },
    dotWrong: { backgroundColor: c.textFaint },
    dotNow: { backgroundColor: c.accent },
    combo: { flexDirection: "row", alignItems: "center", gap: 4, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: c.playSoft },
    comboText: { fontFamily: fonts.bold, fontSize: 13, color: c.play },

    ask: { alignItems: "center", marginTop: spacing.md },
    q: { ...typography.title, color: c.text, fontSize: 21, textAlign: "center" },
    sub: { ...typography.body, color: c.textMuted, fontSize: 14, marginTop: 4, textAlign: "center" },
    playBig: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
    ladder: { width: 220, gap: 6, marginTop: spacing.md },
    rung: { height: 44, borderRadius: radii.md, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surface, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
    rungPlayful: { height: 52 },
    rungDoh: { borderColor: c.accent, backgroundColor: c.accentSoft },
    rungRight: { borderColor: c.success, backgroundColor: c.surfaceAlt },
    rungWrong: { borderColor: c.textFaint, borderStyle: "dashed", opacity: 0.7 },
    rungRightText: { color: c.successText },
    rungSolfa: { ...typography.mono, fontSize: 20, color: c.text },
    rungName: { ...typography.caption, color: c.textFaint, fontSize: 13, marginLeft: "auto" },

    verdict: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg, padding: 12, borderRadius: radii.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    verdictMark: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
    verdictRight: { backgroundColor: c.success },
    verdictWrong: { backgroundColor: c.surfaceAlt },
    verdictText: { flex: 1, minWidth: 0 },
    verdictTitle: { fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    verdictLine: { ...typography.caption, color: c.textMuted, fontSize: 13, marginTop: 2 },

    raceTop: { gap: 6, marginTop: spacing.xs },
    timerTrack: { height: 6, borderRadius: 3, backgroundColor: c.surfaceAlt, overflow: "hidden" },
    timerFill: { height: 6, backgroundColor: c.accent },
    scoreLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    scoreBig: { fontFamily: fonts.bold, fontSize: 22, color: c.text },
    staveCard: { marginTop: spacing.md, padding: spacing.md, borderRadius: radii.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    staveKey: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.7, textTransform: "uppercase", color: c.textFaint },
    keys: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: spacing.md },
    keyCell: { width: "23%", flexGrow: 1 },
    key: { height: 56, borderRadius: radii.md, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surfaceAlt, alignItems: "center", justifyContent: "center" },
    keyText: { ...typography.mono, fontSize: 22, color: c.text },

    again: { marginTop: spacing.md },
    choices: { alignSelf: "stretch", gap: 10, marginTop: spacing.md },
    choice: { borderRadius: radii.lg, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surface, padding: 14 },
    choiceDim: { opacity: 0.45 },
    choiceTitle: { fontFamily: fonts.semibold, fontSize: 16, color: c.text },
    choiceLine: { ...typography.caption, color: c.textFaint, fontSize: 13, marginTop: 3 },
    choiceSolfa: { ...typography.mono, fontSize: 15, color: c.text, marginTop: 8 },
    openHymn: { alignSelf: "flex-start", marginTop: 4 },

    done: { alignItems: "center", gap: spacing.md, marginTop: spacing.xl, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    doneScore: { ...typography.display, color: c.text },
    doneTitle: { ...typography.title, color: c.text, fontSize: 24, textAlign: "center" },
    doneLine: { ...typography.body, color: c.textMuted, textAlign: "center" },
    doneReward: { fontFamily: fonts.semibold, fontSize: 15, color: c.text, textAlign: "center" },

    // The arcade: the level and what it brought, the stage's bar toward the next, the line between stages.
    introEyebrow: { ...typography.caption, color: c.textFaint, textTransform: "uppercase", letterSpacing: 1, fontSize: 12, fontFamily: fonts.bold },
    note: { marginBottom: spacing.sm, padding: 12, borderRadius: radii.md, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
    noteText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19, color: c.text },
    levelBox: { gap: 6, marginBottom: spacing.xs },
    levelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    levelChip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10, borderBottomWidth: 3 },
    levelChipText: { fontFamily: fonts.bold, fontSize: 13, letterSpacing: 0.8 },
    levelNews: { ...typography.caption, color: c.textMuted, fontSize: 13, flexShrink: 1 },
    stageRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    stageTrack: { flex: 1, height: 14, borderRadius: 7, backgroundColor: c.surfaceAlt, overflow: "hidden" },
    stageFill: { height: 14, borderRadius: 7 },

    levelUp: { alignItems: "center", gap: spacing.md, marginTop: spacing.xl },
    levelUpTitle: { ...typography.display, color: c.text, textAlign: "center" },
    levelUpNews: { ...typography.body, color: c.textMuted, fontSize: 16, textAlign: "center" },
    stats: { flexDirection: "row", gap: 8, alignSelf: "stretch" },
    stat: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 10, borderRadius: radii.md, borderBottomWidth: 4 },
    statHead: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8 },
    statValue: { fontFamily: fonts.bold, fontSize: 20 },
    coming: { alignSelf: "stretch", gap: 8, padding: spacing.md, borderRadius: radii.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    comingHead: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1, color: c.textFaint },
    comingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    comingNum: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceAlt },
    comingNumText: { fontFamily: fonts.bold, fontSize: 14, color: c.text },
    comingText: { ...typography.body, color: c.text, fontSize: 15, flex: 1 },
  });
