/**
 * "More ways to practise" on the phone: the modes beside the practice path (boards c-practice/6a–6d), the words and the
 * arithmetic apart from the screens that draw them. Pure, so it is unit-tested (practiceModes.test.ts).
 *
 * Every mark here is the server's (`POST /api/practice/modes/grade`); this file only lays out what was asked and what
 * came back: the hub's rows, the warm-up's timeline, the range finder's keyboard, pitch match's timed set and its
 * needle words (the needle itself is the web's: phones have no live pitch stream until a store build), a run's blocks,
 * speeds and drawn line, and a rhythm's claps.
 *
 * Mirrors web-site/assets/practice-modes.js — keep the two in step (their tests match).
 */

import type {
  BreathPattern,
  ClapMark,
  GradeResult,
  GradeStatus,
  HeldNote,
  NoteEvent,
  PracticeExercise,
  PracticeLevel,
  PracticeModeId,
  PracticeStreak,
  PracticeTrack,
  RhythmClap,
  RhythmGrade,
  RunGrade,
  RunSpeed,
  TracePoint,
  VoiceRange,
  WarmUp,
  WarmUpGuide,
  WarmUpStep,
} from "../api/types";

// ── The hub's list ───────────────────────────────────────────────────────────

/** Every mode this build can open, in the hub's order (C# `PracticeModes.All`). */
export const MODE_IDS: readonly PracticeModeId[] = ["warm-up", "pitch-match", "runs", "intervals", "harmony", "rhythm"];

/** The warm-up's length (C# `WarmUpRoutine`: 45 + 60 + 45 + 30 s), said on its row before it is opened. */
export const WARM_UP_MINUTES = 3;

export interface ModeRow {
  id: PracticeModeId;
  title: string;
  subtitle: string;
  /** "3 min" on the warm-up's row; null elsewhere. */
  value: string | null;
}

/**
 * The hub's rows: the modes the server says are live for this track, in its order, each in the track's words. A mode
 * this build does not know is skipped (a newer server); null (an older server) lists none. `liveMeter` is true where
 * pitch match has its live needle (the web), so a phone never promises one.
 */
export function hubModes(
  modes: readonly string[] | null | undefined,
  track: PracticeTrack | null,
  liveMeter: boolean,
): ModeRow[] {
  const out: ModeRow[] = [];
  for (const id of modes ?? []) {
    if (!(MODE_IDS as readonly string[]).includes(id) || out.some((r) => r.id === id)) continue;
    const mode = id as PracticeModeId;
    out.push({ id: mode, ...modeWords(mode, track, liveMeter), value: mode === "warm-up" ? `${WARM_UP_MINUTES} min` : null });
  }
  return out;
}

function modeWords(id: PracticeModeId, track: PracticeTrack | null, liveMeter: boolean): { title: string; subtitle: string } {
  const playful = track === "playful";
  switch (id) {
    case "warm-up":
      return { title: "Warm up", subtitle: playful ? "Wake your voice up with Doh" : "Breath, sirens, your range" };
    case "pitch-match":
      return {
        title: "Pitch match",
        subtitle: playful
          ? liveMeter ? "Keep the needle in the green" : "Hear a note, then hold it steady"
          : liveMeter ? "Hold a note in tune on a live meter" : "Hear a note, hold it, see how close",
      };
    case "runs":
      return { title: "Riffs & runs", subtitle: "Slow it down, then up to speed" };
    case "intervals":
      return playful
        ? { title: "Jump to the note", subtitle: "From doh up to soh, and more" }
        : { title: "Intervals", subtitle: "Hear doh, then sing the note asked" };
    case "harmony":
      return { title: "Sing the harmony", subtitle: "A third above the tune, in headphones" };
    default:
      return playful ? { title: "Clap it back", subtitle: "Copy the rhythm" } : { title: "Rhythm", subtitle: "Clap back what you hear" };
  }
}

/** A mode's name on its own screen's eyebrow and in the hub, in the track's words. */
export function modeTitle(id: PracticeModeId, track: PracticeTrack | null): string {
  return modeWords(id, track, false).title;
}

/** The section's heading: Playful plays, Focused practises. */
export function modesHeading(track: PracticeTrack | null): string {
  return track === "playful" ? "More ways to play" : "More ways to practise";
}

/**
 * Focused's one small Doh beside the list, with one suggestion; Playful's Doh is the buddy at the top, so none here
 * (one Doh on screen at most). Null when there is nothing to suggest.
 */
export function modesDohLine(rows: readonly ModeRow[], track: PracticeTrack | null): string | null {
  if (track === "playful" || rows.length === 0) return null;
  if (rows.some((r) => r.id === "warm-up")) return "Warm up first? It makes the high notes easier.";
  if (rows.some((r) => r.id === "pitch-match")) return "Hold one note in tune first. It wakes the ear up.";
  return null;
}

// ── The one line at the top (streak and level) ──────────────────────────────

export interface ProgressStrip {
  /** "6-day streak", "Your best: 12 days" after a lapse, or "No streak yet". */
  streak: string;
  /** The level's name: "Me". */
  level: string;
  xp: string;
  /** "188 to Fah"; null at the top of the ladder. */
  toNext: string | null;
  /** 0–1 through the level. */
  fraction: number;
  /** One sentence for a screen reader. */
  label: string;
}

