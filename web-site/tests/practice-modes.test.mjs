// node --test web-site/tests/*.test.mjs
// practice-modes.js is "More ways to practise": the hub's rows, the warm-up's timeline and the range finder, pitch
// match's timed set and its needle words, a run's blocks, speeds and drawn line, and a rhythm's claps. The mobile copy
// (mobile/src/lib/practiceModes.test.ts) has the same cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/practice-modes.js", import.meta.url), "utf8"), { window });
const M = window.NfPracticeModes;
// Objects made in the vm context have its Object prototype: compare them as plain data.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
const {
  CLOSE_CENTS,
  IN_TUNE_CENTS,
  MODE_IDS,
  breathAt,
  breathPhases,
  breathSeconds,
  centsOff,
  centsText,
  clapLayout,
  clapMarks,
  clapSyllable,
  clockLabel,
  firstOpenRun,
  firstSungPitch,
  flatKey,
  glideMidiAt,
  glideRounds,
  guideNotes,
  guideRoundAt,
  guideSeconds,
  guideShape,
  heardLine,
  hearVoices,
  hubModes,
  intervalParts,
  markTone,
  markingBands,
  midiName,
  minutesLabel,
  modeTitle,
  modesDohLine,
  modesHeading,
  needleAngle,
  needleWords,
  needleZone,
  nextSpeed,
  noteCaption,
  noteDue,
  noteMarks,
  passageSeconds,
  pitchAdvice,
  pitchMomentAt,
  pitchSlots,
  progressStrip,
  rangeHeadline,
  rangeKeys,
  rangeSolfaLine,
  rhythmAdvice,
  rollRowOf,
  runAdvice,
  runRoll,
  runShapeLines,
  speedCaption,
  speedSteps,
  syllableName,
  takeSeconds,
  takeSound,
  traceOnRoll,
  unitRuns,
  voicePartLine,
  warmUpSteps,
} = M;

const n = (pitchMidi, startBeat, durBeats, solfa, octaveMark = "") =>
  ({ pitchMidi, startBeat, durBeats, degree: 1, solfa, octaveMark, conf: 1 });
const mark = (index, status, cents) =>
  ({ index, targetMidi: 60, sungMidi: null, cents, status });

const exercise = (over) => ({
  id: "x",
  mode: "pitch-match",
  code: "x",
  title: "X",
  prompt: "",
  group: null,
  key: "D major",
  dohHeader: "Doh is D",
  tempoBpm: 60,
  timeSignature: "4/4",
  notes: [],
  backing: [],
  claps: [],
  maxTakeSeconds: 60,
  grader: "notes",
  bestScore: null,
  speedPercent: null,
  speeds: null,
  ...over,
});

// The server's pitch-match set "Doh, me and soh" on D: a tone for two beats, then four held (ModeCatalogue).
const pitchSet = exercise({
  notes: [n(62, 2, 4, "d"), n(66, 8, 4, "m"), n(69, 14, 4, "s")],
  backing: [n(62, 0, 2, "d"), n(66, 6, 2, "m"), n(69, 12, 2, "s")],
});

test("the hub lists the server's live modes in its order, in the track's words, and nothing it doesn't know", () => {
  same([...MODE_IDS], ["warm-up", "pitch-match", "runs", "intervals", "harmony", "rhythm"]);
  const focused = hubModes(["warm-up", "pitch-match", "runs", "intervals", "harmony", "rhythm"], "focused", true);
  same(focused.map((r) => r.title), ["Warm up", "Pitch match", "Riffs & runs", "Intervals", "Sing the harmony", "Rhythm"]);
  assert.equal(focused[0].subtitle, "Breath, sirens, your range");
  assert.equal(focused[0].value, "3 min");
  assert.equal(focused[1].subtitle, "Hold a note in tune on a live meter");
  assert.equal(focused[1].value, null);
  const playful = hubModes(["warm-up", "pitch-match", "intervals", "rhythm"], "playful", true);
  same(playful.map((r) => r.title), ["Warm up", "Pitch match", "Jump to the note", "Clap it back"]);
  same(playful.map((r) => r.subtitle), ["Wake your voice up with Doh", "Keep the needle in the green", "From doh up to soh, and more", "Copy the rhythm"]);
  // A mode switched off on the server is simply absent; an unknown one (a newer server) is skipped; null lists none.
  same(hubModes(["rhythm", "karaoke", "warm-up", "rhythm"], "focused", true).map((r) => r.id), ["rhythm", "warm-up"]);
  same(hubModes(null, "focused", true), []);
});

