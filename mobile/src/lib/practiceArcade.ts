/**
 * The game-coloured Practice, the pure part: the path drawn as stops, the unit's banner, the day's quests, and the
 * arcade (the quick games played stage after stage, a level at a time, with no top). The mirror of the web's
 * `web-site/assets/practice-arcade.js` (same rules, same tests in `practiceArcade.test.ts`), with the phone's own
 * few additions underneath: the kept level read and written as the raw string AsyncStorage holds (`lib/arcadeStore`
 * does the storing), the side of the START stop Doh stands on, and the words between stages.
 *
 * The server deals any level asked (`GET /api/practice/games/{game}?level=`) and each stage's mark says the level to
 * deal next (`nextLevel`); the level is this phone's to keep, never a reward. The server's ladder is PracticeGames.cs;
 * the words here say what each level brings, in step with it.
 */

import type { DailyQuest, DailyQuests, PracticeGame, PracticeGameGrade, PracticeGameId, PracticeTrack } from "../api/types";

// ── The arcade ──────────────────────────────────────────────────────────────

/** A stage passed at this score deals the next level; under LEVEL_DOWN the one below. As the server's. */
export const LEVEL_UP = 80;
export const LEVEL_DOWN = 50;

/** The level each track starts a game at: Playful the gentlest, Focused where its one-off games were. */
export function startLevel(track: PracticeTrack | null | undefined): number {
  return track === "playful" ? 1 : 3;
}

/** Right answers a stage needs to deal the next level. */
export function stageGoal(rounds: number): number {
  return Math.ceil((rounds * LEVEL_UP) / 100);
}

/** How many more right answers this stage needs for the next level (0 once it has them). */
export function toLevelUp(marks: readonly boolean[] | null | undefined, rounds: number): number {
  const right = (marks ?? []).filter(Boolean).length;
  return Math.max(0, stageGoal(rounds) - right);
}

/** The stage's bar toward the next level, 0–1. */
export function stageFraction(marks: readonly boolean[] | null | undefined, rounds: number): number {
  const goal = stageGoal(rounds);
  return goal ? Math.min(1, (marks ?? []).filter(Boolean).length / goal) : 0;
}

/** Right answers in a row across stages: the flame's number. */
export function runAfter(run: number, right: boolean): number {
  return right ? run + 1 : 0;
}

const EAR_NEW = [["m", "s", "d'"], ["r", "f"], ["l", "t"], ["r'", "m'"], ["t,", "l,", "s,"], ["fe"], ["ta"], ["se"], ["de"], ["ma"]];
const EAR_FULL = EAR_NEW.length;
const STAFF_NEW = [null, "D and B♭", "A and E♭", "E and A♭, and ledger lines", "B and D♭, low C to top C", "F♯ and G♭"];
const HYMN_CHOICES = [3, 3, 4, 4, 5, 5, 6];

/** Which scale?'s levels, as the server brings them (PracticeGames.ScaleLevels), with each scale's short name. */
export const SCALE_LEVELS: readonly (readonly string[])[] = [
  ["major", "natural-minor"], ["harmonic-minor"], ["major-pentatonic", "minor-pentatonic"], ["blues"], ["melodic-minor"],
  ["dorian", "mixolydian"], ["phrygian", "lydian"], ["hijaz", "whole-tone"], ["japanese-in", "double-harmonic"], ["hungarian-minor", "locrian"],
];
const SCALE_NAMES: Record<string, string> = {
  major: "major", "natural-minor": "minor", "harmonic-minor": "harmonic minor", "major-pentatonic": "major pentatonic",
  "minor-pentatonic": "minor pentatonic", blues: "blues", "melodic-minor": "melodic minor", dorian: "Dorian",
  mixolydian: "Mixolydian", phrygian: "Phrygian", lydian: "Lydian", hijaz: "Hijaz", "whole-tone": "whole-tone",
  "japanese-in": "Japanese in", "double-harmonic": "double harmonic", "hungarian-minor": "Hungarian minor", locrian: "Locrian",
};

export function scaleTempo(level: number): number {
  return Math.min(200, 96 + 8 * Math.max(0, level - SCALE_LEVELS.length));
}

/** Seconds a level's Staff to solfa gives each note (the server's StaffSecondsPerNote). */
export function staffSeconds(level: number): number {
  return Math.max(1.5, 6 - 0.5 * (Math.max(1, level) - 1));
}
function hymnChoices(level: number): number {
  return HYMN_CHOICES[Math.min(HYMN_CHOICES.length, Math.max(1, level)) - 1]!;
}
function hymnNotes(level: number): number | null {
  return level <= 2 ? null : Math.max(4, 12 - 2 * (level - 3));
}
function seconds(s: number): string {
  return `${Math.round(s * 10) / 10} s`;
}

