/**
 * Warm up (board c-practice/6d): about three minutes, ticked off step by step — breathe, lip trills and sirens with
 * the app's own synth playing the guide a step higher each round, then the range finder: the lowest comfortable note,
 * the highest, and the range said plainly (notes, span, solfa on doh C, a keyboard, the choir part it sits well in).
 *
 * Nothing here is marked or earns XP: breath, trills and sirens have no right notes, and the range is measured, not
 * scored (`POST /api/practice/range`, kept on the account). On a phone the range finder listens for a few seconds
 * and the server reads the steadiest held note; there is no live trace until a store build adds a pitch stream.
 * The result's two switches (`PUT /api/practice/range/settings`): practice placed in the range (the server places the
 * path's drills and the modes' exercises), and Learn my part starting on the range's part, which the phone keeps as the
 * remembered part (`nf.practice.part`, read by the Result screen) when turned on and after each measurement while on.
 */

import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Icon } from "../../components/Icon";
import { useNavigation } from "@react-navigation/native";
import Svg, { Circle, Polyline, Rect, Text as SvgText } from "react-native-svg";
import { practiceApi } from "../../api/endpoints";
import { toApiError } from "../../api/client";
import type { PracticeTrack, VoiceRange, WarmUp, WarmUpGuide } from "../../api/types";
import { Screen } from "../../components/Screen";
import { Button } from "../../components/Button";
import { ProblemNote } from "../../components/ProblemNote";
import { Touchable } from "../../components/Touchable";
import { Art } from "../../components/practice/Art";
import { ModeHeader } from "../../components/practice/ModeHeader";
import { RangeKeyboard } from "../../components/practice/RangeKeyboard";
import { guideClip } from "../../lib/modeAudio";
import {
  RANGE_TAKE_SECONDS,
  breathAt,
  breathSeconds,
  guideRoundAt,
  guideShape,
  heardLine,
  minutesLabel,
  rangeHeadline,
  rangeInstruction,
  rangeSolfaLine,
  rangeTip,
  rangeTitle,
  voicePartLine,
  warmUpSteps,
} from "../../lib/practiceModes";
import { MicDenied, useModeTake } from "../../lib/useModeTake";
import { logAnalyticsEvent } from "../../lib/analytics";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { LiveDot, ModeFooter } from "./shared";

type View_ = { at: "routine" } | { at: "range"; end: "low" | "high" } | { at: "result" };

/** The part Learn my part opens on (ResultScreen's key): the range's, when the singer asked for that. */
const PRACTICE_PART_KEY = "nf.practice.part";
function rememberRangePart(r: VoiceRange) {
  if (r.learnPartFromRange && r.voicePart) AsyncStorage.setItem(PRACTICE_PART_KEY, r.voicePart).catch(() => undefined);
}

