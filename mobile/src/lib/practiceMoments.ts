/**
 * Which reward moments a marked take earns, and with what values: the mirror of the web's
 * `web-site/assets/practice-moments.js` (same rules, same tests in `practiceMoments.test.ts`). The moments are drawn by
 * `lib/momentArt.ts` and played by `components/practice/Moments.tsx`.
 *
 * A Playful take shows its stars first. Then one moment at most, the biggest the take earned: a level or a badge (the
 * reward's own toast and confetti, so none here), a unit or grade finished (the music box), the week's goal met on the
 * day's first take (the ring), the day's first take (the streak), a run of five or more notes in tune (the combo), and
 * for Playful's three stars with nothing else, Doh cheering.
 */

import type { GradeResult, PracticeTrack, PracticeStreak, WeeklyGoal } from "../api/types";

export type MomentPiece = "stars" | "streak" | "goal" | "combo" | "musicbox" | "doh";
export type MomentValues = Record<string, number | string>;
export interface Moment {
  piece: MomentPiece;
  values: MomentValues;
}

export const RUN_AT_LEAST = 5;

/** The progress as it stood before the take: only what the choice reads. */
export interface MomentsBefore {
  streak?: Pick<PracticeStreak, "todayDone"> | null;
  weeklyGoal?: Pick<WeeklyGoal, "daysDone" | "target"> | null;
}

/** 1-3 stars for a mark, as practiceTrack gives them (80 and up three, 50 and up two). */
function starsFor(score: number): number {
  return score >= 80 ? 3 : score >= 50 ? 2 : 1;
}

/** The most notes in tune one after another in a take's marks ("hit"). */
export function longestRun(marks: readonly { status: string }[] | null | undefined): number {
  let best = 0;
  let now = 0;
  for (const m of marks ?? []) {
    now = m && m.status === "hit" ? now + 1 : 0;
    if (now > best) best = now;
  }
  return best;
}

function moment(piece: MomentPiece, values: MomentValues = {}): Moment {
  return { piece, values };
}

/** The one big moment a take earned beside a level or badge (null: none, or the reward's own celebration). */
function mainFor(track: PracticeTrack | null, before: MomentsBefore | null, grade: GradeResult): Moment | null {
  const reward = grade.reward;
  if (reward && (reward.levelUp || (reward.newBadges ?? []).length)) return null;
  if (grade.milestone) return moment("musicbox", { label: grade.milestone.kind === "grade" ? "Grade done!" : "Unit done!" });
  const firstToday = !!(before?.streak && !before.streak.todayDone);
  if (firstToday) {
    const goal = before?.weeklyGoal;
    if (goal && goal.target > 0 && goal.daysDone < goal.target && goal.daysDone + 1 >= goal.target) {
      return moment("goal", { done: goal.daysDone + 1, target: goal.target });
    }
    if (reward && reward.streak >= 1) return moment("streak", { days: reward.streak });
  }
  const marks = grade.notes ?? [];
  const run = longestRun(marks);
  if (run >= RUN_AT_LEAST) return moment("combo", { run, perfect: run === marks.length ? 1 : 0 });
  if (track === "playful" && starsFor(grade.score) === 3) return moment("doh");
  return null;
}

/** The moments a marked take earns, in the order they play: Playful's stars, then the biggest of the rest. */
export function momentsFor(track: PracticeTrack | null, before: MomentsBefore | null, grade: GradeResult | null): Moment[] {
  if (!grade) return [];
  const out: Moment[] = [];
  if (track === "playful") out.push(moment("stars", { stars: starsFor(grade.score) }));
  const main = mainFor(track, before, grade);
  if (main) out.push(main);
  return out;
}

/** Play-along's end: its stars from the share of notes right first time, and a perfect run of five or more. */
export function alongMoments(score: { firstTime: number; total: number } | null): Moment[] {
  if (!score || !score.total) return [];
  const share = score.firstTime / score.total;
  const out = [moment("stars", { stars: share >= 0.9 ? 3 : share >= 0.6 ? 2 : 1 })];
  if (score.firstTime === score.total && score.total >= RUN_AT_LEAST) out.push(moment("combo", { run: score.total, perfect: 1 }));
  return out;
}
