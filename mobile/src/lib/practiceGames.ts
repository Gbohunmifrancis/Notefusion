/**
 * The quick games beside the sung practice (board s-practice-fun/s3), the pure part: their names on each track, where
 * a note and a key signature sit on the treble stave, the line a round's verdict says, and the end of a game. The
 * server deals every round and marks the answers that count (`GET /api/practice/games/{game}`, `POST …/games/grade`);
 * the phone only says at once whether a tap was right, from the round's own answer.
 */

import type { NoteEvent, PracticeGameGrade, PracticeGameId, PracticeGameRound, PracticeTrack } from "../api/types";
import type { IconName } from "../components/Icon";

export const GAME_IDS: readonly PracticeGameId[] = ["which-note", "staff", "hymn", "which-scale"];

/** A game as the Practice home's tile shows it. */
export interface GameTile {
  id: PracticeGameId;
  title: string;
  line: string;
  icon: IconName;
}

/** The games in the home's order, named for the track (Playful's race is "Note race"). */
export function gameTiles(track: PracticeTrack | null): GameTile[] {
  const playful = track === "playful";
  return GAME_IDS.map((id) => ({ id, title: gameTitle(id, track), line: GAME_LINES[id](playful), icon: GAME_ICON[id] }));
}

export function gameTitle(id: PracticeGameId, track: PracticeTrack | null): string {
  if (id === "staff") return track === "playful" ? "Note race" : "Staff to solfa";
  if (id === "which-scale") return "Which scale?";
  return id === "hymn" ? "Name that hymn" : "Which note?";
}

const GAME_LINES: Record<PracticeGameId, (playful: boolean) => string> = {
  "which-note": (playful) => (playful ? "Hear it, find it" : "Hear doh, then the note"),
  staff: (playful) => (playful ? "Quick! Name the note" : "Read the stave as solfa"),
  hymn: () => "Hear the opening, pick it",
  "which-scale": (playful) => (playful ? "Happy, sad or far away?" : "Hear a scale, name it"),
};

const GAME_ICON: Record<PracticeGameId, IconName> = { "which-note": "intervals", staff: "staff", hymn: "hymns", "which-scale": "scales" };

/** What the game's opening card says before the first round. */
export function gameIntro(id: PracticeGameId, track: PracticeTrack | null): string {
  if (id === "which-note") {
    return track === "playful"
      ? "Doh plays first, then another note. Tap where it sits on the ladder."
      : "You hear doh, then a note. Tap the note on the ladder. Doh's key changes every round.";
  }
  if (id === "staff") {
    return track === "playful"
      ? "A note lands on the stave. Tap its name, as many as you can in a minute."
      : "A note appears on the stave. Tap its solfa, as many as you can in 60 seconds. The key changes every ten notes.";
  }
  if (id === "which-scale") {
    return track === "playful"
      ? "A scale plays up and back down. Is it the happy major, the sad minor, or one from far away? Pick its name."
      : "A scale plays up and back down. Pick its name: major and minor first, then the pentatonics, the modes and the world's.";
  }
  return "A hymn's opening plays on the piano. Pick its name from three.";
}

// ── Which note? ─────────────────────────────────────────────────────────────

const SYLLABLE_NAMES: Record<string, string> = { d: "doh", r: "ray", m: "me", f: "fah", s: "soh", l: "lah", t: "te", "d'": "doh" };