export function WarmUpScreen({ track }: { track: PracticeTrack | null }) {
  const nav = useNavigation();
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const take = useModeTake();
  const playful = track === "playful";

  const [warmUp, setWarmUp] = useState<WarmUp | null>(null);
  const [range, setRange] = useState<VoiceRange | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [view, setView] = useState<View_>({ at: "routine" });
  const [error, setError] = useState<string | null>(null);
  /** Which end the last measurement was of: its note is shown on that end's screen only. */
  const [heardEnd, setHeardEnd] = useState<"low" | "high" | null>(null);
  /** The breathing guide's start (wall clock), while it runs. */
  const [breathFrom, setBreathFrom] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [savingRange, setSavingRange] = useState(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const load = async () => {
    setLoadError(null);
    try {
      const [w, r] = await Promise.all([practiceApi.warmUp(), practiceApi.range().catch(() => null)]);
      if (!live.current) return;
      setWarmUp(w);
      setRange(r);
    } catch (e) {
      if (live.current) setLoadError(toApiError(e).message);
    }
  };
  useEffect(() => { void load(); }, []);

  // The breathing guide's clock.
  useEffect(() => {
    if (breathFrom == null) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [breathFrom]);

  const steps = warmUp ? warmUpSteps(warmUp) : [];
  const step = steps[current];
  const breath = step?.kind === "breath" && step.breath ? step.breath : null;
  const breathNow = breath ? breathAt(breath, breathFrom != null ? (now - breathFrom) / 1000 : -1) : null;
  const breathDone = breathFrom != null && !!breathNow?.done;

  // The breathing guide ends by itself and the routine moves on to the next step.
  useEffect(() => {
    if (breathDone) goTo(current + 1);
    // `goTo` only reads state and calls setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breathDone]);

  function goTo(i: number) {
    take.stopPlaying();
    setBreathFrom(null);
    setError(null);
    setCurrent(Math.max(0, Math.min(steps.length - 1, i)));
  }

  function playGuide(guide: WarmUpGuide) {
    if (take.playing === "guide") { take.stopPlaying(); return; }
    setError(null);
    try {
      const clip = guideClip(guide);
      take.play(clip.wav, clip.seconds, "guide");
      void logAnalyticsEvent("warm_up_guide_played", { step: step?.id ?? "" });
    } catch {
      setError("Could not play the guide. Please try again.");
    }
  }

  async function measure(end: "low" | "high") {
    setError(null);
    try {
      const got = await take.record({ clipBase64: null, leadInSec: 0, seconds: RANGE_TAKE_SECONDS, send: (uri) => practiceApi.measureRange(uri, end) });
      if (!got || !live.current) return;
      setRange(got.value);
      setHeardEnd(end);
      rememberRangePart(got.value);
    } catch (e) {
      if (live.current) setError(e instanceof MicDenied ? e.message : toApiError(e).message);
    }
  }

  // ── The range finder ─────────────────────────────────────────────────────
  if (view.at === "range") {
    const end = view.end;
    const recording = take.phase === "live";
    const sending = take.phase === "sending";
    const heard = range?.heard && heardEnd === end && !recording && !sending ? range.heard : null;
    const measured = end === "low" ? range?.low : range?.high;
    return (
      <View style={styles.flex}>
        <Screen scroll contentStyle={styles.screen}>
          <ModeHeader eyebrow="Find your range" title={rangeTitle(end)} pill={end === "low" ? "1 of 2" : "2 of 2"} onBack={() => { take.cancel(); setView({ at: "routine" }); }} />
          <Text style={styles.lead}>{rangeInstruction(end)}</Text>
          <View style={styles.bigNoteBox} accessibilityLiveRegion="polite">
            {recording ? (
              <>
                <View style={styles.listening}><Icon name="mic" size={30} color={c.link} /></View>
                <Text style={styles.bigSub}>Listening · {Math.min(RANGE_TAKE_SECONDS, take.elapsed).toFixed(1)} of {RANGE_TAKE_SECONDS} s</Text>
                <View style={styles.holdTrack}>
                  <View style={[styles.holdFill, { width: `${Math.min(100, (take.elapsed / RANGE_TAKE_SECONDS) * 100)}%` }]} />
                </View>
              </>
            ) : sending ? (
              <>
                <ActivityIndicator color={c.accent} />
                <Text style={styles.bigSub}>Finding your steadiest note…</Text>
              </>
            ) : heard ? (
              <>
                <Text style={styles.bigNote}>{heard.name}</Text>
                <Text style={styles.bigSub}>{heardLine(heard)}</Text>
              </>
            ) : (
              <>
                <Text style={[styles.bigNote, styles.bigNoteIdle]}>{measured ?? "?"}</Text>
                <Text style={styles.bigSub}>{measured ? "Measured before. Sing it again any day." : `Press Start, then hold the note for about ${RANGE_TAKE_SECONDS} seconds.`}</Text>
              </>
            )}
          </View>
          {error ? <ProblemNote>{error}</ProblemNote> : null}
          <View style={styles.tip} accessible accessibilityLabel={`Doh says: ${rangeTip(end)}`}>
            <Art name={recording ? "doh-sing" : "doh-encourage"} width={56} />
            <View style={styles.bubble}>
              <Text style={styles.bubbleText}>{rangeTip(end)}</Text>
            </View>
          </View>
        </Screen>
        <ModeFooter status={recording ? <LiveDot label="Listening" /> : null}>
          {recording ? (
            <Button label="Stop" icon="stop" variant="secondary" onPress={() => void take.finish()} />
          ) : sending ? (
            <Button label="Measuring…" loading />
          ) : heard ? (
            <>
              <Button label="Again" variant="secondary" onPress={() => void measure(end)} loading={take.starting} />
              <Button
                label={end === "low" ? "Now your highest" : "See my range"}
                icon="next"
                iconPosition="right"
                onPress={() => { setError(null); end === "low" ? setView({ at: "range", end: "high" }) : setView({ at: "result" }); }}
              />
            </>
          ) : (
            <Button label="Start" icon="mic" onPress={() => void measure(end)} loading={take.starting} />
          )}
        </ModeFooter>
      </View>
    );
  }

  async function saveRangeSettings(change: { practiceInRange?: boolean; learnPartFromRange?: boolean }) {
    setSavingRange(true);
    setError(null);
    try {
      const got = await practiceApi.rangeSettings(change);
      if (!live.current) return;
      setRange((r) => (r ? { ...r, practiceInRange: got.practiceInRange, learnPartFromRange: got.learnPartFromRange } : got));
      if (change.learnPartFromRange) rememberRangePart(got);
      const [name, value] = Object.entries(change)[0] ?? ["", ""];
      void logAnalyticsEvent("range_setting", { [name]: String(value) });
    } catch (e) {
      if (live.current) setError(toApiError(e).message);
    } finally {
      if (live.current) setSavingRange(false);
    }
  }

  if (view.at === "result" && range) {
    const headline = rangeHeadline(range);
    const part = voicePartLine(range.voicePart);
    const solfa = rangeSolfaLine(range);
    return (
      <View style={styles.flex}>
        <Screen scroll contentStyle={styles.screen}>
          <ModeHeader eyebrow="Find your range" title="Your range" onBack={() => setView({ at: "routine" })} />
          <Text style={styles.rangeHeadline} accessibilityRole="header">{headline ?? "Not measured yet"}</Text>
          {range.span ? <Text style={styles.rangeSpan}>{range.span}, comfortably</Text> : null}
          {solfa ? <Text style={styles.rangeSolfa}>{solfa}</Text> : null}
          {range.lowMidi != null && range.highMidi != null ? (
            <View style={styles.keyboard}>
              <RangeKeyboard lowMidi={range.lowMidi} highMidi={range.highMidi} />
            </View>
          ) : null}
          {part ? (
            <View style={styles.partCard}>
              <Icon name="choir" size={20} color={c.icon} />
              <View style={styles.flexText}>
                <Text style={styles.partTitle}>{part}</Text>
                <Text style={styles.partSub}>A guide for choir parts, not a label</Text>
              </View>
            </View>
          ) : null}
          {range.lowMidi != null && range.highMidi != null ? (
            <>
              <RangeSwitch
                icon="music"
                title="Practise in my range"
                hint="Drills and exercises come in keys your voice holds."
                value={range.practiceInRange !== false}
                disabled={savingRange}
                onChange={(on) => void saveRangeSettings({ practiceInRange: on })}
              />
              {range.voicePart ? (
                <RangeSwitch
                  icon="choir"
                  title={`Start Learn my part on ${range.voicePart}`}
                  hint="Your sheets' parts open on the one your range suits."
                  value={!!range.learnPartFromRange}
                  disabled={savingRange}
                  onChange={(on) => void saveRangeSettings({ learnPartFromRange: on })}
                />
              ) : null}
            </>
          ) : null}
          {error ? <ProblemNote>{error}</ProblemNote> : null}
          <Text style={[styles.note, styles.rangeNote]}>Voices warm up and change. Measure again any day.</Text>
        </Screen>
        <ModeFooter>
          <Button label="Measure again" variant="secondary" onPress={() => setView({ at: "range", end: "low" })} />
          <Button label="Done" onPress={() => { setView({ at: "routine" }); goTo(steps.length - 1); }} />
        </ModeFooter>
      </View>
    );
  }

  // ── The routine ──────────────────────────────────────────────────────────
  return (
    <View style={styles.flex}>
      <Screen scroll contentStyle={styles.screen}>
        <ModeHeader eyebrow="Warm up" title={playful ? "Warm up with Doh" : "Voice warm-up"} pill={warmUp ? minutesLabel(warmUp.totalSeconds) : null} pillIcon="clock" />
        {loadError ? (
          <View style={styles.failed}>
            <ProblemNote>{loadError}</ProblemNote>
            <Button label="Try again" icon="retry" variant="secondary" onPress={() => void load()} />
          </View>
        ) : !warmUp ? (
          <ActivityIndicator color={c.accent} style={styles.loading} />
        ) : (
          <View style={styles.steps}>
            {steps.map((s, i) => {
              const done = i < current;
              const now_ = i === current;
              const last = i === steps.length - 1;
              return (
                <View key={s.id} style={styles.step}>
                  {!last ? <View style={styles.rail} /> : null}
                  <Touchable onPress={() => goTo(i)} radius={15} accessibilityLabel={`Step ${s.number}: ${s.title}${done ? ", done" : now_ ? ", now" : ""}`} hitSlop={8}>
                    <View style={[styles.dot, done && styles.dotDone, now_ && styles.dotNow]}>
                      {done ? <Icon name="check" size={16} strokeWidth={2.25} color={c.success} /> : <Text style={[styles.dotText, now_ && styles.dotTextNow]}>{s.number}</Text>}
                    </View>
                  </Touchable>
                  <View style={styles.stepBody}>
                    <View style={styles.stepHead}>
                      <Text style={styles.stepTitle}>{s.title}</Text>
                      <Text style={styles.stepClock}>{s.clock}</Text>
                    </View>
                    <Text style={styles.stepText}>{s.instruction}</Text>
                    {now_ && s.kind === "breath" && breath ? (
                      <View style={styles.inner}>
                        {breathNow && breathFrom != null ? (
                          <View style={styles.breathBox} accessibilityLiveRegion="polite">
                            <Text style={styles.breathWord}>{breathNow.word}</Text>
                            <Text style={styles.breathCount}>{breathNow.count}</Text>
                            <Text style={styles.stepText}>Round {breathNow.cycle} of {breath.cycles}</Text>
                          </View>
                        ) : (
                          <Text style={styles.stepText}>About {Math.round(breathSeconds(breath))} seconds. Follow the words as they change.</Text>
                        )}
                        <View style={styles.innerActions}>
                          <Button
                            label={breathFrom != null ? "Stop" : "Start breathing"}
                            icon={breathFrom != null ? "stop" : "play"}
                            size="sm"
                            variant={breathFrom != null ? "secondary" : "primary"}
                            onPress={() => { if (breathFrom != null) setBreathFrom(null); else { setNow(Date.now()); setBreathFrom(Date.now()); } }}
                          />
                          <Button label="Next" variant="text" size="sm" onPress={() => goTo(i + 1)} />
                        </View>
                      </View>
                    ) : null}
                    {now_ && s.kind === "guide" && s.guide ? (
                      <View style={styles.inner}>
                        <Text style={styles.innerText}>{s.guide.rounds} rounds, a step higher each time. {s.guide.glide ? "One smooth line, no steps." : "Keep the air steady and let the lips buzz."}</Text>
                        <GuideShape guide={s.guide} />
                        {take.playing === "guide" ? (
                          <Text style={styles.round} accessibilityLiveRegion="polite">Round {guideRoundAt(s.guide, take.elapsed)} of {s.guide.rounds}</Text>
                        ) : null}
                        <View style={styles.innerActions}>
                          <Button
                            label={take.playing === "guide" ? "Stop" : "Play the guide"}
                            icon={take.playing === "guide" ? "stop" : "play"}
                            size="sm"
                            variant={take.playing === "guide" ? "secondary" : "primary"}
                            onPress={() => playGuide(s.guide!)}
                          />
                          <Button label="Next" variant="text" size="sm" onPress={() => goTo(i + 1)} />
                        </View>
                      </View>
                    ) : null}
                    {now_ && s.kind === "range" ? (
                      <View style={styles.inner}>
                        {rangeHeadline(range ?? { low: null, high: null }) ? (
                          <Text style={styles.innerText}>Last time: {rangeHeadline(range!)}{range?.voicePart ? ` · ${voicePartLine(range.voicePart)}` : ""}.</Text>
                        ) : (
                          <Text style={styles.innerText}>Two short takes: your lowest easy note, then your highest.</Text>
                        )}
                        <View style={styles.innerActions}>
                          <Button label="Find my range" icon="mic" size="sm" onPress={() => { take.stopPlaying(); setView({ at: "range", end: "low" }); }} />
                          {range?.low && range?.high ? <Button label="See it" variant="text" size="sm" onPress={() => setView({ at: "result" })} /> : null}
                        </View>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}
        {error ? <ProblemNote>{error}</ProblemNote> : null}
        {warmUp ? (
          <View style={styles.infoRow}>
            <Icon name="about" size={16} color={c.textFaint} />
            <Text style={styles.note}>Warm-ups aren't marked or scored. They get your voice ready for today's path.</Text>
          </View>
        ) : null}
      </Screen>
      <ModeFooter>
        <Button label="Skip to the path" variant="secondary" onPress={() => { take.stopPlaying(); nav.goBack(); }} />
      </ModeFooter>
    </View>
  );
}

/** The guide's one round, drawn: a block per note and a line through them (a siren is the line alone). */
function GuideShape({ guide }: { guide: WarmUpGuide }) {
  const c = useColors();
  const [width, setWidth] = useState(0);
  const points = guideShape(guide);
  const H = 96;
  const top = 10;
  const span = H - 34;
  const px = (x: number) => 10 + x * (width - 20);
  const py = (y: number) => top + y * span;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible accessibilityRole="image" accessibilityLabel={`The guide: ${points.map((p) => p.solfa).join(" ")}`}>
      {width > 0 ? (
        <Svg width={width} height={H}>
          {!guide.glide
            ? points.map((p, i) => <Rect key={i} x={px(p.x) - 12} y={py(p.y) - 4} width={24} height={8} rx={4} fill={c.accentSoft} />)
            : null}
          <Polyline
            points={points.map((p) => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ")}
            fill="none"
            stroke={c.link}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {points.map((p, i) => (
            <React.Fragment key={`l${i}`}>
              {guide.glide ? <Circle cx={px(p.x)} cy={py(p.y)} r={3} fill={c.link} /> : null}
              <SvgText x={px(p.x)} y={H - 6} fontSize={11} fontFamily={fonts.medium} fill={c.textFaint} textAnchor="middle">{p.solfa}</SvgText>
            </React.Fragment>
          ))}
        </Svg>
      ) : (
        <View style={{ height: H }} />
      )}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
    screen: { paddingBottom: spacing.xl },
    loading: { marginTop: spacing.xxl },
    failed: { gap: spacing.md, marginTop: spacing.lg },
    lead: { ...typography.body, color: c.textMuted, fontSize: 15, lineHeight: 22 },

    steps: { marginTop: spacing.xs },
    step: { flexDirection: "row", gap: 14, paddingBottom: spacing.lg },
    rail: { position: "absolute", left: 14.5, top: 32, bottom: 0, width: 1, backgroundColor: c.border },
    dot: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceAlt },
    dotDone: { backgroundColor: c.accentSoft },
    dotNow: { backgroundColor: c.primary },
    dotText: { fontFamily: fonts.semibold, fontSize: 13, color: c.textMuted },
    dotTextNow: { color: c.onAccent },
    stepBody: { flex: 1, minWidth: 0, paddingTop: 4 },
    stepHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
    stepTitle: { fontFamily: fonts.semibold, fontSize: 16, color: c.text },
    stepClock: { fontFamily: fonts.medium, fontSize: 13, color: c.textFaint },
    stepText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.textMuted, marginTop: 3 },
    inner: { marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, gap: spacing.sm },
    innerText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: c.textMuted },
    innerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
    round: { fontFamily: fonts.semibold, fontSize: 13, color: c.link },
    breathBox: { alignItems: "center", paddingVertical: spacing.sm },
    breathWord: { fontFamily: fonts.semibold, fontSize: 22, color: c.text },
    breathCount: { fontFamily: fonts.bold, fontSize: 44, color: c.link, marginVertical: 2 },
    infoRow: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: spacing.sm },
    note: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: c.textFaint },

    bigNoteBox: { alignItems: "center", gap: 6, paddingVertical: spacing.xl, marginTop: spacing.md },
    bigNote: { fontFamily: fonts.bold, fontSize: 64, letterSpacing: -1.5, color: c.text },
    bigNoteIdle: { color: c.textFaint },
    listening: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceAlt, marginBottom: spacing.sm },
    rangeNote: { flex: 0, marginTop: spacing.md },
    bigSub: { fontFamily: fonts.regular, fontSize: 15, color: c.textMuted, textAlign: "center" },
    holdTrack: { width: "70%", height: 6, borderRadius: 3, backgroundColor: c.surfaceAlt, overflow: "hidden", marginTop: spacing.sm },
    holdFill: { height: 6, borderRadius: 3, backgroundColor: c.success },
    tip: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xl },
    bubble: { flex: 1, padding: spacing.md, borderRadius: radii.lg, borderTopLeftRadius: 4, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    bubbleText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: c.text },

    rangeHeadline: { fontFamily: fonts.bold, fontSize: 44, letterSpacing: -1.2, color: c.text, marginTop: spacing.sm },
    rangeSpan: { fontFamily: fonts.regular, fontSize: 16, color: c.textMuted, marginTop: 4 },
    rangeSolfa: { ...typography.mono, fontSize: 16, color: c.link, marginTop: spacing.sm },
    keyboard: { marginTop: spacing.lg },
    partCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.lg, padding: spacing.md, borderRadius: radii.md, backgroundColor: c.surfaceAlt },
    flexText: { flex: 1, minWidth: 0 },
    partTitle: { fontFamily: fonts.semibold, fontSize: 16, color: c.text },
    partSub: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 2 },
    switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    switchTitle: { fontFamily: fonts.medium, fontSize: 15, color: c.text },
    switchHint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.textMuted, marginTop: 2 },
  });

/** One of the range card's two switches, the headphones row's shape. */
function RangeSwitch({ icon, title, hint, value, disabled, onChange }: {
  icon: "music" | "choir";
  title: string;
  hint: string;
  value: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.switchRow}>
      <Icon name={icon} size={20} color={c.icon} />
      <View style={styles.flexText}>
        <Text style={styles.switchTitle}>{title}</Text>
        <Text style={styles.switchHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: c.grabber, true: c.primary }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={c.grabber}
        accessibilityLabel={title}
      />
    </View>
  );
}