/** The streak and the level in one line, where the two stat cards used to open the screen (board 6a). */
export function progressStrip(p: {
  streak: Pick<PracticeStreak, "current"> & Partial<Pick<PracticeStreak, "best">>;
  level: PracticeLevel;
  xp: number;
}): ProgressStrip {
  const best = p.streak.best ?? 0;
  const lapsed = p.streak.current <= 0 && best > 0;
  const streak =
    p.streak.current > 0 ? `${p.streak.current}-day streak` : lapsed ? `Your best: ${best} ${best === 1 ? "day" : "days"}` : "No streak yet";
  const lv = p.level;
  const span = lv.nextLevelXp == null ? 0 : lv.nextLevelXp - lv.minXp;
  const fraction = lv.nextLevelXp == null ? 1 : span > 0 ? clamp01((p.xp - lv.minXp) / span) : 1;
  const toNext = lv.nextName ? `${grouped(lv.xpForNext)} to ${lv.nextName}` : null;
  const label = `${lapsed ? `No streak now. ${streak}` : streak}. Level ${lv.name}, ${grouped(p.xp)} XP${lv.nextName ? `, ${grouped(lv.xpForNext)} XP to ${lv.nextName}` : ""}.`;
  return { streak, level: lv.name, xp: `${grouped(p.xp)} XP`, toNext, fraction, label };
}

/** "12,450": XP in thousands, grouped by hand as `price.formatPrice` does (Hermes may ignore toLocaleString's options). */
function grouped(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ── Shared arithmetic ────────────────────────────────────────────────────────

/** Recording runs on this long after the last thing due, so a held ending is not cut (the server keeps more). */
export const MODE_TAIL_SEC = 1;
/** The grader's windows (C# `PracticeRules`, server `grade.py`): in tune within 35 cents, close within 80. */
export const IN_TUNE_CENTS = 35;
export const CLOSE_CENTS = 80;
/** A mark this good passes: it lights a speed and offers the next (the path's own "moves on"). */
export const PASS_SCORE = 80;
/** Harmony's tune under the singer's line, as Learn my part plays the other parts. */
export const TUNE_LEVEL = 0.25;

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Seconds per beat, floored at 30 BPM as every player here is. */
export function beatSeconds(tempoBpm: number): number {
  return 60 / Math.max(30, tempoBpm || 0);
}

/** From beat one to the end of the last thing sung, played or clapped, in seconds. */
export function passageSeconds(ex: Pick<PracticeExercise, "notes" | "backing" | "claps" | "tempoBpm">): number {
  let end = 0;
  for (const n of ex.notes) end = Math.max(end, n.startBeat + n.durBeats);
  for (const n of ex.backing) end = Math.max(end, n.startBeat + n.durBeats);
  for (const c of ex.claps) end = Math.max(end, c.startBeat + c.durBeats);
  return end * beatSeconds(ex.tempoBpm);
}

/** How long the phone records: the count-in, the passage and a second more, never past what the worker keeps. */
export function takeSeconds(ex: Pick<PracticeExercise, "notes" | "backing" | "claps" | "tempoBpm" | "maxTakeSeconds">, leadInSec: number): number {
  const natural = leadInSec + passageSeconds(ex) + MODE_TAIL_SEC;
  return ex.maxTakeSeconds > 0 ? Math.min(ex.maxTakeSeconds, natural) : natural;
}

/** The first note the singer sings: the count-in holds it (the pitch pipe); null for a rhythm. */
export function firstSungPitch(ex: Pick<PracticeExercise, "notes">): number | null {
  const first = [...ex.notes].sort((a, b) => a.startBeat - b.startBeat)[0];
  return first ? first.pitchMidi : null;
}

/** A count-in as `leadInPlan` (lib/practice) lays it out: clicks on `beats` beats, the first note held for `holdBeats`. */
export interface CountIn {
  beats: number;
  holdBeats: number;
  beatsPerBar: number;
  beatSec: number;
  seconds: number;
}

export interface TakeVoice {
  notes: NoteEvent[];
  gain: number;
}

export interface TakeSound {
  /** Clicks before beat one; the clip's beat one is this many beats in. */
  countInBeats: number;
  beatsPerBar: number;
  /** Everything played, in beats from beat one (the pitch pipe before it, at a negative beat). */
  voices: TakeVoice[];
}

/**
 * What a mode's take plays while it records: the count-in (clicks, with the first sung note held through its first
 * beats as a pitch pipe), then only what the mode plays under the singer: pitch match's tones before each held note,
 * and harmony's tune soft under the line when the singer has headphones on (without them the tune would reach the
 * microphone, and the grader follows one line). Never the notes being marked, and no clicks after beat one.
 */
export function takeSound(ex: Pick<PracticeExercise, "mode" | "notes" | "backing">, countIn: CountIn, headphones = false): TakeSound {
  const voices: TakeVoice[] = [];
  const pipe = firstSungPitch(ex);
  if (pipe != null && countIn.holdBeats > 0) {
    voices.push({ notes: [{ pitchMidi: pipe, startBeat: -countIn.beats, durBeats: countIn.holdBeats, degree: 1, solfa: "", octaveMark: "", conf: 1 }], gain: 0.9 });
  }
  if (ex.mode === "pitch-match" && ex.backing.length > 0) voices.push({ notes: [...ex.backing], gain: 0.9 });
  if (ex.mode === "harmony" && headphones && ex.backing.length > 0) voices.push({ notes: [...ex.backing], gain: TUNE_LEVEL });
  return { countInBeats: countIn.beats, beatsPerBar: countIn.beatsPerBar, voices };
}

/**
 * "Hear it": what the singer is about to sing. A harmony line with the tune soft under it; a pitch-match set's notes
 * one to a beat (the set itself takes most of a minute); anything else as written.
 */
export function hearVoices(ex: Pick<PracticeExercise, "mode" | "notes" | "backing">): TakeVoice[] {
  if (ex.mode === "pitch-match") return [{ notes: ex.notes.map((n, i) => ({ ...n, startBeat: i, durBeats: 1 })), gain: 1 }];
  const voices: TakeVoice[] = [{ notes: [...ex.notes], gain: 1 }];
  if (ex.mode === "harmony" && ex.backing.length > 0) voices.push({ notes: [...ex.backing], gain: TUNE_LEVEL });
  return voices;
}

/** The index of the note due `t` seconds after beat one, or −1 between notes (and before or after them). */
export function noteDue(notes: readonly NoteEvent[], tempoBpm: number, t: number): number {
  const beat = t / beatSeconds(tempoBpm);
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    if (beat >= n.startBeat && beat < n.startBeat + n.durBeats) return i;
  }
  return -1;
}

const NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** "A4" for 69; flats when the key is spelled with them ("Doh is Bb"). */
export function midiName(midi: number, flats = false): string {
  const m = Math.round(midi);
  return (flats ? NAMES_FLAT : NAMES_SHARP)[((m % 12) + 12) % 12]! + (Math.floor(m / 12) - 1);
}

/** True when the doh header spells its key with flats ("Doh is Bb", "Doh is F"). */
export function flatKey(dohHeader: string | null | undefined): boolean {
  const name = (dohHeader ?? "").replace(/^Doh is\s*/i, "").trim();
  return /b$/.test(name) || name === "F";
}

const SYLLABLES: Record<string, string> = { d: "doh", r: "ray", m: "me", f: "fah", s: "soh", l: "lah", t: "te" };

/** How a note is said: "soh", "high doh" (d'), "low te" (t,); a chromatic by its own name ("fe", "ta"). */
export function syllableName(solfa: string, octaveMark: string): string {
  const name = SYLLABLES[solfa] ?? solfa;
  if (octaveMark.includes("'")) return `high ${name}`;
  if (octaveMark.includes(",")) return `low ${name}`;
  return name;
}

/** "d'", "t,": a note as the sheet writes it. */
export function written(n: Pick<NoteEvent, "solfa" | "octaveMark">): string {
  return `${n.solfa}${n.octaveMark}`;
}

/** A mark's cents as the marks print them: "+6", "−48", "0". */
export function centsText(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  const c = Math.round(cents);
  return c > 0 ? `+${c}` : c < 0 ? `−${Math.abs(c)}` : "0";
}

/** How a mark is drawn: green in tune, amber close, grey off (never red), dashed not sung. */
export type MarkTone = "hit" | "near" | "off" | "missed";

export function markTone(status: GradeStatus): MarkTone {
  return status === "wrong" ? "off" : status;
}

export interface NoteMark {
  index: number;
  text: string;
  cents: string;
  tone: MarkTone;
}

/** A notes-graded take's marks, one per note sung, labelled as the screen draws them. */
export function noteMarks(grade: Pick<GradeResult, "notes"> | null | undefined, notes: readonly NoteEvent[]): NoteMark[] {
  const out: NoteMark[] = [];
  for (const g of grade?.notes ?? []) {
    const n = notes[g.index];
    if (!n) continue;
    out.push({ index: g.index, text: written(n), cents: g.status === "missed" ? "—" : centsText(g.cents), tone: markTone(g.status) });
  }
  return out;
}

// ── Warm up (board 6d) ───────────────────────────────────────────────────────