test("a phone never promises the live meter it does not have", () => {
  assert.equal(hubModes(["pitch-match"], "focused", false)[0].subtitle, "Hear a note, hold it, see how close");
  assert.equal(hubModes(["pitch-match"], "playful", false)[0].subtitle, "Hear a note, then hold it steady");
  for (const r of hubModes(MODE_IDS, "focused", false)) assert.doesNotMatch(r.subtitle, /meter|needle/);
});

test("the section's heading and Doh: Playful plays, Focused gets one small Doh suggesting the warm-up", () => {
  assert.equal(modesHeading("playful"), "More ways to play");
  assert.equal(modesHeading("focused"), "More ways to practise");
  assert.equal(modesHeading(null), "More ways to practise");
  const all = hubModes(MODE_IDS, "focused", true);
  assert.equal(modesDohLine(all, "focused"), "Warm up first? It makes the high notes easier.");
  assert.equal(modesDohLine(all.slice(1), "focused"), "Hold one note in tune first. It wakes the ear up.");
  assert.equal(modesDohLine(all, "playful"), null); // Playful's Doh is the buddy at the top: one bird on screen
  assert.equal(modesDohLine([], "focused"), null);
  assert.equal(modeTitle("rhythm", "playful"), "Clap it back");
  assert.equal(modeTitle("intervals", "focused"), "Intervals");
});

test("the streak and level fit one line: 6-day streak | Me · 312 XP, 188 to Fah", () => {
  const me = { index: 2, name: "Me", minXp: 250, nextLevelXp: 500, nextName: "Fah", xpForNext: 188 };
  const strip = progressStrip({ streak: { current: 6 }, level: me, xp: 312 });
  assert.equal(strip.streak, "6-day streak");
  assert.equal(strip.level, "Me");
  assert.equal(strip.xp, "312 XP");
  assert.equal(strip.toNext, "188 to Fah");
  assert.ok(Math.abs(strip.fraction - 62 / 250) < 1e-9);
  assert.equal(strip.label, "6-day streak. Level Me, 312 XP, 188 XP to Fah.");
  const top = progressStrip({ streak: { current: 0 }, level: { ...me, nextLevelXp: null, nextName: null, xpForNext: 0 }, xp: 9000 });
  assert.equal(top.streak, "No streak yet");
  const lapsed = M.progressStrip({ streak: { current: 0, best: 30 }, level: me, xp: 312 });
  assert.equal(lapsed.streak, "Your best: 30 days");
  assert.equal(lapsed.label, "No streak now. Your best: 30 days. Level Me, 312 XP, 188 XP to Fah.");
  assert.equal(top.toNext, null);
  assert.equal(top.xp, "9,000 XP");
  const far = progressStrip({ streak: { current: 1 }, level: { ...me, xpForNext: 1250 }, xp: 12450 });
  assert.equal(far.xp, "12,450 XP");
  assert.equal(far.toNext, "1,250 to Fah");
  assert.equal(far.label, "1-day streak. Level Me, 12,450 XP, 1,250 XP to Fah.");
  assert.equal(top.fraction, 1);
});