/** What a level brings, in a few words: "New: fe", "New keys: D and B♭", "5 hymns to pick from". */
export function levelNews(game: PracticeGameId, level: number): string {
  const l = Math.max(1, level);
  if (game === "which-note") {
    if (l <= EAR_FULL) return (l === 1 ? "Notes: " : "New: ") + EAR_NEW[l - 1]!.join(", ");
    return "Every note, played shorter";
  }
  if (game === "which-scale") {
    if (l > SCALE_LEVELS.length) return `Quicker: ${scaleTempo(l)} beats a minute`;
    const names = SCALE_LEVELS[l - 1]!.map((c) => SCALE_NAMES[c]).join(" and ");
    return (l === 1 ? "Scales: " : "New: ") + names;
  }
  if (game === "staff") {
    if (l === 1) return "Keys: C, G and F";
    if (l <= STAFF_NEW.length) return `New keys: ${STAFF_NEW[l - 1]}`;
    return `${seconds(staffSeconds(l))} a note`;
  }
  if (l <= 2) return `${hymnChoices(l)} hymns to pick from`;
  const choices = hymnChoices(l);
  const before = hymnChoices(l - 1);
  return choices > before ? `${choices} hymns to pick from` : `${hymnNotes(l)} notes of each opening`;
}

/** The next two levels' news, then what every level after brings: the level-up screen's "What's coming". */
export function comingNext(game: PracticeGameId, level: number): { level: number | null; text: string }[] {
  const after =
    game === "which-note" ? "Every level after: shorter notes, quicker ears"
    : game === "staff" ? "Every level after: less time on each note"
    : game === "which-scale" ? "Every level after: quicker scales"
    : "Every level after: less of each opening to go on";
  return [
    { level: level + 1, text: levelNews(game, level + 1) },
    { level: level + 2, text: levelNews(game, level + 2) },
    { level: null, text: after },
  ];
}

// ── The level kept on this phone ────────────────────────────────────────────

/** A game's level and the best it has reached here. */
export interface ArcadeKept {
  level: number;
  best: number;
}

/** Where a game's level is kept, as the web keeps it in the browser. */
export function storageKey(game: PracticeGameId): string {
  return `nf.arcade.${game}`;
}

function parseKept(raw: string | null | undefined): { level?: unknown; best?: unknown } | null {
  try {
    const got: unknown = JSON.parse(raw ?? "null");
    return got && typeof got === "object" ? (got as { level?: unknown; best?: unknown }) : null;
  } catch {
    return null;
  }
}
function atLeastOne(v: unknown): number | null {
  return typeof v === "number" && v >= 1 ? Math.floor(v) : null;
}

/** The game's level and best from what is kept (the web's `recall`); a track's first level when none is (or it is unreadable). */
export function recallFrom(raw: string | null | undefined, track: PracticeTrack | null | undefined): ArcadeKept {
  const got = parseKept(raw);
  const level = atLeastOne(got?.level) ?? startLevel(track);
  const best = atLeastOne(got?.best) ?? level;
  return { level, best: Math.max(best, level) };
}

/** The level to keep over what was kept (the web's `remember`): the best never falls. Store `JSON.stringify` of it. */
export function rememberOver(raw: string | null | undefined, level: number): ArcadeKept {
  const was = atLeastOne(parseKept(raw)?.best);
  return { level, best: Math.max(level, was ?? level) };
}

/** Whether a deal is an arcade stage: an older server ignores `?level=` and deals a one-off game, which plays as before. */
export function isArcadeDeal(deal: Pick<PracticeGame, "level"> | null | undefined): boolean {
  return deal?.level != null;
}

/** The level a stage's mark deals next, or null from an older server (then the game ends as a one-off). */
export function nextLevelOf(grade: Pick<PracticeGameGrade, "nextLevel"> | null | undefined): number | null {
  const next = grade?.nextLevel;
  return typeof next === "number" && next >= 1 ? next : null;
}

/** Up, down or the same, from the level just played to the one dealt next. */
export function levelChange(was: number, next: number): "up" | "down" | "same" {
  return next > was ? "up" : next < was ? "down" : "same";
}

/** The line over the next stage after one that did not move up: plain, and never a scolding. */
export function stageNote(was: number, next: number, rounds: number): string {
  return next < was
    ? `Back to level ${next}: a little gentler. You'll climb again.`
    : `Level ${next} again: ${stageGoal(rounds)} right in a stage moves you up.`;
}

/** Under the stage's bar: how many more to the next level, or that it is coming. */
export function toLevelUpLine(marks: readonly boolean[], rounds: number, level: number): string {
  const left = toLevelUp(marks, rounds);
  return left > 0 ? `${left} more to level ${level + 1}` : `Level ${level + 1} next!`;
}