/** "3 min": a routine's length, in whole minutes (at least one). */
export function minutesLabel(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

/** "0:45", "1:00". */
export function clockLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface WarmUpStepView extends WarmUpStep {
  /** 1-based, as the step list numbers them. */
  number: number;
  /** "0:45". */
  clock: string;
  /** Seconds into the routine where it starts. */
  startsAt: number;
}

/** The routine's steps in order, each numbered and timed. */
export function warmUpSteps(w: Pick<WarmUp, "steps">): WarmUpStepView[] {
  let at = 0;
  return w.steps.map((s, i) => {
    const view = { ...s, number: i + 1, clock: clockLabel(s.seconds), startsAt: at };
    at += s.seconds;
    return view;
  });
}

export type BreathPhaseName = "in" | "hold" | "out";

export interface BreathPhase {
  phase: BreathPhaseName;
  counts: number;
  seconds: number;
  cycle: number;
  startsAt: number;
}

/** A breathing pattern laid out in time: in, hold (when it has one), out, `cycles` times. */
export function breathPhases(b: BreathPattern): BreathPhase[] {
  const count = 60 / Math.max(1, b.countsPerMinute || 60);
  const out: BreathPhase[] = [];
  let at = 0;
  for (let cycle = 1; cycle <= Math.max(1, b.cycles); cycle++) {
    for (const [phase, counts] of [["in", b.inCounts], ["hold", b.holdCounts], ["out", b.outCounts]] as const) {
      if (!(counts > 0)) continue;
      out.push({ phase, counts, seconds: counts * count, cycle, startsAt: at });
      at += counts * count;
    }
  }
  return out;
}

export function breathSeconds(b: BreathPattern): number {
  return breathPhases(b).reduce((s, p) => s + p.seconds, 0);
}

export interface BreathNow {
  phase: BreathPhaseName | null;
  /** The count within the phase, 1 up to its length. */
  count: number;
  cycle: number;
  /** "Breathe in", "Hold", "Out on “sss”"; "Done" after the last. */
  word: string;
  done: boolean;
}

/** Where a breathing guide is `t` seconds in: the phase, its count and the word to show. */
export function breathAt(b: BreathPattern, t: number): BreathNow {
  const count = 60 / Math.max(1, b.countsPerMinute || 60);
  for (const p of breathPhases(b)) {
    if (t >= p.startsAt && t < p.startsAt + p.seconds) {
      return {
        phase: p.phase,
        count: Math.min(p.counts, Math.floor((t - p.startsAt) / count) + 1),
        cycle: p.cycle,
        word: p.phase === "in" ? "Breathe in" : p.phase === "hold" ? "Hold" : "Out on “sss”",
        done: false,
      };
    }
  }
  return { phase: null, count: 0, cycle: Math.max(1, b.cycles), word: t < 0 ? "Ready" : "Done", done: t >= 0 };
}

/** The beat of rest between a guide's rounds. */
export const GUIDE_GAP_BEATS = 1;

/**
 * A guide as the synth plays it: the pattern, then `stepSemitones` higher each round, `rounds` times, a beat of rest
 * between. The solfa stays (doh moves up with each round, which is the point).
 */
export function guideNotes(g: Pick<WarmUpGuide, "notes" | "rounds" | "stepSemitones">): NoteEvent[] {
  const length = g.notes.reduce((m, n) => Math.max(m, n.startBeat + n.durBeats), 0);
  const out: NoteEvent[] = [];
  for (let r = 0; r < Math.max(1, g.rounds); r++) {
    const shift = r * g.stepSemitones;
    const at = r * (length + GUIDE_GAP_BEATS);
    for (const n of g.notes) out.push({ ...n, pitchMidi: n.pitchMidi + shift, startBeat: n.startBeat + at });
  }
  return out;
}

export function guideSeconds(g: Pick<WarmUpGuide, "notes" | "rounds" | "stepSemitones" | "tempoBpm">): number {
  const notes = guideNotes(g);
  const end = notes.reduce((m, n) => Math.max(m, n.startBeat + n.durBeats), 0);
  return end * beatSeconds(g.tempoBpm);
}

/** The round being played `t` seconds in (1-based), for "Round 2 of 5". */
export function guideRoundAt(g: Pick<WarmUpGuide, "notes" | "rounds" | "tempoBpm">, t: number): number {
  const length = g.notes.reduce((m, n) => Math.max(m, n.startBeat + n.durBeats), 0);
  const round = Math.floor(t / ((length + GUIDE_GAP_BEATS) * beatSeconds(g.tempoBpm))) + 1;
  return Math.min(Math.max(1, g.rounds), Math.max(1, round));
}

export interface GlidePoint {
  /** Seconds from the start. */
  t: number;
  midi: number;
}

/**
 * A siren's line: a point at each note's start and one at the end of each round's last note, so the voice slides
 * from note to note in one smooth line (pitch moves evenly in semitones); rounds are apart, a beat of silence between.
 * Returned per round so a player can stop the sound in the gaps.
 */
export function glideRounds(g: Pick<WarmUpGuide, "notes" | "rounds" | "stepSemitones" | "tempoBpm">): GlidePoint[][] {
  const beat = beatSeconds(g.tempoBpm);
  const length = g.notes.reduce((m, n) => Math.max(m, n.startBeat + n.durBeats), 0);
  const sorted = [...g.notes].sort((a, b) => a.startBeat - b.startBeat);
  const rounds: GlidePoint[][] = [];
  for (let r = 0; r < Math.max(1, g.rounds); r++) {
    const shift = r * g.stepSemitones;
    const at = r * (length + GUIDE_GAP_BEATS);
    const points = sorted.map((n) => ({ t: (n.startBeat + at) * beat, midi: n.pitchMidi + shift }));
    const last = sorted[sorted.length - 1];
    if (last) points.push({ t: (last.startBeat + last.durBeats + at) * beat, midi: last.pitchMidi + shift });
    rounds.push(points);
  }
  return rounds;
}

/** The pitch a glide sings `t` seconds in (straight lines in semitones between its points); null outside it. */
export function glideMidiAt(points: readonly GlidePoint[], t: number): number | null {
  if (points.length === 0 || t < points[0]!.t || t > points[points.length - 1]!.t) return null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (t <= b.t) return b.t > a.t ? a.midi + ((b.midi - a.midi) * (t - a.t)) / (b.t - a.t) : b.midi;
  }
  return points[points.length - 1]!.midi;
}

export interface ShapePoint {
  /** 0–1 across. */
  x: number;
  /** 0–1 down (0 is the highest note). */
  y: number;
  solfa: string;
}

/** The guide's one round as the routine draws it (board 6d's little chart): each note's middle, high at the top. */
export function guideShape(g: Pick<WarmUpGuide, "notes">): ShapePoint[] {
  const notes = [...g.notes].sort((a, b) => a.startBeat - b.startBeat);
  if (notes.length === 0) return [];
  const length = notes.reduce((m, n) => Math.max(m, n.startBeat + n.durBeats), 0) || 1;
  const lo = Math.min(...notes.map((n) => n.pitchMidi));
  const hi = Math.max(...notes.map((n) => n.pitchMidi));
  return notes.map((n) => ({
    x: (n.startBeat + n.durBeats / 2) / length,
    y: hi > lo ? (hi - n.pitchMidi) / (hi - lo) : 0.5,
    solfa: written(n),
  }));
}

// ── The range finder (board 6d) ──────────────────────────────────────────────

/** How long each end of the range finder records: the worker wants a hold of a second or more in it. */
export const RANGE_TAKE_SECONDS = 6;

