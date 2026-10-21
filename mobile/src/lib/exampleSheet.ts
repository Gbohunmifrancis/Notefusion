/**
 * "See an example" (board n-ux-low Q4j): what the app makes, for an account with no sheets yet. Amazing Grace from the
 * hymn pack (web-site/hymns/pack.json), bundled with the app so it opens offline and before the pack is downloaded,
 * and opened on Result as a sheet that is not in the Library: play, Rehearse and every layout work, Save and share
 * are hidden, so nothing is spent or filed (`openSheet.exampleResult`, Result's `example`).
 *
 * Pure; exampleSheet.test.ts checks the notes against the pack, so the example stays the hymn page's own.
 */
import type { PackHymn } from "./hymnPack";

/** The pack's Amazing Grace (doh G, 3/4, a one-beat pickup). Its verses are the Hymns tab's, not the sheet's. */
export const EXAMPLE_HYMN: PackHymn = {
  slug: "amazing-grace",
  kind: "hymn",
  title: "Amazing Grace",
  firstLine: "Amazing grace! how sweet the sound",
  tune: "NEW BRITAIN",
  key: "G major",
  time: "3/4",
  tempo: 76,
  pickup: 1,
  credit: "Tune NEW BRITAIN by Edwin O. Excell (1851–1921); words by John Newton (1725–1807).",
  url: "https://notefusion.studio/hymns/amazing-grace",
  notes: [
    [62, 2, 1], [67, 3, 2], [71, 5, 0.5], [67, 5.5, 0.5], [71, 6, 2], [69, 8, 1], [67, 9, 2], [64, 11, 1],
    [62, 12, 2], [62, 14, 1], [67, 15, 2], [71, 17, 0.5], [67, 17.5, 0.5], [71, 18, 2], [69, 20, 1], [74, 21, 5],
    [71, 26, 1], [74, 27, 2], [71, 29, 0.5], [67, 29.5, 0.5], [71, 30, 2], [69, 32, 1], [67, 33, 2], [64, 35, 1],
    [62, 36, 2], [62, 38, 1], [67, 39, 2], [71, 41, 0.5], [67, 41.5, 0.5], [71, 42, 2], [69, 44, 1], [67, 45, 5],
  ],
  words:
    "A-maz-ing_ grace! how sweet the sound, That saved a_ wretch like me! I once was_ lost, but now am found; Was blind, but_ now I see.",
  verses: [],
};

/** The line under the example's title, where a sheet says what it is. */
export const EXAMPLE_SUBTITLE = "An example — not in your Library";

/** The blue line under it: what the example is for, and the way to one's own. */
export const EXAMPLE_NOTICE = "This is how a sheet looks. Record a tune and yours lands in your Library.";

/** Offered on Home's and the Library's empty states until the first sheet exists. */
export function offerExample(sheetCount: number): boolean {
  return sheetCount === 0;
}
