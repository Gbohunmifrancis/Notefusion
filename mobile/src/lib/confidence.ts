/**
 * What a confidence value means to the person reading the sheet.
 *
 * The number itself (for a sheet: the model's margin over its runner-up, weighed by
 * note length) is for the admin console. On a sheet, "52%" reads as a grade on the
 * singer and says nothing about what to do, so users get a plain note instead, and
 * only when there is something to do. These thresholds are the one copy in this app:
 * the traffic-light colours in `design/theme` read them too. The web app keeps its
 * own in `web-site/assets/confidence.js`.
 */
export const CONFIDENCE = {
  /** At or above: clear, nothing to say. */
  clear: 0.75,
  /** Below: the recording was hard to hear. A single note under this is flagged on the sheet. */
  hard: 0.5,
} as const;

export type ConfidenceLevel = "clear" | "check" | "hard";

/**
 * A note the sheet flags: amber and dotted on the grid, amber in a dotted ring on the stave, counted by "2 notes to
 * check" and walked by Check.
 */
export function isDoubtfulNote(conf: number): boolean {
  return conf < CONFIDENCE.hard;
}

/** The onsets (quarter notes) of the doubtful notes, once each and in order: the heads the stave rings. */
export function doubtfulBeats(notes: readonly { startBeat: number; conf: number }[]): number[] {
  const beats = new Set<number>();
  for (const n of notes) if (isDoubtfulNote(n.conf)) beats.add(Math.round(n.startBeat * 1000) / 1000);
  return [...beats].sort((a, b) => a - b);
}

export function confidenceLevel(conf: number): ConfidenceLevel {
  const c = Number.isFinite(conf) ? conf : 0;
  if (c >= CONFIDENCE.clear) return "clear";
  if (c >= CONFIDENCE.hard) return "check";
  return "hard";
}

/**
 * The note for a sheet whose overall confidence is `conf`, or null when it needs none.
 * `highlighted` says whether the sheet marks doubtful notes, so the note can point at them.
 */
export function confidenceNote(conf: number, highlighted: boolean): string | null {
  switch (confidenceLevel(conf)) {
    case "clear":
      return null;
    case "check":
      return highlighted ? "Check the highlighted notes." : "Some notes may need a check.";
    case "hard":
      return "This recording was hard to hear — listen back and correct any notes.";
  }
}

/** A short spoken description for a list row's tone dot (screen readers), never a number. */
export function confidenceA11y(conf: number): string {
  switch (confidenceLevel(conf)) {
    case "clear":
      return "clear recording";
    case "check":
      return "some notes may need a check";
    case "hard":
      return "hard to hear, worth checking";
  }
}