export function rangeTitle(end: "low" | "high"): string {
  return end === "low" ? "Your lowest note" : "Your highest note";
}

export function rangeInstruction(end: "low" | "high"): string {
  return end === "low"
    ? "Sing “ah” and slide down until it starts to feel heavy. Hold the last note that still feels easy."
    : "Sing “ah” and slide up until it starts to feel tight. Hold the last note that still feels easy.";
}

/** Doh's one tip while the range finder listens. */
export function rangeTip(end: "low" | "high"): string {
  return end === "low"
    ? "Comfortable, not your very lowest. If it rumbles, come back up a note."
    : "Comfortable, not your very highest. If it squeezes, come back down a note.";
}

/** "A3, held 2.4 s": what the take just held. */
export function heardLine(heard: Pick<HeldNote, "name" | "seconds">): string {
  return `${heard.name}, held ${heard.seconds.toFixed(1)} s`;
}

/** "G3 to D5" once both ends are measured. */
export function rangeHeadline(r: Pick<VoiceRange, "low" | "high">): string | null {
  return r.low && r.high ? `${r.low} to ${r.high}` : null;
}

/** "With doh on C: s, up to r'". */
export function rangeSolfaLine(r: Pick<VoiceRange, "dohHeader" | "lowSolfa" | "highSolfa">): string | null {
  if (!r.lowSolfa || !r.highSolfa) return null;
  const doh = r.dohHeader.replace(/^Doh is\s*/i, "") || "C";
  return `With doh on ${doh}: ${r.lowSolfa} up to ${r.highSolfa}`;
}

/** "Sits well for Alto": a guide for choir parts, not a label. */
export function voicePartLine(part: VoiceRange["voicePart"]): string | null {
  return part ? `Sits well for ${part[0]!.toUpperCase()}${part.slice(1)}` : null;
}

export interface RangeKey {
  midi: number;
  black: boolean;
  lit: boolean;
  /** "C4" on each C, for the keyboard's labels. */
  label: string | null;
}

/** The keyboard under the range: whole octaves from the C at or below the low note to the B above the high one. */
export function rangeKeys(lowMidi: number, highMidi: number): RangeKey[] {
  const lo = Math.min(lowMidi, highMidi), hi = Math.max(lowMidi, highMidi);
  const from = Math.floor(lo / 12) * 12;
  const to = Math.max(from + 23, Math.floor(hi / 12) * 12 + 11);
  const keys: RangeKey[] = [];
  for (let m = from; m <= to; m++) {
    const pc = m % 12;
    keys.push({ midi: m, black: [1, 3, 6, 8, 10].includes(pc), lit: m >= lo && m <= hi, label: pc === 0 ? midiName(m) : null });
  }
  return keys;
}

// ── Pitch match (board 6b) ───────────────────────────────────────────────────

export interface PitchSlot {
  index: number;
  note: NoteEvent;
  /** Seconds from beat one. */
  toneStart: number;
  toneEnd: number;
  holdStart: number;
  holdEnd: number;
}

/** Each note of a set: its tone (played) and then its hold (sung, marked), in seconds from beat one. */
export function pitchSlots(ex: Pick<PracticeExercise, "notes" | "backing" | "tempoBpm">): PitchSlot[] {
  const beat = beatSeconds(ex.tempoBpm);
  return ex.notes.map((n, i) => {
    const tone = ex.backing[i];
    const toneStart = tone ? tone.startBeat * beat : n.startBeat * beat;
    const toneEnd = tone ? (tone.startBeat + tone.durBeats) * beat : toneStart;
    return { index: i, note: n, toneStart, toneEnd, holdStart: n.startBeat * beat, holdEnd: (n.startBeat + n.durBeats) * beat };
  });
}

export interface PitchMoment {
  /** The note in hand: the next one while waiting for its tone. */
  index: number;
  phase: "before" | "tone" | "hold" | "done";
  /** Seconds held so far of this note's hold, and its whole length. */
  held: number;
  holdSeconds: number;
}

/** Where a set is `t` seconds after beat one: hearing a note's tone, holding it, or done. */
export function pitchMomentAt(slots: readonly PitchSlot[], t: number): PitchMoment {
  for (const s of slots) {
    const hold = s.holdEnd - s.holdStart;
    if (t < s.toneStart) return { index: s.index, phase: "before", held: 0, holdSeconds: hold };
    if (t < s.toneEnd) return { index: s.index, phase: "tone", held: 0, holdSeconds: hold };
    if (t < s.holdEnd) return { index: s.index, phase: "hold", held: Math.max(0, t - s.holdStart), holdSeconds: hold };
  }
  const last = slots[slots.length - 1];
  return { index: last ? last.index : -1, phase: "done", held: 0, holdSeconds: last ? last.holdEnd - last.holdStart : 0 };
}

/** "soh · A4 · note 3 of 8". */
export function noteCaption(n: NoteEvent, index: number, count: number, flats: boolean): string {
  return `${syllableName(n.solfa, n.octaveMark)} · ${midiName(n.pitchMidi, flats)} · note ${index + 1} of ${count}`;
}

/** A MIDI pitch, fractional, for a frequency (A4 = 440 Hz = 69). */
export function midiOf(freqHz: number): number {
  return 69 + 12 * Math.log2(freqHz / 440);
}

/**
 * How far a sung frequency is from the target, in cents, with whole octaves taken out (a man on a woman's note is
 * not wrong, as the grader has it): −600 to 600.
 */