test("a take runs the count-in, the passage and a second, never past what the worker keeps", () => {
  assert.equal(passageSeconds(pitchSet), 18);
  assert.equal(takeSeconds(pitchSet, 4), 23);
  assert.equal(takeSeconds({ ...pitchSet, maxTakeSeconds: 20 }, 4), 20);
  const rhythm = exercise({ tempoBpm: 80, claps: [{ startBeat: 0, durBeats: 1 }, { startBeat: 1, durBeats: 2 }] });
  assert.equal(passageSeconds(rhythm), 3 * 0.75);
  assert.equal(firstSungPitch(pitchSet), 62);
  assert.equal(firstSungPitch(rhythm), null);
  assert.equal(noteDue(pitchSet.notes, 60, 3), 0);
  assert.equal(noteDue(pitchSet.notes, 60, 7), -1); // the second tone, not a sung note
  assert.equal(noteDue(pitchSet.notes, 60, 9), 1);
});

test("a take plays the count-in and only what the mode plays under the singer", () => {
  // leadInPlan at 60 BPM in 4/4: the first note held a beat, then four clicks to beat one.
  const countIn = { beats: 5, holdBeats: 1, beatsPerBar: 4, beatSec: 1, seconds: 5 };
  const pm = takeSound({ ...pitchSet, mode: "pitch-match" }, countIn);
  assert.equal(pm.countInBeats, 5);
  same(pm.voices.map((v) => [v.gain, v.notes.map((x) => [x.pitchMidi, x.startBeat, x.durBeats])]), [
    [0.9, [[62, -5, 1]]], // the pitch pipe, inside the count-in
    [0.9, [[62, 0, 2], [66, 6, 2], [69, 12, 2]]], // each note's tone; the held notes themselves are the singer's
  ]);
  const harmony = exercise({ mode: "harmony", notes: [n(66, 0, 1, "m"), n(67, 1, 1, "f")], backing: [n(62, 0, 1, "d"), n(64, 1, 1, "r")] });
  same(takeSound(harmony, countIn).voices.map((v) => v.gain), [0.9]); // no headphones: the singer alone
  same(takeSound(harmony, countIn, true).voices.map((v) => v.gain), [0.9, 0.25]); // the tune soft in the ears
  const rhythm = exercise({ mode: "rhythm", claps: [{ startBeat: 0, durBeats: 1 }] });
  same(takeSound(rhythm, countIn).voices, []); // clicks only
  same(takeSound(exercise({ mode: "intervals", notes: [n(62, 0, 2, "d"), n(69, 2, 2, "s")] }), { ...countIn, holdBeats: 0 }).voices, []);
});

test("hear it: a harmony line with the tune soft under it, a pitch-match set one note to a beat", () => {
  const harmony = exercise({ mode: "harmony", notes: [n(66, 0, 1, "m")], backing: [n(62, 0, 1, "d")] });
  same(hearVoices(harmony).map((v) => [v.gain, v.notes.length]), [[1, 1], [0.25, 1]]);
  same(hearVoices({ ...pitchSet, mode: "pitch-match" })[0].notes.map((x) => [x.pitchMidi, x.startBeat, x.durBeats]), [[62, 0, 1], [66, 1, 1], [69, 2, 1]]);
  same(hearVoices(exercise({ mode: "runs", notes: [n(70, 0, 0.25, "d", "'")] })).map((v) => v.gain), [1]);
});

test("notes are named as a singer says them, and spelled as the key spells them", () => {
  assert.equal(syllableName("s", ""), "soh");
  assert.equal(syllableName("d", "'"), "high doh");
  assert.equal(syllableName("t", ","), "low te");
  assert.equal(syllableName("fe", ""), "fe");
  assert.equal(midiName(69), "A4");
  assert.equal(midiName(70), "A#4");
  assert.equal(midiName(70, true), "Bb4");
  assert.equal(midiName(55), "G3");
  assert.equal(flatKey("Doh is Bb"), true);
  assert.equal(flatKey("Doh is F"), true);
  assert.equal(flatKey("Doh is F#"), false);
  assert.equal(flatKey("Doh is D"), false);
  assert.equal(noteCaption(n(69, 0, 1, "s"), 2, 8, false), "soh · A4 · note 3 of 8");
  assert.equal(noteCaption(n(74, 0, 1, "d", "'"), 3, 8, false), "high doh · D5 · note 4 of 8");
});

