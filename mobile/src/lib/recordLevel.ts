/**
 * The recording's level said in a word beside the trace (board n-ux-low Q5b): "Level: good", or the amber sign and
 * "Level: a little soft". Too quiet has no word here: the "Sing louder" banner says it, over the same spot. The word
 * changes at most once a second, so a breath or a loud syllable does not make it flicker (tests: recordLevel.test.ts).
 */

// Voice-level thresholds (dBFS, 0 = loudest, -160 = silence). expo-audio's metering value is an averaged power
// level in dBFS. Typical speaking/singing voice close to a phone mic sits around -20 to -6 dBFS; a quiet or distant
// voice drops below about -40 dBFS. These were chosen empirically against the Phase 0 spike recordings
// (spike/README.md) and err on the side of nudging the user rather than staying silent.
/** Effectively nothing reaching the mic. */
export const LEVEL_SILENCE_DBFS = -50;
/** Audible but too soft for confident transcription. */
export const LEVEL_QUIET_DBFS = -34;
/** Comfortably loud: the level reads "good" from here up. */
export const LEVEL_GOOD_DBFS = -18;

/** How long a word stays before the line may change again. */
export const LEVEL_WORD_HOLD_MS = 1000;

export type LevelWord = "good" | "soft";

/** The word for one reading; null below the quiet line, where the banner speaks instead. */
export function levelWordFor(dbfs: number): LevelWord | null {
  if (dbfs >= LEVEL_GOOD_DBFS) return "good";
  if (dbfs >= LEVEL_QUIET_DBFS) return "soft";
  return null;
}

/** What the line says now, and since when. */
export interface LevelLine {
  word: LevelWord | null;
  since: number;
}

/**
 * The line after one more reading: the reading's word, unless the line changed less than a second ago. Returns `prev`
 * itself when nothing changes, so a state setter given it does not re-render.
 */
export function nextLevelLine(prev: LevelLine | null, dbfs: number, now: number): LevelLine {
  const word = levelWordFor(dbfs);
  if (!prev) return { word, since: now };
  if (word === prev.word || now - prev.since < LEVEL_WORD_HOLD_MS) return prev;
  return { word, since: now };
}

/** The line's words. */
export function levelText(word: LevelWord): string {
  return word === "good" ? "Level: good" : "Level: a little soft";
}