export function centsOff(freqHz: number, targetMidi: number): number {
  const diff = (midiOf(freqHz) - targetMidi) * 100;
  return diff - 1200 * Math.round(diff / 1200);
}

export type NeedleZone = "in" | "close" | "off" | "none";

/** The needle's colour: the grader's own windows, so the needle and the final mark agree. */
export function needleZone(cents: number | null | undefined): NeedleZone {
  if (cents == null || !Number.isFinite(cents)) return "none";
  const a = Math.abs(cents);
  return a <= IN_TUNE_CENTS ? "in" : a <= CLOSE_CENTS ? "close" : "off";
}

/** The needle's lean in degrees: ±100 cents fills the dial's ±60°. */
export function needleAngle(cents: number | null | undefined): number {
  if (cents == null || !Number.isFinite(cents)) return 0;
  return (Math.max(-100, Math.min(100, cents)) / 100) * 60;
}

/** What the needle says, a word and what to do; flat or sharp is a direction, never an alarm. */
export function needleWords(cents: number | null | undefined, syllable: string): { title: string; hint: string } {
  const zone = needleZone(cents);
  if (zone === "none") return { title: "Listening…", hint: `Sing “ah” on ${syllable} and hold it.` };
  if (zone === "in") return { title: "In tune", hint: `Sing “ah” on ${syllable} and keep the needle in the green.` };
  if (zone === "off") return { title: `Not quite: find ${syllable} again`, hint: "Hear it once more, then slide until the needle settles." };
  return (cents as number) < 0
    ? { title: "A little flat", hint: "Think of the note a little higher, and keep the breath going." }
    : { title: "A little sharp", hint: "Ease down a touch, and keep the breath going." };
}

/** Joins names as a sentence does: "doh", "doh and te", "doh, me and te". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function capital(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/**
 * The one suggestion under a marked set, drawn from the marks themselves (board 6b): which notes came in flat or sharp,
 * or were not heard, and what to try. Null when every note was spot on.
 */
export function pitchAdvice(grade: Pick<GradeResult, "notes">, notes: readonly NoteEvent[]): { title: string; body: string; practise: string[] } | null {
  const flat: string[] = [], sharp: string[] = [], missed: string[] = [], practise: string[] = [];
  for (const g of grade.notes) {
    const n = notes[g.index];
    if (!n || g.status === "hit") continue;
    const name = syllableName(n.solfa, n.octaveMark);
    if (!practise.includes(written(n))) practise.push(written(n));
    if (g.status === "missed" || g.cents == null) missed.push(name);
    else if (g.cents < 0) flat.push(name);
    else sharp.push(name);
  }
  if (practise.length === 0) return null;
  const parts: string[] = [];
  if (flat.length) parts.push(`${joinNames(flat)} came in flat`);
  if (sharp.length) parts.push(`${joinNames(sharp)} came in sharp`);
  if (missed.length) parts.push(`${joinNames(missed)} ${missed.length === 1 ? "wasn't" : "weren't"} heard`);
  const title = capital(parts.join("; "));
  const body = missed.length && !flat.length && !sharp.length
    ? "Sing out and hold each note for its four beats."
    : practise.length === 1
      ? "Hold just that one, slowly, with the tone."
      : `Hold just those ${practise.length === 2 ? "two" : practise.length}, slowly, with the tones.`;
  return { title, body, practise };
}

// ── Intervals ────────────────────────────────────────────────────────────────

/** An interval's two notes as the screen says them: from doh, up or down, to the note asked. */
export function intervalParts(ex: Pick<PracticeExercise, "notes" | "group">): { from: string; to: string; up: boolean; size: string | null } | null {
  const [a, b] = ex.notes;
  if (!a || !b) return null;
  return { from: syllableName(a.solfa, a.octaveMark), to: syllableName(b.solfa, b.octaveMark), up: b.pitchMidi > a.pitchMidi, size: ex.group };
}

// ── Riffs & runs (board 6c) ──────────────────────────────────────────────────

export interface RollRow {
  label: string;
  midi: number;
}

export interface RollBlock {
  index: number;
  /** The row it sits on (0 is the highest). */
  row: number;
  /** Across, 0–1 of the run's length. */
  x: number;
  w: number;
  label: string;
}

export interface Roll {
  rows: RollRow[];
  blocks: RollBlock[];
  beats: number;
}

/** A run as blocks you can read at a glance (pitch up, length across), one row per note it uses, highest first. */
export function runRoll(notes: readonly NoteEvent[]): Roll {
  const beats = notes.reduce((m, n) => Math.max(m, n.startBeat + n.durBeats), 0) || 1;
  const rows: RollRow[] = [];
  for (const n of [...notes].sort((a, b) => b.pitchMidi - a.pitchMidi)) {
    if (!rows.some((r) => r.midi === n.pitchMidi)) rows.push({ label: written(n), midi: n.pitchMidi });
  }
  const blocks = notes.map((n, i) => ({
    index: i,
    row: rows.findIndex((r) => r.midi === n.pitchMidi),
    x: n.startBeat / beats,
    w: n.durBeats / beats,
    label: written(n),
  }));
  return { rows, blocks, beats };
}

/** Where a pitch sits on the roll's rows (fractional; between two rows in proportion to the semitones). */
export function rollRowOf(midi: number, rows: readonly RollRow[]): number {
  if (rows.length === 0) return 0;
  if (midi >= rows[0]!.midi) return 0;
  for (let i = 1; i < rows.length; i++) {
    const hi = rows[i - 1]!, lo = rows[i]!;
    if (midi >= lo.midi) return i - 1 + (hi.midi - midi) / Math.max(1e-9, hi.midi - lo.midi);
  }
  return rows.length - 1;
}