test("marks: green in tune, amber close, grey off (never red), dashed not sung; cents with a real minus", () => {
  assert.equal(markTone("hit"), "hit");
  assert.equal(markTone("near"), "near");
  assert.equal(markTone("wrong"), "off");
  assert.equal(markTone("missed"), "missed");
  assert.equal(centsText(6.4), "+6");
  assert.equal(centsText(-48), "−48");
  assert.equal(centsText(0.2), "0");
  assert.equal(centsText(null), "");
  const marks = noteMarks({ notes: [mark(0, "hit", 3), mark(1, "wrong", 140), mark(2, "missed", null)] }, pitchSet.notes);
  same(marks, [
    { index: 0, text: "d", cents: "+3", tone: "hit" },
    { index: 1, text: "m", cents: "+140", tone: "off" },
    { index: 2, text: "s", cents: "—", tone: "missed" },
  ]);
});

const warmUp = {
  totalSeconds: 180,
  steps: [
    { id: "breathe", kind: "breath", title: "Breathe", instruction: "", seconds: 45, breath: { inCounts: 4, holdCounts: 4, outCounts: 8, countsPerMinute: 64, cycles: 3 }, guide: null },
    { id: "lip-trills", kind: "guide", title: "Lip trills", instruction: "", seconds: 60, breath: null, guide: { key: "C major", dohHeader: "Doh is C", tempoBpm: 92, notes: [n(60, 0, 0.5, "d"), n(62, 0.5, 0.5, "r"), n(64, 1, 0.5, "m"), n(65, 1.5, 0.5, "f"), n(67, 2, 0.5, "s"), n(65, 2.5, 0.5, "f"), n(64, 3, 0.5, "m"), n(62, 3.5, 0.5, "r"), n(60, 4, 2, "d")], rounds: 5, stepSemitones: 1, glide: false } },
    { id: "sirens", kind: "guide", title: "Sirens on \"ng\"", instruction: "", seconds: 45, breath: null, guide: { key: "C major", dohHeader: "Doh is C", tempoBpm: 60, notes: [n(60, 0, 2, "d"), n(67, 2, 2, "s"), n(72, 4, 2, "d", "'"), n(67, 6, 2, "s"), n(60, 8, 2, "d")], rounds: 3, stepSemitones: 1, glide: true } },
    { id: "range", kind: "range", title: "Find your range", instruction: "", seconds: 30, breath: null, guide: null },
  ],
};

test("the warm-up's timeline: numbered steps with their clocks, and the routine in whole minutes", () => {
  const steps = warmUpSteps(warmUp);
  same(steps.map((s) => [s.number, s.clock, s.startsAt]), [[1, "0:45", 0], [2, "1:00", 45], [3, "0:45", 105], [4, "0:30", 150]]);
  assert.equal(minutesLabel(warmUp.totalSeconds), "3 min");
  assert.equal(minutesLabel(20), "1 min");
  assert.equal(clockLabel(75), "1:15");
});

test("breathing: in, hold and out at the counts' pace, cycle after cycle, then done", () => {
  const b = warmUp.steps[0].breath;
  const phases = breathPhases(b);
  assert.equal(phases.length, 9);
  same(phases.slice(0, 3).map((p) => [p.phase, p.counts, p.cycle]), [["in", 4, 1], ["hold", 4, 1], ["out", 8, 1]]);
  assert.ok(Math.abs(breathSeconds(b) - 48 * (60 / 64)) < 1e-9);
  same(breathAt(b, 0), { phase: "in", count: 1, cycle: 1, word: "Breathe in", done: false });
  assert.equal(breathAt(b, 4 * (60 / 64) + 0.1).word, "Hold");
  const out = breathAt(b, 8 * (60 / 64) + 2 * (60 / 64) + 0.01);
  assert.equal(out.word, "Out on “sss”");
  assert.equal(out.count, 3);
  assert.equal(breathAt(b, 16 * (60 / 64) + 0.01).cycle, 2);
  assert.equal(breathAt(b, 1000).done, true);
  // A pattern without a hold skips it.
  same(breathPhases({ ...b, holdCounts: 0, cycles: 1 }).map((p) => p.phase), ["in", "out"]);
});

