/**
 * The tips Doh gives when tapped on an empty state (board c-practice/8b): the app's own advice, one at a time — the
 * failed-transcription email's three (C# `BrandedEmailTemplate.TranscriptionFailed`) and Help's answers. Tests:
 * dohTips.test.ts.
 */

export const DOH_TIPS: readonly string[] = [
  "Hum, sing or play a few bars. One clear line is all I need.",
  "Record about an arm's length away, somewhere quiet. One voice at a time comes out cleanest.",
  "Keep it under about two minutes. For a song, pick just the section you need.",
  "Wrong doh? Pick another key and the syllables re-label. The notes never move.",
  "Notes I'm unsure of are outlined. Tap one to hear it and fix it.",
  "Export sends a sheet to MuseScore, Sibelius or Finale as MusicXML.",
];

/** The tip after `current` (null: none shown yet), round and round. */
export function nextTip(current: number | null, count = DOH_TIPS.length): number {
  if (count <= 0) return 0;
  return current === null ? 0 : (current + 1) % count;
}

/** "Tip 2 of 6". */
export function tipLabel(index: number, count = DOH_TIPS.length): string {
  return `Tip ${index + 1} of ${count}`;
}
