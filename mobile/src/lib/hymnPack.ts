/**
 * The offline hymn pack: every hymn and tune page the website publishes, in one download
 * (web-site/hymns/pack.json, written by tools/blog/lib/hymn-pack.mjs). Pure: reading it, deciding
 * when to fetch a newer one, searching it and turning an entry into a sheet. `hymnPackStore.ts`
 * downloads and keeps it.
 *
 * The melody is [MIDI, start beat, beats] in quarter-note beats with any pickup at the end of the
 * first bar, as the worker's hymn index holds it, so a hymn opens exactly as a hymnbook version does
 * (`hymnbook.ts`): the sheet view labels the solfa itself.
 */
import type { HymnCredit, NoteEvent } from "../api/types";

export const PACK_FORMAT = 1;

export interface PackVerse {
  label?: string;
  lines: string[];
}

export interface PackHymn {
  slug: string;
  kind: "hymn" | "tune";
  title: string;
  /** The first line of words; empty for a tune without words. */
  firstLine: string;
  tune: string;
  key: string;
  time: string;
  tempo: number;
  pickup: number;
  credit: string;
  url: string;
  notes: [number, number, number][];
  /** The first verse in syllables under the notes ("A-maz-ing grace"). */
  words: string;
  verses: PackVerse[];
  /** The seasons and occasions it is sung for ("Christmas", "Easter"); absent on most and in older packs. */
  occasions?: string[];
}

export interface HymnPack {
  format: number;
  version: string;
  count: number;
  hymns: PackHymn[];
}

/** pack-version.json: what the weekly check reads (about 130 bytes). */
export interface PackMeta {
  format: number;
  version: string;
  count: number;
  bytes: number;
}

/** The pack as downloaded, or null when it is not one this build can read. */
export function parsePack(text: string): HymnPack | null {
  try {
    const x = JSON.parse(text) as Partial<HymnPack>;
    if (typeof x?.format !== "number" || x.format > PACK_FORMAT || typeof x.version !== "string" || !Array.isArray(x.hymns)) return null;
    const hymns = x.hymns.filter(
      (h): h is PackHymn =>
        !!h && typeof h.slug === "string" && typeof h.title === "string" && typeof h.key === "string" &&
        typeof h.time === "string" && Array.isArray(h.notes) && h.notes.length > 0,
    );
    if (hymns.length === 0) return null;
    return { format: x.format, version: x.version, count: hymns.length, hymns };
  } catch {
    return null;
  }
}

export function parseMeta(text: string): PackMeta | null {
  try {
    const x = JSON.parse(text) as Partial<PackMeta>;
    if (typeof x?.format !== "number" || typeof x.version !== "string" || typeof x.bytes !== "number") return null;
    return { format: x.format, version: x.version, count: typeof x.count === "number" ? x.count : 0, bytes: x.bytes };
  } catch {
    return null;
  }
}

/**
 * Whether the published pack should replace the one on the phone. Versions are content hashes, so
 * "newer" is "different" — but never a format this build cannot read; that waits for an app update.
 */
export function needsDownload(localVersion: string | null, remote: PackMeta): boolean {
  if (remote.format > PACK_FORMAT) return false;
  return localVersion !== remote.version;
}

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether to look for a newer pack without being asked: once a week, and never on data saver
 * (the phone cannot tell us it is on Wi-Fi, so data saver means "only when I tap").
 */
export function autoCheckDue(s: { installed: boolean; lastCheckedAt: number | null; now: number; dataSaver: boolean }): boolean {
  if (!s.installed || s.dataSaver) return false;
  return s.lastCheckedAt === null || s.now - s.lastCheckedAt >= WEEK_MS;
}

/** Lower case, accents and punctuation gone, spaces single: "‘Tis So Sweet" → "tis so sweet". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Whether every word typed appears among the texts, folded (case, accents and punctuation ignored): the hymn search's
 * rule, also the Library's over a sheet's title and folder. Nothing typed matches everything.
 */