test("a guide plays its pattern a step higher each round, a beat of rest between", () => {
  const g = warmUp.steps[1].guide;
  const notes = guideNotes(g);
  assert.equal(notes.length, 45);
  same(notes.slice(9, 11).map((x) => [x.pitchMidi, x.startBeat, x.solfa]), [[61, 7, "d"], [63, 7.5, "r"]]);
  assert.equal(notes[44].pitchMidi, 64);
  assert.equal(notes[44].startBeat, 4 * 7 + 4);
  assert.ok(Math.abs(guideSeconds(g) - 34 * (60 / 92)) < 1e-9);
  assert.equal(guideRoundAt(g, 0), 1);
  assert.equal(guideRoundAt(g, 7 * (60 / 92) + 0.01), 2);
  assert.equal(guideRoundAt(g, 999), 5);
  const shape = guideShape(g);
  assert.equal(shape.length, 9);
  same([shape[0].y, shape[4].y, shape[8].y], [1, 0, 1]); // up to soh at the top and home
  assert.equal(shape[4].solfa, "s");
});

test("a siren glides in one smooth line through its notes, round by round", () => {
  const g = warmUp.steps[2].guide;
  const rounds = glideRounds(g);
  assert.equal(rounds.length, 3);
  same(rounds[0].map((p) => [p.t, p.midi]), [[0, 60], [2, 67], [4, 72], [6, 67], [8, 60], [10, 60]]);
  assert.equal(rounds[1][0].t, 11);
  assert.equal(rounds[1][0].midi, 61);
  assert.equal(glideMidiAt(rounds[0], 1), 63.5); // halfway from doh to soh
  assert.equal(glideMidiAt(rounds[0], 9), 60);
  assert.equal(glideMidiAt(rounds[0], 10.5), null);
});

test("the range finder says what it heard and the range as notes, solfa, a part and a keyboard", () => {
  assert.equal(heardLine({ name: "A3", seconds: 2.43 }), "A3, held 2.4 s");
  const r = { low: "G3", high: "D5", dohHeader: "Doh is C", lowSolfa: "s,", highSolfa: "r'" };
  assert.equal(rangeHeadline(r), "G3 to D5");
  assert.equal(rangeHeadline({ low: "G3", high: null }), null);
  assert.equal(rangeSolfaLine(r), "With doh on C: s, up to r'");
  assert.equal(voicePartLine("alto"), "Sits well for Alto");
  assert.equal(voicePartLine(null), null);
  const keys = rangeKeys(55, 74);
  assert.equal(keys[0].midi, 48); // from C3
  assert.equal(keys[keys.length - 1].midi, 83); // to B5
  same(keys.filter((k) => k.label).map((k) => k.label), ["C3", "C4", "C5"]);
  assert.equal(keys.filter((k) => k.lit).length, 20);
  assert.equal(keys.find((k) => k.midi === 54).lit, false);
  assert.equal(keys.find((k) => k.midi === 56).black, true);
  assert.equal(rangeKeys(60, 62).length, 24); // at least two octaves
});

test("pitch match: each note's tone then its hold, and where the set is at any moment", () => {
  const slots = pitchSlots(pitchSet);
  same(slots.map((s) => [s.toneStart, s.toneEnd, s.holdStart, s.holdEnd]), [[0, 2, 2, 6], [6, 8, 8, 12], [12, 14, 14, 18]]);
  same(pitchMomentAt(slots, -1), { index: 0, phase: "before", held: 0, holdSeconds: 4 });
  same(pitchMomentAt(slots, 1), { index: 0, phase: "tone", held: 0, holdSeconds: 4 });
  same(pitchMomentAt(slots, 4.4), { index: 0, phase: "hold", held: 2.4000000000000004, holdSeconds: 4 });
  assert.equal(pitchMomentAt(slots, 6.5).phase, "tone");
  assert.equal(pitchMomentAt(slots, 6.5).index, 1);
  assert.equal(pitchMomentAt(slots, 19).phase, "done");
});