/** "soh" for "s"; the top doh is "doh" too; a note an octave off says so ("high ray", "low lah"); chromatics as they are. */
export function syllableName(syllable: string): string {
  if (SYLLABLE_NAMES[syllable]) return SYLLABLE_NAMES[syllable];
  const base = (syllable ?? "").replace(/[',]+$/, "");
  const name = SYLLABLE_NAMES[base] ?? base;
  return /'$/.test(syllable) ? `high ${name}` : /,$/.test(syllable) ? `low ${name}` : name;
}

const STEP_LINES: Record<string, string> = {
  r: "The second note of the scale.",
  m: "The third note of the scale.",
  f: "The fourth note of the scale.",
  s: "The fifth note of the scale.",
  l: "The sixth note of the scale.",
  t: "The seventh, just under doh.",
  "d'": "Doh again, an octave up.",
  "r'": "Ray, an octave up.",
  "m'": "Me, an octave up.",
  "t,": "Te below doh, leaning up to it.",
  "l,": "Lah below doh.",
  "s,": "Soh below doh.",
  de: "Doh raised a semitone.",
  ma: "Me lowered a semitone.",
  fe: "Fah raised a semitone, leaning to soh.",
  se: "Soh raised a semitone, leaning to lah.",
  ta: "Te lowered a semitone, leaning to lah.",
};

/** What a round says once it is answered: its title and one line under it. */
export function verdict(game: PracticeGameId, round: PracticeGameRound, tapped: string): { right: boolean; title: string; line: string } {
  const right = tapped === round.answer;
  if (game === "which-scale") {
    const named = (code: string) => round.scales?.find((s) => s.code === code)?.title ?? "That scale";
    return right
      ? { right, title: "That's it!", line: named(round.answer) }
      : { right, title: "Not this time", line: `It was ${named(round.answer).replace(/^The /, "the ")}.` };
  }
  if (game === "hymn") {
    const title = round.hymns?.find((h) => h.slug === round.answer)?.title ?? "That hymn";
    return right
      ? { right, title: "That's it!", line: title }
      : { right, title: "Not this time", line: `It was ${title}.` };
  }
  const name = syllableName(round.answer);
  if (right) return { right, title: `${capitalise(name)}!`, line: game === "staff" ? `${round.noteName} in ${round.doh} major.` : STEP_LINES[round.answer] ?? "" };
  return {
    right,
    title: `It was ${name}`,
    line: game === "staff" ? `${round.noteName} is ${name} when doh is ${round.doh}.` : `You tapped ${syllableName(tapped)}. Listen to both again.`,
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Right answers in a row, read off the marks so far: the flame's number. */
export function comboOf(marks: readonly boolean[]): number {
  let run = 0;
  for (let i = marks.length - 1; i >= 0 && marks[i]; i--) run++;
  return run;
}

/** Which note? plays doh, then the note: one beat each with a breath between, at this tempo. */
export const EAR_TEMPO = 80;

export function earNotes(round: PracticeGameRound): GameNoteLike[] {
  if (round.dohMidi == null || round.noteMidi == null) return [];
  if (round.noteSeconds != null && round.noteSeconds > 0) {
    // An arcade round (the web's endless games) sounds each note `noteSeconds` long at EAR_TEMPO.
    const beats = (round.noteSeconds * EAR_TEMPO) / 60;
    return [
      { pitchMidi: round.dohMidi, startBeat: 0, durBeats: beats },
      { pitchMidi: round.noteMidi, startBeat: beats * 1.25, durBeats: beats },
    ];
  }
  return [
    { pitchMidi: round.dohMidi, startBeat: 0, durBeats: 1 },
    { pitchMidi: round.noteMidi, startBeat: 1.25, durBeats: 1.5 },
  ];
}

// ── Staff to solfa ──────────────────────────────────────────────────────────

/** E4, the treble stave's bottom line, as octave × 7 + letter (C = 0). */
const BOTTOM_LINE = 4 * 7 + 2;

/**
 * Where a note sits on the treble stave: half-spaces up from the bottom line (E4 = 0, F4 = 1, the top line F5 = 8,
 * G5 = 9 just over it). Null for a name it cannot read.
 */
export function staffStep(noteName: string): number | null {
  const m = /^([A-G])([#b]?)(\d)$/.exec(noteName);
  if (!m) return null;
  return Number(m[3]) * 7 + "CDEFGAB".indexOf(m[1]!) - BOTTOM_LINE;
}

/** The accidental a note's name carries (the key signature already shows it, so the note is drawn plain). */
export function accidentalOf(noteName: string): "#" | "b" | null {
  const m = /^[A-G]([#b])\d$/.exec(noteName);
  return m ? (m[1] as "#" | "b") : null;
}

/** The treble key signature: where each sharp (F C G D A E B) or flat (B E A D G C F) sits, as `staffStep` counts. */
const SHARP_STEPS = [8, 5, 9, 6, 3, 7, 4];
const FLAT_STEPS = [4, 7, 3, 6, 2, 5, 1];

export function keySignature(fifths: number): { sign: "#" | "b"; step: number }[] {
  if (fifths > 0) return SHARP_STEPS.slice(0, Math.min(7, fifths)).map((step) => ({ sign: "#", step }));
  if (fifths < 0) return FLAT_STEPS.slice(0, Math.min(7, -fifths)).map((step) => ({ sign: "b", step }));
  return [];
}

/** The race's clock: "0:37". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── Name that hymn ──────────────────────────────────────────────────────────

/** A note as a game plays it (the synth takes a full NoteEvent; this is what a game knows of one). */
export interface GameNoteLike {
  pitchMidi: number;
  startBeat: number;
  durBeats: number;
}

/** Notes as the synth takes them. */
export function asNoteEvents(notes: readonly GameNoteLike[]): NoteEvent[] {
  return notes.map((n) => ({ ...n, degree: 0, solfa: "", octaveMark: "", conf: 1 }));
}

// ── The end ─────────────────────────────────────────────────────────────────

/** The end card's big line: "8 of 10 right", or for the race "14 right". */
export function resultTitle(grade: PracticeGameGrade): string {
  return grade.game === "staff" ? `${grade.right} right` : `${grade.right} of ${grade.rounds} right`;
}

/** The line under it: how the race went, or what the game earned and why it did not. */
export function resultLine(grade: PracticeGameGrade, perDay: number): string {
  const how = grade.game === "staff" && grade.answered > 0 ? `${grade.score}% of the ${grade.answered} you answered. ` : "";
  if (grade.counted && grade.reward) return `${how}+${grade.reward.xpGained} XP`;
  if (grade.notCounted === "few") return `${how}Answer at least five notes for a race to count.`;
  if (grade.notCounted === "daily") return `${how}Played for fun: today's ${perDay} games that earn XP are done.`;
  return how.trim();
}