export function matchesWords(query: string, texts: readonly (string | null | undefined)[]): boolean {
  const q = fold(query);
  if (!q) return true;
  const all = texts.map((t) => fold(t ?? "")).join(" ");
  return q.split(" ").every((w) => all.includes(w));
}

/** Titles sort by their first letter, not by a quote mark in front of it. */
export function titleKey(title: string): string {
  return fold(title);
}

/** The words an occasion is found by: its own name, "carol" / "carols" for Christmas and "spooky" for Halloween. */
const OCCASION_WORDS: Record<string, string> = {
  christmas: "christmas carol carols",
  halloween: "halloween spooky",
};

function occasionWords(h: PackHymn): string {
  return occasionsOf(h).map((o) => OCCASION_WORDS[fold(o)] ?? fold(o)).join(" ");
}

function hasOccasion(h: PackHymn, occasion: string): boolean {
  return occasionsOf(h).some((o) => fold(o) === occasion);
}

function occasionsOf(h: PackHymn): string[] {
  return Array.isArray(h.occasions) ? h.occasions.filter((o): o is string => typeof o === "string") : [];
}

/**
 * Hymns matching what was typed, best first: a title that starts with it, then a title containing
 * it, then the first line, then the tune's name, then the occasion ("christmas" or "carol" finds the
 * carols; "halloween", "spooky" or "all saints" the songs for Halloween). Every word typed must
 * appear. Nothing typed is the whole pack by title.
 */
export function searchHymns(hymns: readonly PackHymn[], query: string): PackHymn[] {
  const q = fold(query);
  const byTitle = (a: PackHymn, b: PackHymn) => titleKey(a.title).localeCompare(titleKey(b.title)) || a.slug.localeCompare(b.slug);
  if (!q) return [...hymns].sort(byTitle);
  const words = q.split(" ");
  const scored: { h: PackHymn; rank: number }[] = [];
  for (const h of hymns) {
    const title = fold(h.title), first = fold(h.firstLine), tune = fold(h.tune), occasion = occasionWords(h);
    const all = `${title} ${first} ${tune} ${occasion}`;
    if (!words.every((w) => all.includes(w))) continue;
    const rank = title.startsWith(q) ? 0 : title.includes(q) ? 1 : first.includes(q) ? 2 : tune.includes(q) ? 3 : 4;
    scored.push({ h, rank });
  }
  return scored.sort((a, b) => a.rank - b.rank || byTitle(a.h, b.h)).map((s) => s.h);
}

/** The carols best known, first on the Christmas shelf in this order; the rest follow by title. */
const CAROL_ORDER = [
  "silent-night",
  "joy-to-the-world",
  "hark-the-herald-angels-sing",
  "o-come-all-ye-faithful",
  "angels-we-have-heard-on-high",
  "the-first-noel",
  "away-in-a-manger",
  "o-little-town-of-bethlehem",
  "once-in-royal-davids-city",
  "it-came-upon-a-midnight-clear",
  "good-king-wenceslas",
];

/**
 * The Christmas carols in the pack (hymns tagged `occasions: ["Christmas"]`), the best known first: the Hymns
 * screen's "Carols for Christmas" shelf while the season is on, and its "See all".
 */
export function carols(hymns: readonly PackHymn[]): PackHymn[] {
  const rank = (h: PackHymn) => {
    const i = CAROL_ORDER.indexOf(h.slug);
    return i < 0 ? CAROL_ORDER.length : i;
  };
  return hymns
    .filter((h) => hasOccasion(h, "christmas"))
    .sort((a, b) => rank(a) - rank(b) || titleKey(a.title).localeCompare(titleKey(b.title)) || a.slug.localeCompare(b.slug));
}

/**
 * The best known spooky songs, first on the Halloween shelf in this order (by title: they are being written into the
 * pack as this ships); the rest follow by title, and the All Saints tunes close it (All Hallows' Eve is the night
 * before All Saints' Day). The website's Halloween page lists the published ones in the same order
 * (tools/blog/lib/collections.mjs, the occasion's `first`).
 */