test("the needle: cents with octaves taken out, the grader's windows, a direction and what to do", () => {
  assert.ok(Math.abs(centsOff(440, 69)) < 1e-9);
  assert.ok(Math.abs(centsOff(220, 69)) < 1e-9); // an octave down is the same note
  assert.ok(Math.abs(centsOff(440 * 2 ** (6 / 1200), 69) - 6) < 1e-6);
  assert.ok(Math.abs(centsOff(587.33 * 2 ** (-48 / 1200), 74) + 48) < 0.1);
  assert.equal(IN_TUNE_CENTS, 35);
  assert.equal(CLOSE_CENTS, 80);
  assert.equal(needleZone(6), "in");
  assert.equal(needleZone(-35), "in");
  assert.equal(needleZone(-48), "close");
  assert.equal(needleZone(80), "close");
  assert.equal(needleZone(81), "off");
  assert.equal(needleZone(null), "none");
  assert.equal(needleAngle(0), 0);
  assert.equal(needleAngle(-50), -30);
  assert.equal(needleAngle(400), 60);
  assert.equal(needleWords(6, "soh").title, "In tune");
  assert.equal(needleWords(6, "soh").hint, "Sing “ah” on soh and keep the needle in the green.");
  assert.equal(needleWords(-48, "high doh").title, "A little flat");
  assert.equal(needleWords(48, "high doh").title, "A little sharp");
  assert.equal(needleWords(120, "soh").title, "Not quite: find soh again");
  assert.equal(needleWords(null, "soh").title, "Listening…");
});

test("the set's one suggestion names the notes that came in close, from the marks", () => {
  const notes = [n(62, 2, 4, "d"), n(66, 8, 4, "m"), n(74, 14, 4, "d", "'"), n(61, 20, 4, "t", ",")];
  same(pitchAdvice({ notes: [mark(0, "hit", 3), mark(1, "hit", -9), mark(2, "near", -48), mark(3, "near", -41)] }, notes), {
    title: "High doh and low te came in flat",
    body: "Hold just those two, slowly, with the tones.",
    practise: ["d'", "t,"],
  });
  same(pitchAdvice({ notes: [mark(1, "wrong", 95), mark(3, "missed", null)] }, notes), {
    title: "Me came in sharp; low te wasn't heard",
    body: "Hold just those two, slowly, with the tones.",
    practise: ["m", "t,"],
  });
  assert.equal(pitchAdvice({ notes: [mark(0, "hit", 3)] }, notes), null);
  assert.equal(pitchAdvice({ notes: [mark(0, "missed", null)] }, notes).body, "Sing out and hold each note for its four beats.");
});

test("an interval is doh, then the note asked, up or down", () => {
  same(intervalParts({ notes: [n(62, 0, 2, "d"), n(69, 2, 2, "s")], group: "a fifth" }), { from: "doh", to: "soh", up: true, size: "a fifth" });
  same(intervalParts({ notes: [n(74, 0, 2, "d", "'"), n(71, 2, 2, "l")], group: "a minor third" }), { from: "high doh", to: "lah", up: false, size: "a minor third" });
  assert.equal(intervalParts({ notes: [], group: null }), null);
});

// The server's "Pentatonic run" on Bb (d' l s m r d, five semiquavers landing on a held doh).
const run = [n(70, 0, 0.25, "d", "'"), n(67, 0.25, 0.25, "l"), n(65, 0.5, 0.25, "s"), n(62, 0.75, 0.25, "m"), n(60, 1, 0.25, "r"), n(58, 1.25, 2, "d")];
const speeds = [60, 70, 80, 90, 100].map((percent) => ({
  percent,
  exerciseId: `runs:pentatonic@58~${percent}`,
  tempoBpm: Math.round(0.6 * percent),
  shortestNoteSeconds: 0.25 * (60 / Math.round(0.6 * percent)),
  grader: percent <= 80 ? "notes" : "run",
  bestScore: percent === 60 ? 92 : percent === 70 ? 85 : null,
}));

