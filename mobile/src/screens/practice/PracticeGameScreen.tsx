/**
 * The quick games (board s-practice-fun/s3), pushed from the Practice tab's "Quick games" row: Which note? (hear doh,
 * then a note; tap it on the Curwen modulator), Staff to solfa (Playful's "Note race": a note on the stave, its solfa
 * tapped, as many as a minute allows), Name that hymn (a hymn's opening; its name picked from three) and Which scale? (a
 * scale up and back down; its name picked from three or four). Tapped, not
 * sung: no microphone, about a minute each.
 *
 * The server deals the rounds (`GET /api/practice/games/{game}`) with their answers, so a tap is told at once — a mint
 * rung and a buzz, or the right one shown and played again; wrong is grey, never red. At the end the answers go back to
 * be marked by the server (`POST …/games/grade`), which records a game that counts as practice: XP (less than a sung
 * drill), the day for the streak, six games a day. Leaving mid-game sends nothing.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useReducedMotion } from "react-native-reanimated";
import { File, Paths } from "expo-file-system";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import { practiceApi } from "../../api/endpoints";
import { toApiError } from "../../api/client";
import type { PracticeGame, PracticeGameGrade, PracticeGameRound } from "../../api/types";
import { Screen } from "../../components/Screen";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { ProblemNote } from "../../components/ProblemNote";
import { Touchable } from "../../components/Touchable";
import { ModeHeader } from "../../components/practice/ModeHeader";
import { ModeState } from "./shared";
import { Stave } from "../../components/practice/Stave";
import { Confetti } from "../../components/practice/Confetti";
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
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import type { RootStackParams } from "../../navigation/types";

type Phase = "intro" | "playing" | "sending" | "done";

/** A wrong tap in the race shows the right key this long before the next note. */
const RACE_MISS_MS = 650;