const HALLOWEEN_ORDER = ["mountain king", "toccata", "chopin", "ghost of john", "dem bones", "marionette", "danse macabre", "hearse song", "dies irae"];

/** A song for All Saints' Day (tagged "All Saints"), which the Halloween shelf ends with. */
export function isAllSaints(h: PackHymn): boolean {
  return hasOccasion(h, "all saints");
}

/**
 * The songs for Halloween in the pack (tagged `occasions` "Halloween"; the All Saints tunes carry ["All Saints",
 * "Halloween"]): the spooky ones first, the best known first, then the All Saints tunes. The Hymns screen's "Songs for
 * Halloween" shelf while the season is on, and its "See all".
 */
export function halloween(hymns: readonly PackHymn[]): PackHymn[] {
  const rank = (h: PackHymn) => {
    if (isAllSaints(h)) return HALLOWEEN_ORDER.length + 1;
    const title = fold(h.title);
    const i = HALLOWEEN_ORDER.findIndex((k) => title.includes(k));
    return i < 0 ? HALLOWEEN_ORDER.length : i;
  };
  return hymns
    .filter((h) => hasOccasion(h, "halloween"))
    .sort((a, b) => rank(a) - rank(b) || titleKey(a.title).localeCompare(titleKey(b.title)) || a.slug.localeCompare(b.slug));
}

/** "See all"'s filters on the Halloween shelf: every song, the spooky ones, the All Saints tunes. */
export type HalloweenFilter = "all" | "spooky" | "saints";

export function filterHalloween(songs: readonly PackHymn[], filter: HalloweenFilter): PackHymn[] {
  if (filter === "spooky") return songs.filter((h) => !isAllSaints(h));
  if (filter === "saints") return songs.filter(isAllSaints);
  return [...songs];
}

/** The season's shelf: the carols at Christmas, the songs for Halloween at Halloween. */
export function seasonShelf(hymns: readonly PackHymn[], season: "christmas" | "halloween"): PackHymn[] {
  return season === "halloween" ? halloween(hymns) : carols(hymns);
}

/** The pack's "In the Hall of the Mountain King" (the Night Singer's phrase), or null while the pack has none. */
export function mountainKing(hymns: readonly PackHymn[]): PackHymn | null {
  return hymns.find((h) => fold(h.title).includes("mountain king")) ?? null;
}

/** A hymn's opening as a shelf card prints it, from its labelled notes: "s l s m s l s m". */
export function openingLine(labelled: readonly Pick<NoteEvent, "solfa" | "octaveMark" | "startBeat">[], count = 8): string {
  return [...labelled]
    .sort((a, b) => a.startBeat - b.startBeat)
    .slice(0, count)
    .map((n) => n.solfa + n.octaveMark)
    .join(" ");
}

/** "Bb · 6/8": a hymn's key and time as the list prints them. */
export function keyAndTime(h: Pick<PackHymn, "key" | "time">): string {
  return `${h.key.replace(" major", "").replace(" minor", "m")} · ${h.time}`;
}

/** A hymn as the sheet view opens it (the solfa is labelled by `deriveSolfa` on the way in). */
export interface HymnSheet {
  notes: NoteEvent[];
  key: string;
  timeSignature: string;
  tempo: number;
  lyrics: string;
  hymn: HymnCredit;
}

export function hymnSheet(h: PackHymn): HymnSheet {
  return {
    notes: h.notes.map(([pitchMidi, startBeat, durBeats]) => ({ pitchMidi, startBeat, durBeats, degree: 0, solfa: "", octaveMark: "", conf: 1 })),
    key: h.key,
    timeSignature: h.time,
    tempo: h.tempo >= 20 && h.tempo <= 300 ? h.tempo : 90,
    lyrics: h.words,
    hymn: { slug: h.slug, title: h.title, url: h.url, credit: h.credit },
  };
}

/** "1.2 MB", "680 KB": sizes as the download button and Settings say them. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} B`;
}
