/**
 * What the Hymns tab shows under its download card before the pack is on the phone: a few of the pack's own rows, faded,
 * so the page reads as the hymnbook it becomes rather than one card and an empty screen. Bundled (titles, first lines,
 * keys and times only), so it shows offline and before anything is fetched.
 *
 * Pure; hymnPreview.test.ts checks every row against web-site/hymns/pack.json, so a row always matches its hymn's page.
 */
import type { PackHymn } from "./hymnPack";

export type PreviewHymn = Pick<PackHymn, "slug" | "kind" | "title" | "firstLine" | "tune" | "key" | "time">;

/** Well-known hymns first, as a singer would look for them. */
export const HYMN_PREVIEW: PreviewHymn[] = [
  { slug: "amazing-grace", kind: "hymn", title: "Amazing Grace", firstLine: "Amazing grace! how sweet the sound", tune: "NEW BRITAIN", key: "G major", time: "3/4" },
  { slug: "abide-with-me", kind: "hymn", title: "Abide with Me", firstLine: "Abide with me; fast falls the eventide;", tune: "EVENTIDE", key: "Eb major", time: "4/4" },
  { slug: "what-a-friend-we-have-in-jesus", kind: "hymn", title: "What a Friend We Have in Jesus", firstLine: "What a friend we have in Jesus,", tune: "CONVERSE", key: "F major", time: "4/4" },
  { slug: "it-is-well-with-my-soul", kind: "hymn", title: "It Is Well with My Soul", firstLine: "When peace, like a river, attendeth my way,", tune: "VILLE DU HAVRE", key: "Db major", time: "4/4" },
  { slug: "holy-holy-holy", kind: "hymn", title: "Holy, Holy, Holy! Lord God Almighty", firstLine: "Holy, holy, holy! Lord God Almighty!", tune: "NICAEA", key: "D major", time: "4/4" },
  { slug: "blessed-assurance", kind: "hymn", title: "Blessed Assurance", firstLine: "Blessed assurance, Jesus is mine!", tune: "ASSURANCE", key: "D major", time: "9/8" },
  { slug: "o-god-our-help-in-ages-past", kind: "hymn", title: "O God, Our Help in Ages Past", firstLine: "O God, our help in ages past,", tune: "ST ANNE", key: "C major", time: "4/4" },
  { slug: "when-i-survey-the-wondrous-cross", kind: "hymn", title: "When I Survey the Wondrous Cross", firstLine: "When I survey the wondrous cross", tune: "ROCKINGHAM", key: "D major", time: "3/4" },
  { slug: "to-god-be-the-glory", kind: "hymn", title: "To God Be the Glory", firstLine: "To God be the glory, great things He hath done!", tune: "TO GOD BE THE GLORY", key: "Ab major", time: "3/4" },
];

/** Each row a little fainter than the one above, so the list trails off towards the tab bar. */
export function previewOpacity(index: number, count: number): number {
  if (count <= 1) return 1;
  const full = Math.ceil(count / 3);
  if (index < full) return 1;
  return Math.max(0.15, 1 - ((index - full + 1) / (count - full + 1)) * 0.85);
}