test("a run is drawn as blocks: a row per note it uses, highest first, length across", () => {
  const roll = runRoll(run);
  same(roll.rows.map((r) => r.label), ["d'", "l", "s", "m", "r", "d"]);
  assert.equal(roll.beats, 3.25);
  same(roll.blocks.map((b) => b.row), [0, 1, 2, 3, 4, 5]);
  assert.equal(roll.blocks[5].w, 2 / 3.25);
  assert.equal(rollRowOf(70, roll.rows), 0);
  assert.equal(rollRowOf(58, roll.rows), 5);
  assert.equal(rollRowOf(66, roll.rows), 1 + 1 / 2); // halfway from lah to soh
  assert.equal(rollRowOf(40, roll.rows), 5);
  // The take's line over it: across by beat, points before beat one or after the run dropped.
  const line = traceOnRoll([{ t: -0.1, midi: 70 }, { t: 0, midi: 70 }, { t: 0.25, midi: 67 }, { t: 3.25, midi: 58 }, { t: 4, midi: 58 }], roll, 60);
  same(line, [{ x: 0, y: 0 }, { x: 0.25 / 3.25, y: 1 }, { x: 1, y: 5 }]);
});

test("the speed stepper: slowest first, passed at 80, and where marking turns to shape + landing note", () => {
  const steps = speedSteps(exercise({ notes: run, speeds: [...speeds].reverse() }));
  same(steps.map((s) => s.label), ["60%", "70%", "80%", "90%", "100%"]);
  same(steps.map((s) => s.passed), [true, true, false, false, false]);
  assert.equal(speedCaption(steps[0]), "36 BPM · quick notes 0.42 s");
  assert.equal(speedCaption(steps[2]), "48 BPM · quick notes 0.31 s");
  same(markingBands(steps), [{ from: 0, to: 2, label: "Marked note by note" }, { from: 3, to: 4, label: "Shape + landing note" }]);
  assert.equal(nextSpeed(steps, 80, 92).percent, 90);
  assert.equal(nextSpeed(steps, 80, 79), null);
  assert.equal(nextSpeed(steps, 100, 100), null);
  // An exercise without speeds is its own one speed.
  const one = speedSteps(exercise({ id: "runs:x@60~80", notes: run, tempoBpm: 48, speedPercent: 80, bestScore: 81 }));
  same(one.map((s) => [s.percent, s.exerciseId, s.passed]), [[80, "runs:x@60~80", true]]);
});

test("a run marked note by note says which note to fix, and why the next speed is marked by shape", () => {
  const grade = { notes: [mark(0, "hit", 8), mark(1, "hit", -14), mark(2, "near", 41), mark(3, "hit", 5)] };
  const advice = runAdvice(grade, run, speeds[3]);
  assert.equal(advice.lead, "Soh ran a little sharp.");
  assert.equal(advice.rest, "Next is 90%: from there the notes are too quick to mark one by one, so we mark the run's shape and the doh it lands on.");
  same(runAdvice({ notes: [mark(0, "hit", 2)] }, run, speeds[1]), { lead: null, rest: "Next is 70%." });
  same(runAdvice({ notes: [mark(4, "missed", null)] }, run, null), { lead: "Ray wasn't heard.", rest: "Slow down, hear it again, then sing it once more." });
});

test("a full-speed run reads as the shape followed and the landing note", () => {
  same(runShapeLines({ followed: 5, runNotes: 5, landing: "hit", landingCents: 4 }, run[5]), [
    { ok: true, title: "Followed the run", sub: "All 5 notes, in order, on time" },
    { ok: true, title: "Landed on doh", sub: "In tune, held for the full 2 beats" },
  ]);
  const missed = runShapeLines({ followed: 3, runNotes: 5, landing: "near", landingCents: -52 }, run[5]);
  assert.equal(missed[0].title, "Followed 3 of 5 notes");
  assert.equal(missed[0].ok, false);
  assert.equal(missed[1].title, "Landed near doh");
  assert.equal(missed[1].sub, "52 cents flat: settle it in tune");
  assert.equal(runShapeLines({ followed: 5, runNotes: 5, landing: "missed", landingCents: null }, run[5])[1].title, "No doh heard at the end");
});