/** The take's pitch line over the roll: across by beat (from the trace's seconds), down by row. Points outside it drop. */
export function traceOnRoll(trace: readonly TracePoint[], roll: Roll, tempoBpm: number): { x: number; y: number }[] {
  const beat = beatSeconds(tempoBpm);
  const out: { x: number; y: number }[] = [];
  for (const p of trace) {
    const x = p.t / beat / roll.beats;
    if (!(x >= 0 && x <= 1) || !Number.isFinite(p.midi)) continue;
    out.push({ x, y: rollRowOf(p.midi, roll.rows) });
  }
  return out;
}

export interface SpeedStep extends RunSpeed {
  label: string;
  /** Marked 80 or more at this speed. */
  passed: boolean;
}

/** A run's speeds, slowest first; an exercise without them is its own one speed. */
export function speedSteps(ex: Pick<PracticeExercise, "id" | "speeds" | "speedPercent" | "tempoBpm" | "grader" | "bestScore" | "notes">): SpeedStep[] {
  const speeds: RunSpeed[] = ex.speeds && ex.speeds.length > 0
    ? [...ex.speeds].sort((a, b) => a.percent - b.percent)
    : [{
        percent: ex.speedPercent ?? 100,
        exerciseId: ex.id,
        tempoBpm: ex.tempoBpm,
        shortestNoteSeconds: ex.notes.reduce((m, n) => Math.min(m, n.durBeats), Infinity) * beatSeconds(ex.tempoBpm),
        grader: ex.grader,
        bestScore: ex.bestScore,
      }];
  return speeds.map((s) => ({ ...s, label: `${s.percent}%`, passed: (s.bestScore ?? 0) >= PASS_SCORE }));
}

/** "36 BPM · quick notes 0.42 s". */
export function speedCaption(s: Pick<RunSpeed, "tempoBpm" | "shortestNoteSeconds">): string {
  return `${s.tempoBpm} BPM · quick notes ${s.shortestNoteSeconds.toFixed(2)} s`;
}

/** The brackets under the stepper: which speeds are marked note by note and which by the run's shape. */
export function markingBands(steps: readonly Pick<RunSpeed, "grader">[]): { from: number; to: number; label: string }[] {
  const bands: { from: number; to: number; label: string; grader: string }[] = [];
  steps.forEach((s, i) => {
    const last = bands[bands.length - 1];
    if (last && last.grader === s.grader) last.to = i;
    else bands.push({ from: i, to: i, grader: s.grader, label: s.grader === "run" ? "Shape + landing note" : "Marked note by note" });
  });
  return bands.map(({ from, to, label }) => ({ from, to, label }));
}

/** The speed to offer after a mark: the next one up when it passed, else none (sing this one again). */
export function nextSpeed<T extends Pick<RunSpeed, "percent">>(steps: readonly T[], percent: number, score: number): T | null {
  if (score < PASS_SCORE) return null;
  return [...steps].sort((a, b) => a.percent - b.percent).find((s) => s.percent > percent) ?? null;
}

/**
 * The plain line under a run marked note by note (board 6c): which note to fix, and, when the next speed is marked by
 * shape, why.
 */
export function runAdvice(
  grade: Pick<GradeResult, "notes">,
  notes: readonly NoteEvent[],
  next: Pick<RunSpeed, "percent" | "grader"> | null,
): { lead: string | null; rest: string | null } {
  let worst: { name: string; cents: number | null; status: GradeStatus } | null = null;
  for (const g of grade.notes) {
    const n = notes[g.index];
    if (!n || g.status === "hit") continue;
    const weight = g.status === "missed" ? 1000 : Math.abs(g.cents ?? 0);
    const current = worst ? (worst.status === "missed" ? 1000 : Math.abs(worst.cents ?? 0)) : -1;
    if (weight > current) worst = { name: syllableName(n.solfa, n.octaveMark), cents: g.cents, status: g.status };
  }
  const lead = !worst
    ? null
    : worst.status === "missed"
      ? `${capital(worst.name)} wasn't heard.`
      : `${capital(worst.name)} ran a little ${(worst.cents ?? 0) < 0 ? "flat" : "sharp"}.`;
  const rest = next
    ? next.grader === "run"
      ? `Next is ${next.percent}%: from there the notes are too quick to mark one by one, so we mark the run's shape and the doh it lands on.`
      : `Next is ${next.percent}%.`
    : lead
      ? "Slow down, hear it again, then sing it once more."
      : null;
  return { lead, rest };
}

