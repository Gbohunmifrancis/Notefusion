/**
 * Sample transcription for the store assets.
 *
 * One take, used by every screenshot, so the set reads as a single session
 * rather than five unrelated mock-ups. The note list is the only authored data:
 * the solfa strings, the syllables on the chips and the engraved stave are all
 * derived from it by the ported engine in `music.mjs`, so nothing on screen is
 * notation the app could not produce.
 *
 * Why this melody and not something recognisable: the twelve pitches sit inside
 * one doh-octave for BOTH G major and C major, so neither reading needs octave
 * marks on more than a few syllables, and every syllable stays diatonic — which
 * is what makes the re-key screenshot legible. A named hymn would also be a
 * claim about the notes that the invented contour could not back up.
 *
 * `conf` index 7 is deliberately below 0.5. It is the one note that trips the
 * "1 note below 50% confidence" row, because the PRD requires low confidence to
 * be visible and a screenshot that hides it is selling something else.
 */

export const TAKE = {
  title: "Choir rehearsal — soprano line",
  key: "G major",
  /** The re-key screenshot's target. C major keeps every syllable diatonic. */
  rekey: "C major",
  tempo: 84,
  timeSignature: "3/4",
  overallConfidence: 0.88,
  durationLabel: "00:18",
};

/** Two notes per 3/4 bar: a minim then a crotchet. Six bars, twelve notes. */
const PITCHES = [72, 74, 76, 74, 76, 72, 74, 71, 69, 71, 72, 67];
const CONFS = [0.94, 0.91, 0.89, 0.93, 0.87, 0.92, 0.9, 0.44, 0.88, 0.95, 0.86, 0.91];

export const NOTES = PITCHES.map((pitchMidi, i) => {
  const bar = Math.floor(i / 2);
  const second = i % 2 === 1;
  return {
    startBeat: bar * 3 + (second ? 2 : 0),
    durBeats: second ? 1 : 2,
    pitchMidi,
    conf: CONFS[i],
  };
});

/**
 * Library rows and the Home "Recent" list. Dates are fixed, never `new Date()`.
 *
 * Eight rows because five left a third of the Library screen empty, which reads
 * as an unused app. Formatting follows LibraryScreen: `day: "numeric"` so no
 * leading zero on the day, `hour: "2-digit"` so there is one on the hour.
 */
export const LIBRARY = [
  { title: "Choir rehearsal — soprano line", key: "G major", tempo: 84, date: "Aug 18, 2026", time: "07:42 PM", type: "Tonic Solfa" },
  { title: "Sunday anthem — descant", key: "D major", tempo: 96, date: "Aug 16, 2026", time: "09:15 AM", type: "Staff" },
  { title: "Evening hymn sketch", key: "A minor", tempo: 72, date: "Aug 14, 2026", time: "06:03 PM", type: "Tonic Solfa" },
  { title: "Praise medley — alto part", key: "C major", tempo: 108, date: "Aug 11, 2026", time: "04:28 PM", type: "Staff" },
  { title: "Warm-up scale run", key: "F major", tempo: 60, date: "Aug 9, 2026", time: "08:50 AM", type: "Tonic Solfa" },
  { title: "Offertory chorus — tenor line", key: "Eb major", tempo: 88, date: "Aug 7, 2026", time: "05:12 PM", type: "Staff" },
  { title: "Communion hymn — melody", key: "Bb major", tempo: 66, date: "Aug 4, 2026", time: "07:35 AM", type: "Tonic Solfa" },
  { title: "Call and response — youth choir", key: "E minor", tempo: 92, date: "Aug 2, 2026", time: "06:47 PM", type: "Staff" },
];

/**
 * The signed-in account. Free tier, so the trial pill and plain avatar ring show.
 * `trialTotal` is `FreeTier.TrialGenerations` (5) — the number the API actually
 * grants. A screenshot promising a different allowance is a false claim about
 * the product, so this tracks the constant, not the mock-up that looked nice.
 */
export const USER = { fullName: "Francis Okoye", initials: "FO", trialRemaining: 4, trialTotal: 5 };