test("a unit's runs: learned at full speed, the one open, started, or new", () => {
  const ex = (code, title, s) =>
    exercise({ id: `runs:${code}@58~60`, code, title, group: "Runs down to doh", notes: run.slice(0, 3), speeds: speeds.map((sp, i) => ({ ...sp, bestScore: s[i] ?? null })) });
  const list = unitRuns(
    [ex("down", "Down the scale", [90, 88, 85, 82, 81]), ex("penta", "Pentatonic run", [92]), ex("gospel", "Gospel turn", [60]), ex("blue", "Blue-note slide", []), { ...ex("up", "Up the scale", []), group: "Up and over" }],
    { code: "penta", group: "Runs down to doh" },
  );
  same(list.map((r) => [r.title, r.state]), [["Down the scale", "learned"], ["Pentatonic run", "current"], ["Gospel turn", "started"], ["Blue-note slide", "new"]]);
  assert.equal(list[0].solfa, "d' l s");
  // The screen opens on the first run not yet learned.
  const units = [ex("down", "Down the scale", [90, 88, 85, 82, 81]), ex("penta", "Pentatonic run", [92])];
  assert.equal(firstOpenRun(units).code, "penta");
  assert.equal(firstOpenRun([units[0]]).code, "down");
  assert.equal(firstOpenRun([]), null);
});

test("a rhythm on its beat grid, in its syllables, and its claps marked in time, close or off", () => {
  const layout = clapLayout([{ startBeat: 0, durBeats: 1 }, { startBeat: 1, durBeats: 0.5 }, { startBeat: 1.5, durBeats: 0.5 }, { startBeat: 3, durBeats: 1 }, { startBeat: 4, durBeats: 2 }]);
  assert.equal(layout.beats, 8);
  same(layout.bars, [0.5]);
  same(layout.blocks[1], { index: 1, x: 1 / 8, w: 0.5 / 8 });
  same([1, 0.5, 2, 1.5].map(clapSyllable), ["ta", "ti", "ta-a", "ta-i"]);
  same(
    clapMarks({ claps: [{ index: 0, beat: 0, errorMs: 12.4, status: "hit" }, { index: 1, beat: 1, errorMs: -96, status: "near" }, { index: 2, beat: 2, errorMs: null, status: "missed" }] }),
    [
      { index: 0, tone: "hit", word: "In time", detail: "12 ms late" },
      { index: 1, tone: "near", word: "Close", detail: "96 ms early" },
      { index: 2, tone: "missed", word: "Off", detail: "not heard" },
    ],
  );
});

test("one line on how the rhythm went: the tempo kept first, then extra claps, then a lean", () => {
  const c = (errorMs) => ({ index: 0, beat: 0, errorMs, status: "hit" });
  assert.match(rhythmAdvice({ tempoRatio: 1.08, extra: 0, missed: 0, claps: [] }), /sped up/);
  assert.match(rhythmAdvice({ tempoRatio: 0.9, extra: 2, missed: 0, claps: [] }), /slowed down/);
  assert.equal(rhythmAdvice({ tempoRatio: 1, extra: 1, missed: 0, claps: [] }), "One extra clap crept in. Clap only on the pattern.");
  assert.match(rhythmAdvice({ tempoRatio: 1, extra: 0, missed: 0, claps: [c(60), c(50)] }), /late/);
  assert.match(rhythmAdvice({ tempoRatio: 1, extra: 0, missed: 0, claps: [c(-60), c(-50)] }), /early/);
  assert.equal(rhythmAdvice({ tempoRatio: 1, extra: 0, missed: 0, claps: [c(5), c(-10)] }), null);
  assert.match(rhythmAdvice({ tempoRatio: 1, extra: 0, missed: 1, claps: [c(5), c(null)] }), /louder/);
});