/** A game tile's line once a level is kept: "Level 4", or "Level 4 · best 6". */
export function tileLevelLine(kept: ArcadeKept): string {
  return `Level ${kept.level}${kept.best > kept.level ? ` · best ${kept.best}` : ""}`;
}

// ── The path as stops ───────────────────────────────────────────────────────

/** Stops snake left and right like a path, as sideways offsets in px from the middle. */
export const SNAKE: readonly number[] = [0, 44, 72, 44, 0, -44, -72, -44];

export type StopKind = "done" | "current" | "locked" | "chest";
export interface PathStop {
  kind: StopKind;
  index: number;
  offset: number;
}

/**
 * The unit as stops down the path: the drills behind the singer done, the one offered now, those ahead locked, then the
 * unit's chest. Each stop with its sideways offset. Empty for a drill with no place on a path (a season's).
 */
export function pathStops(drill: { drillIndex?: number; drillCount?: number } | null | undefined): PathStop[] {
  if (!drill || !((drill.drillCount ?? 0) > 0) || !((drill.drillIndex ?? 0) > 0)) return [];
  const count = drill.drillCount!;
  const at = drill.drillIndex!;
  const stops: PathStop[] = [];
  for (let i = 1; i <= count; i++) {
    stops.push({ kind: i < at ? "done" : i === at ? "current" : "locked", index: i, offset: SNAKE[(i - 1) % SNAKE.length]! });
  }
  stops.push({ kind: "chest", index: count + 1, offset: SNAKE[count % SNAKE.length]! });
  return stops;
}

/**
 * The side of the START stop Doh stands on (the phone's): the side with the more room, so he never leaves a 360 px
 * screen when the path has swung that way.
 */
export function dohSide(offset: number): "left" | "right" {
  return offset < 0 ? "right" : "left";
}

export type GameTone = "green" | "blue" | "orange" | "cyan" | "pink";

/** The unit's banner: "GRADE 3 · UNIT 2" over the unit's title, in its grade's colour (Mastery its own). */
const TONES: readonly GameTone[] = ["green", "blue", "orange", "cyan", "pink"];
export interface UnitBanner {
  eyebrow: string;
  title: string;
  tone: GameTone;
  mastery: boolean;
}
export function unitBanner(
  drill: { grade?: string | null; unit?: string | null; title?: string | null; unitIndex?: number; unitCount?: number } | null | undefined,
): UnitBanner | null {
  if (!drill || !drill.grade) return null;
  const mastery = /^Mastery /.test(drill.grade);
  const n = parseInt(String(drill.grade).replace(/\D+/g, ""), 10) || 1;
  const tone: GameTone = mastery ? "pink" : /^Advanced/.test(drill.grade) ? "cyan" : TONES[(n - 1) % 4]!;
  const unitIndex = drill.unitIndex ?? 0;
  const unitCount = drill.unitCount ?? 0;
  const eyebrow = drill.grade.toUpperCase() + (unitIndex > 0 ? ` · UNIT ${unitIndex}${unitCount > 0 ? ` OF ${unitCount}` : ""}` : "");
  return { eyebrow, title: drill.unit || drill.title || "", tone, mastery };
}

// ── The day's quests ────────────────────────────────────────────────────────

/** "Quests 2/3", and whether the chest is open, for the top bar's chip. */
export function questsChip(quests: Pick<DailyQuests, "quests" | "chestOpened"> | null | undefined): { done: number; total: number; label: string; open: boolean } | null {
  if (!quests || !quests.quests || !quests.quests.length) return null;
  const done = quests.quests.filter((q) => q.done).length;
  return { done, total: quests.quests.length, label: `Quests ${done}/${quests.quests.length}`, open: !!quests.chestOpened };
}

/** A quest's bar, 0–1, and its "2/3". */
export function questProgress(q: Pick<DailyQuest, "progress" | "target">): { fraction: number; text: string } {
  return { fraction: q.target > 0 ? Math.min(1, q.progress / q.target) : 0, text: `${Math.min(q.progress, q.target)}/${q.target}` };
}

/** Whether a take opened the chest: none open before, open after. */
export function chestJustOpened(
  before: Pick<DailyQuests, "chestOpened"> | null | undefined,
  after: Pick<DailyQuests, "chestOpened"> | null | undefined,
): boolean {
  return !!after?.chestOpened && !before?.chestOpened;
}

/** The quests card's chest line and the note under the quests. */
export function chestWords(quests: Pick<DailyQuests, "chestOpened" | "chestXp">): { chest: string; note: string } {
  return quests.chestOpened
    ? { chest: `Opened · +${quests.chestXp} XP`, note: "Chest opened! All three done. New quests tomorrow." }
    : { chest: `+${quests.chestXp} XP`, note: "Do all three today to open the chest." };
}