export function PracticeGameScreen({ route, navigation }: NativeStackScreenProps<RootStackParams, "PracticeGame">) {
  const { game } = route.params;
  const c = useColors();
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
  /** The current round's tap, until Next (the race moves on by itself). */
  const [picked, setPicked] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [grade, setGrade] = useState<PracticeGameGrade | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [canOpenHymn, setCanOpenHymn] = useState(false);

  const track = deal?.track ?? route.params.track ?? null;
  const playful = track === "playful";
  const title = gameTitle(game, track);
  const round: PracticeGameRound | undefined = deal?.rounds[index];
  const race = game === "staff";

  const live = useRef(true);
  const startedAt = useRef(0);
  const player = useRef<AudioPlayer | null>(null);
  const clip = useRef<File | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The race's answers as tapped, read by the clock when it runs out between renders.
  const answersRef = useRef<string[]>([]);
  answersRef.current = answers;
  /** Rounds answered, counted as each tap lands: a second tap before the screen redraws is not a second answer. */
  const tapped = useRef(0);

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

  const load = useCallback(async () => {
    clearTimers();
    stopAudio();
    setLoading(true);
    setLoadError(null);
    setPhase("intro");
    setIndex(0);
    setAnswers([]);
    setMarks([]);
    tapped.current = 0;
    setPicked(null);
    setGrade(null);
    setSendError(null);
    try {
      const d = await practiceApi.game(game);
      if (!live.current) return;
      setDeal(d);
      setTimeLeft(d.timeLimitSeconds ?? 0);
    } catch (e) {
      if (live.current) setLoadError(toApiError(e).message);
    } finally {
      if (live.current) setLoading(false);
    }
  }, [clearTimers, game, stopAudio]);

  useEffect(() => {
    live.current = true;
    void ensurePiano();
    void load();
    if (game === "hymn") void installedPack().then((p) => { if (live.current) setCanOpenHymn(!!p); }).catch(() => undefined);
    return () => {
      live.current = false;
      clearTimers();
      stopAudio();
    };
  }, [clearTimers, game, load, stopAudio]);

  /** Plays what a round asks you to hear: doh then the note, or the hymn's opening. The race plays on a right tap. */
  const hearRound = useCallback((r: PracticeGameRound | undefined) => {
    if (!r) return;
    if (game === "which-note") playNotes(earNotes(r), EAR_TEMPO);
    else if ((game === "hymn" || game === "which-scale") && r.notes) playNotes(r.notes, r.tempoBpm ?? 96);
  }, [game, playNotes]);

  async function finish(sent: readonly string[]) {
    if (!deal) return;
    clearTimers();
    setPhase("sending");
    setSendError(null);
    const seconds = Math.round((Date.now() - startedAt.current) / 100) / 10;
    try {
      const g = await practiceApi.gradeGame(deal.dealId, [...sent], seconds);
      if (!live.current) return;
      setGrade(g);
      setPhase("done");
      void logAnalyticsEvent("practice_game_finished", { game, score: g.score, counted: g.counted ? 1 : 0, xp: g.reward?.xpGained ?? 0 });
      for (const e of rewardEvents(g.reward)) void logAnalyticsEvent(e.name, e.params);
      if (g.counted && g.score >= 80) {
        setBurst((b) => b + 1);
        buzz("success");
      }
      AccessibilityInfo.announceForAccessibility(`${resultTitle(g)}. ${resultLine(g, deal.gamesPerDay)}`);
    } catch (e) {
      if (!live.current) return;
      setSendError(toApiError(e).message);
    }
  }

  function start() {
    if (!deal) return;
    startedAt.current = Date.now();
    setPhase("playing");
    void logAnalyticsEvent("practice_game_started", { game });
    if (race) {
      const limit = deal.timeLimitSeconds ?? 60;
      setTimeLeft(limit);
      timer.current = setInterval(() => {
        const left = limit - (Date.now() - startedAt.current) / 1000;
        setTimeLeft(left);
        if (left <= 0) void finish(answersRef.current);
      }, 200);
    } else {
      hearRound(deal.rounds[0]);
    }
  }

  function tap(choice: string) {
    if (!deal || !round || phase !== "playing" || picked != null || tapped.current > index) return;
    tapped.current = index + 1;
    const right = choice === round.answer;
    const nextAnswers = [...answers, choice];
    setAnswers(nextAnswers);
    setMarks((m) => [...m, right]);
    buzz(right ? "success" : "light");

    if (race) {
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

  const combo = comboOf(marks);
  const pill = !deal ? null : race ? clock(phase === "intro" ? deal.timeLimitSeconds ?? 60 : timeLeft) : `${Math.min(index + 1, deal.rounds.length)} of ${deal.rounds.length}`;
  const said = round && picked != null && !race ? verdict(game, round, picked) : null;

  return (
    <View style={styles.flex}>
      <Screen scroll contentStyle={styles.screen}>
        <ModeHeader eyebrow="Quick game · no mic" title={title} pill={pill} pillIcon={race ? "clock" : undefined} />
        <ModeState loading={loading && !deal} error={deal ? null : loadError} onRetry={() => void load()} />

        {deal && phase === "intro" ? (
          <View style={styles.intro}>
            <Text style={styles.introText}>{gameIntro(game, track)}</Text>
            <Text style={styles.meta}>
              {deal.gamesToday >= deal.gamesPerDay
                ? `Today's ${deal.gamesPerDay} games that earn XP are done. This one is for fun.`
                : `Earns XP: ${deal.gamesPerDay - deal.gamesToday} of today's ${deal.gamesPerDay} games left.`}
            </Text>
            <Button label={playful ? "Let's play!" : "Start"} icon="play" block onPress={start} />
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
            ) : (
              <View style={styles.dotsRow}>
                <View style={styles.dots}>
                  {deal.rounds.map((_, i) => (
                    <View key={i} style={[styles.dot, i < marks.length && (marks[i] ? styles.dotRight : styles.dotWrong), i === index && marks.length === i && styles.dotNow]} />
                  ))}
                </View>
                {combo >= 2 ? <Combo n={combo} styles={styles} c={c} /> : null}
              </View>
            )}

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
                  <Text style={styles.verdictTitle}>{said.title}</Text>
                  <Text style={styles.verdictLine} numberOfLines={2}>{said.line}</Text>
                </View>
                <Button label={index + 1 >= deal.rounds.length ? "Finish" : "Next"} size="sm" onPress={next} />
              </View>
            ) : null}
          </>
        ) : null}

        {phase === "sending" ? (
          <View style={styles.intro}>
            <Text style={styles.introText}>{sendError ? "Your answers didn't reach us." : "Marking your answers…"}</Text>
            {sendError ? (
              <>
                <ProblemNote sentence>{sendError}</ProblemNote>
                <Button label="Send them again" icon="retry" block onPress={() => void finish(race ? answersRef.current : answers)} />
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
            <Button label="Play again" icon="restart" block onPress={() => void load()} />
            <Button label="Back to Practice" variant="secondary" block onPress={() => navigation.goBack()} />
          </View>
        ) : null}
      </Screen>
      <Confetti burst={burst} reduceMotion={reduceMotion} />
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

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
  });