/** A full-speed run's two lines (board 6c): followed in order, and the landing note. */
export function runShapeLines(run: Pick<RunGrade, "followed" | "runNotes" | "landing" | "landingCents">, landing: NoteEvent | null): { ok: boolean; title: string; sub: string }[] {
  const all = run.followed >= run.runNotes;
  const name = landing ? syllableName(landing.solfa, landing.octaveMark) : "the last note";
  const beats = landing ? landing.durBeats : 0;
  const held = beats > 0 ? `${beats === 1 ? "the full beat" : `the full ${trimNumber(beats)} beats`}` : "its length";
  const followed = {
    ok: all,
    title: all ? "Followed the run" : `Followed ${run.followed} of ${run.runNotes} notes`,
    sub: all ? `All ${run.runNotes} notes, in order, on time` : "Slow it down a step and find the notes you skipped",
  };
  const c = run.landingCents == null ? null : Math.round(run.landingCents);
  const land =
    run.landing === "hit"
      ? { ok: true, title: `Landed on ${name}`, sub: `In tune, held for ${held}` }
      : run.landing === "near"
        ? { ok: false, title: `Landed near ${name}`, sub: c == null ? "Close: settle it in tune" : `${Math.abs(c)} cents ${c < 0 ? "flat" : "sharp"}: settle it in tune` }
        : run.landing === "wrong"
          ? { ok: false, title: `Missed ${name} at the end`, sub: "Hear the last note again, then land on it" }
          : { ok: false, title: `No ${name} heard at the end`, sub: `Hold the last note for ${held}` };
  return [followed, land];
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/** The run to open on: the first not yet learned (marked 80 or more at full speed), else the first. */
export function firstOpenRun<T extends Pick<PracticeExercise, "speeds">>(exercises: readonly T[]): T | null {
  const learned = (e: T) => ((e.speeds ?? []).find((s) => s.percent === 100)?.bestScore ?? 0) >= PASS_SCORE;
  return exercises.find((e) => !learned(e)) ?? exercises[0] ?? null;
}

export type RunState = "learned" | "current" | "started" | "new";

/**
 * A unit's runs as the list under the stepper shows them: learned (marked 80 or more at full speed), the one open,
 * started (marked at some speed), or new.
 */
export function unitRuns(
  exercises: readonly Pick<PracticeExercise, "id" | "code" | "title" | "group" | "notes" | "speeds" | "bestScore">[],
  current: Pick<PracticeExercise, "code" | "group">,
): { id: string; code: string; title: string; solfa: string; state: RunState }[] {
  return exercises
    .filter((e) => e.group === current.group)
    .map((e) => {
      const speeds = e.speeds ?? [];
      const full = speeds.find((s) => s.percent === 100);
      const state: RunState = e.code === current.code
        ? "current"
        : (full?.bestScore ?? 0) >= PASS_SCORE
          ? "learned"
          : speeds.some((s) => s.bestScore != null) || e.bestScore != null
            ? "started"
            : "new";
      return { id: e.id, code: e.code, title: e.title, solfa: e.notes.map(written).join(" "), state };
    });
}

// ── Rhythm ───────────────────────────────────────────────────────────────────

export interface ClapLayout {
  blocks: { index: number; x: number; w: number }[];
  /** Across, 0–1, where each bar line falls (inside the pattern only). */
  bars: number[];
  beats: number;
}

/** A rhythm drawn on a beat grid: each clap a block as long as it lasts, the pattern rounded up to whole bars. */
export function clapLayout(claps: readonly RhythmClap[], beatsPerBar = 4): ClapLayout {
  const end = claps.reduce((m, c) => Math.max(m, c.startBeat + c.durBeats), 0);
  const per = Math.max(1, beatsPerBar);
  const beats = Math.max(per, Math.ceil(end / per - 1e-9) * per);
  const bars: number[] = [];
  for (let b = per; b < beats; b += per) bars.push(b / beats);
  return { blocks: claps.map((c, i) => ({ index: i, x: c.startBeat / beats, w: c.durBeats / beats })), bars, beats };
}

/** How a clap is said in a rhythm's syllables (Kodály): ta for a beat, ti for half, ta-a for two. */
export function clapSyllable(durBeats: number): string {
  if (durBeats >= 3.5) return "ta-a-a-a";
  if (durBeats >= 2.5) return "ta-a-a";
  if (durBeats >= 1.75) return "ta-a";
  if (durBeats >= 1.25) return "ta-i";
  if (durBeats >= 0.75) return "ta";
  return "ti";
}

export interface ClapMarkView {
  index: number;
  tone: "hit" | "near" | "missed";
  word: string;
  detail: string;
}

/** Each clap's mark as the screen shows it: in time, close (how early or late) or off (not heard), never red. */
export function clapMarks(rhythm: Pick<RhythmGrade, "claps">): ClapMarkView[] {
  return rhythm.claps.map((c: ClapMark) => {
    const ms = c.errorMs == null ? null : Math.round(c.errorMs);
    const when = ms == null ? "" : ms === 0 ? "on the beat" : `${Math.abs(ms)} ms ${ms < 0 ? "early" : "late"}`;
    return {
      index: c.index,
      tone: c.status,
      word: c.status === "hit" ? "In time" : c.status === "near" ? "Close" : "Off",
      detail: c.status === "missed" ? "not heard" : when,
    };
  });
}

/** One line on how a rhythm went beyond the marks: the tempo kept, extra claps, a lean early or late. */
export function rhythmAdvice(rhythm: Pick<RhythmGrade, "tempoRatio" | "extra" | "claps" | "missed">): string | null {
  if (rhythm.tempoRatio > 1.05) return "You sped up a little. Count the beats in your head as you clap.";
  if (rhythm.tempoRatio < 0.95) return "You slowed down a little. Keep the beat moving as you clap.";
  if (rhythm.extra > 0) return `${rhythm.extra === 1 ? "One extra clap" : `${rhythm.extra} extra claps`} crept in. Clap only on the pattern.`;
  const errors = rhythm.claps.map((c) => c.errorMs).filter((e): e is number => e != null);
  if (errors.length >= 2) {
    const mean = errors.reduce((s, e) => s + e, 0) / errors.length;
    if (mean > 40) return "Most claps came a touch late. Lean into each one.";
    if (mean < -40) return "Most claps came a touch early. Wait for each one.";
  }
  if (rhythm.missed > 0) return "Clap a little louder so every clap is heard.";
  return null;
}
