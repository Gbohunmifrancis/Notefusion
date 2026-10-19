/**
 * The seasons on the phone (boards d-christmas and j-halloween), the pure half: the flag as the phone keeps it, which
 * season is on and what it wears (Christmas's cap, Halloween's witch hat), which splash a launch plays, once a season,
 * the snow and the bats, the chimes' notes, the season's words and its practice path as the screens draw it.
 * `seasonStore` reads and keeps the flag, `seasonChime` plays the tunes.
 *
 * One switch per season decides it all: the admin console's, read at `GET /api/app/season` (`{ christmas, halloween }`,
 * at most one true) at startup and whenever the app comes forward, and kept per device so the splash can dress before
 * the network answers. One season at a time (Christmas first, should both ever say true). With both off every screen is
 * exactly as it was; nothing here carries a date of its own.
 */

import type { NoteEvent, PracticeSeason } from "../api/types";
import type { Palette } from "../design/theme";
import type { IconName } from "../design/iconGlyphs";

/** Where the phone keeps the last answer (AsyncStorage), so the next launch's splash knows it at once. */
export const SEASON_CACHE_KEY = "nf.season";
/** The Christmas season whose splash intro (the cap's drop and the chime) this phone has had: once a season. */
export const SEASON_INTRO_KEY = "nf.seasonIntro";

export type SeasonName = "christmas" | "halloween";

/** The seasons in the server's order of precedence: Christmas first, should an admin ever preview both. */
export const SEASONS: readonly SeasonName[] = Object.freeze(["christmas", "halloween"] as const);

export interface SeasonFlag {
  christmas: boolean;
  halloween: boolean;
}

export const NO_SEASON: SeasonFlag = Object.freeze({ christmas: false, halloween: false });
const CHRISTMAS: SeasonFlag = Object.freeze({ christmas: true, halloween: false });
const HALLOWEEN: SeasonFlag = Object.freeze({ christmas: false, halloween: true });

/** Only `true` turns a season on, and only one at a time: Christmas wins if both say so. */
function flagOf(x: unknown): SeasonFlag {
  if (!x || typeof x !== "object") return NO_SEASON;
  const o = x as { christmas?: unknown; halloween?: unknown };
  if (o.christmas === true) return CHRISTMAS;
  if (o.halloween === true) return HALLOWEEN;
  return NO_SEASON;
}

/** The kept answer, or no season when there is none or it cannot be read (the default is always off). */
export function parseSeason(text: string | null | undefined): SeasonFlag {
  if (!text) return NO_SEASON;
  try {
    return flagOf(JSON.parse(text));
  } catch {
    return NO_SEASON;
  }
}

/** The server's answer as the phone keeps it: only `true` turns a season on. */
export function seasonFrom(answer: unknown): SeasonFlag {
  return flagOf(answer);
}

export function serializeSeason(s: SeasonFlag): string {
  return JSON.stringify({ christmas: s.christmas, halloween: s.halloween });
}

export function sameSeason(a: SeasonFlag, b: SeasonFlag): boolean {
  return a.christmas === b.christmas && a.halloween === b.halloween;
}

/** The season on, or null. */
export function activeSeason(s: SeasonFlag): SeasonName | null {
  return s.christmas ? "christmas" : s.halloween ? "halloween" : null;
}

/** A path card's season (`PracticeSeason.season`), as this build knows it: anything but "halloween" is the carols. */
export function seasonOf(name: string | null | undefined): SeasonName {
  return name === "halloween" ? "halloween" : "christmas";
}

/**
 * A season's own name, for once-a-season: the year it starts in. A Christmas season runs into January, so December
 * 2026 and the first days of January 2027 are both "christmas-2026"; Halloween (October into 1 November) is its year.
 */
export function seasonKey(now: Date, season: SeasonName = "christmas"): string {
  const year = now.getFullYear();
  if (season === "halloween") return `halloween-${year}`;
  return `christmas-${now.getMonth() >= 6 ? year : year - 1}`;
}

/** Where a season's "intro played" is kept: Christmas's key as it always was, Halloween's beside it. */
export function seasonIntroKey(season: SeasonName): string {
  return season === "christmas" ? SEASON_INTRO_KEY : `${SEASON_INTRO_KEY}.${season}`;
}

/**
 * What the splash wears on this launch: nothing (no season is on, or the phone has never heard one is), the season's
 * intro (once a season: the full four beats, the costume dropping onto the mark, a few seconds of snow or bats and the
 * chime), or the costume alone (`dressed`, every launch after that).
 */
export type SplashSeason = "none" | "intro" | "dressed";

/** `lastIntro`: what the season on keeps under its intro key (`seasonIntroKey`). */
export function splashSeason(cached: SeasonFlag, lastIntro: string | null, now: Date): SplashSeason {
  const season = activeSeason(cached);
  if (!season) return "none";
  return lastIntro === seasonKey(now, season) ? "dressed" : "intro";
}

// ── What the mark and Doh wear (design/practice-art/season.mjs: each one's brim middle at (100, 125) of 200 × 150) ──

export type Costume = "cap" | "hat";

export function costumeOf(season: SeasonName | null): Costume | null {
  return season === "christmas" ? "cap" : season === "halloween" ? "hat" : null;
}

/** [x, y, degrees, scale] on the mark's own 331 × 438 box: over 30 px, and at header sizes (30 px and under). */
const ON_MARK: Record<Costume, { large: [number, number, number, string]; small: [number, number, number, string] }> = {
  // On the "5"'s stem, tipped back, the pompom hanging left.
  cap: { large: [150, 22, -22, "1.1"], small: [150, 26, -22, "1.45"] },
  // On the "5"'s top bar, tipped back, its tip flopping left.
  hat: { large: [150, 30, -12, "1.18"], small: [150, 38, -12, "1.6"] },
};

/** [x, y, degrees, scale] on Doh's 200 × 200 box: over the crown, tipped back so the note-crest still shows. */
const ON_DOH: Record<Costume, [number, number, number, string]> = {
  cap: [84, 60, -18, ".46"],
  hat: [90, 62, -14, ".5"],
};

/**
 * Where a costume sits on the brand mark's 331 × 438 box. At header sizes (30 px and under) it is drawn larger so it
 * still reads as a cap or a hat.
 */
export function costumeOnMark(costume: Costume, height: number): string {
  const [x, y, deg, scale] = ON_MARK[costume][height <= 30 ? "small" : "large"];
  return `translate(${x} ${y}) rotate(${deg}) scale(${scale})`;
}

/** The brim's middle on a mark `height` px tall, in px from its top left: the drop's wobble turns about it. */
export function brimOnMark(costume: Costume, height: number): [number, number] {
  const [x, y] = ON_MARK[costume][height <= 30 ? "small" : "large"];
  const s = height / 438;
  return [x * s, y * s];
}

/** Where a costume sits on Doh: higher when he jumps (the cheer poses). */
export function costumeOnDoh(costume: Costume, pose: string): string {
  const [x, y, deg, scale] = ON_DOH[costume];
  const lift = pose.startsWith("doh-cheer") ? 8 : 0;
  return `translate(${x} ${y - lift}) rotate(${deg}) scale(${scale})`;
}

/** The cap on the mark (Christmas). */
export function capOnMark(height: number): string {
  return costumeOnMark("cap", height);
}

/** The cap on Doh (Christmas). */
export function capOnDoh(pose: string): string {
  return costumeOnDoh("cap", pose);
}

/** The witch hat on the mark (Halloween). */
export function hatOnMark(height: number): string {
  return costumeOnMark("hat", height);
}

/** The witch hat on Doh (Halloween). */
export function hatOnDoh(pose: string): string {
  return costumeOnDoh("hat", pose);
}

// ── The tunes, on the app's own piano an octave up (no audio file) ──

/** Joy to the World's tempo: crotchet = 120, so the opening lasts about 1.7 s and the line about 3.7 s. */
export const CHIME_BPM = 120;
/** The Mountain King's: crotchet = 150, so the opening's seven notes last about 1.6 s and the first phrase about 3 s. */
export const KING_BPM = 150;
/** The Mountain King tiptoes: each note sounds this share of its written length, short and detached like the bassoons. */
export const DETACHED = 0.6;

const note = (pitchMidi: number, startBeat: number, durBeats: number, solfa: string, octaveMark = ""): NoteEvent =>
  ({ pitchMidi, startBeat, durBeats, degree: 1, solfa, octaveMark, conf: 1 });

/** "Joy to the world, the Lord is come!": d' t l s f m r d, every syllable in order from doh down to doh. */
export const JOY_LINE: readonly NoteEvent[] = Object.freeze([
  note(86, 0, 1, "d", "'"),
  note(85, 1, 0.75, "t"),
  note(83, 1.75, 0.25, "l"),
  note(81, 2, 1.5, "s"),
  note(79, 3.5, 0.5, "f"),
  note(78, 4, 1, "m"),
  note(76, 5, 1, "r"),
  note(74, 6, 1.5, "d"),
]);

/** The Christmas splash's chime: the first four notes, "Joy to the world" (d' t l s). */
export const JOY_OPENING: readonly NoteEvent[] = Object.freeze(JOY_LINE.slice(0, 4));

/** Notes one after another from written lengths in beats, each sounding `DETACHED` of its length. */
function detached(steps: readonly [number, number, string, string?][]): NoteEvent[] {
  let at = 0;
  return steps.map(([pitch, beats, solfa, mark]) => {
    const n = note(pitch, at, Math.round(beats * DETACHED * 1000) / 1000, solfa, mark ?? "");
    at += beats;
    return n;
  });
}

/**
 * Grieg's "In the Hall of the Mountain King" (B minor, la-based: doh D), its opening seven notes l, t, d r m d m:
 * quavers and a crotchet, B4 C♯5 D5 E5 F♯5 D5 F♯5, an octave above the tune. The Halloween splash's chime, and the
 * Night Singer's phrase when the hymn pack does not have the tune.
 */
export const KING_OPENING: readonly NoteEvent[] = Object.freeze(
  detached([
    [71, 0.5, "l", ","],
    [73, 0.5, "t", ","],
    [74, 0.5, "d"],
    [76, 0.5, "r"],
    [78, 0.5, "m"],
    [74, 0.5, "d"],
    [78, 1, "m"],
  ]),
);

/** How many notes make the Mountain King's first phrase: l, t, d r m d m · ma t, ma · r ta, r. */
export const KING_PHRASE_NOTES = 13;

/**
 * The Night Singer's phrase from the Mountain King as the hymn pack publishes it, labelled by the solfa engine: its
 * first phrase from its first note, moved by whole octaves to sit where the chime does and played detached. Fewer
 * notes than the opening (no pack, or no such tune): the opening itself.
 */
export function kingPhrase(labelled: readonly NoteEvent[] | null | undefined): NoteEvent[] {
  const sorted = [...(labelled ?? [])].sort((a, b) => a.startBeat - b.startBeat);
  if (sorted.length < KING_OPENING.length) return KING_OPENING.map((n) => ({ ...n }));
  const phrase = sorted.slice(0, KING_PHRASE_NOTES);
  const first = phrase[0]!;
  const shift = 12 * Math.round((KING_OPENING[0]!.pitchMidi - first.pitchMidi) / 12);
  return phrase.map((n, i) => {
    const next = phrase[i + 1];
    const written = next ? next.startBeat - n.startBeat : n.durBeats;
    return {
      ...n,
      pitchMidi: n.pitchMidi + shift,
      startBeat: Math.round((n.startBeat - first.startBeat) * 1000) / 1000,
      durBeats: Math.round(Math.min(n.durBeats, written) * DETACHED * 1000) / 1000,
    };
  });
}

/** The line as the screens print it: "d' t l s f m r d". */
export function solfaLine(notes: readonly NoteEvent[]): string {
  return notes.map((n) => n.solfa + n.octaveMark).join(" ");
}

/**
 * A phrase as the sticker prints it, a dot after each figure that ends on a longer note: "l, t, d r m d m · ma t, ma ·
 * r ta, r".
 */
export function phraseLine(notes: readonly NoteEvent[]): string {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat);
  const length = (i: number) => sorted[i + 1]!.startBeat - sorted[i]!.startBeat;
  let out = "";
  sorted.forEach((n, i) => {
    if (i > 0) out += i >= 2 && length(i - 1) > length(i - 2) + 1e-9 ? " · " : " ";
    out += n.solfa + n.octaveMark;
  });
  return out;
}

/** How long a chime sounds, its ring included. */
export function chimeSeconds(notes: readonly NoteEvent[], tempoBpm = CHIME_BPM): number {
  const end = notes.reduce((m, n) => Math.max(m, n.startBeat + n.durBeats), 0);
  return end * (60 / tempoBpm) + 0.6;
}

export interface SeasonTune {
  notes: readonly NoteEvent[];
  bpm: number;
}

/** The splash's chime as the season's costume lands. */
export function seasonChime(season: SeasonName): SeasonTune {
  return season === "halloween" ? { notes: KING_OPENING, bpm: KING_BPM } : { notes: JOY_OPENING, bpm: CHIME_BPM };
}

// ── Snow: a few slow flakes that fall for a few seconds and stop (never a loop) ──

export const SNOW = Object.freeze({
  /** About fourteen in all: twelve soft dots and two six-armed flakes. */
  dots: 12,
  glyphs: 2,
  minSize: 2,
  maxSize: 5,
  glyphMin: 9,
  glyphMax: 12,
  minOpacity: 0.3,
  maxOpacity: 0.6,
  /** px a second. */
  minSpeed: 40,
  maxSpeed: 70,
  /** px either side, one slow swing per fall. */
  sway: 8,
  /** No new flake starts after this (s)… */
  lastStart: 3,
  /** …and every one has gone by this (s). */
  allGone: 6,
});

export interface Flake {
  /** Across the box, 0 to 1. */
  x: number;
  /** Where it appears, px from the top of the box (a little above it for some). */
  y: number;
  /** px across; a glyph is a six-armed flake, else a soft dot. */
  size: number;
  glyph: boolean;
  opacity: number;
  /** px a second. */
  speed: number;
  /** px either side. */
  sway: number;
  /** Seconds before it appears. */
  delay: number;
  /** Seconds it falls for: it has faded out at `delay + duration`, never later than `allGone`. */
  duration: number;
}

/** A seeded generator (Park–Miller), so a screen draws the same sky every time. */
export function seeded(seed: number): () => number {
  let s = Math.abs(Math.floor(seed)) % 2147483647 || 11;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** The flakes for a box `height` px tall: when each appears, how big, how bright, how fast. */
export function snowPlan(seed: number, height: number): Flake[] {
  const r = seeded(seed);
  const between = (a: number, b: number) => a + r() * (b - a);
  const out: Flake[] = [];
  const total = SNOW.dots + SNOW.glyphs;
  for (let i = 0; i < total; i++) {
    const glyph = i >= SNOW.dots;
    const delay = Math.round(between(0, SNOW.lastStart) * 100) / 100;
    out.push({
      x: Math.round(between(0.03, 0.97) * 1000) / 1000,
      y: Math.round(between(-0.08, 0.45) * Math.max(0, height)),
      size: Math.round((glyph ? between(SNOW.glyphMin, SNOW.glyphMax) : between(SNOW.minSize, SNOW.maxSize)) * 10) / 10,
      glyph,
      opacity: Math.round(between(SNOW.minOpacity, SNOW.maxOpacity) * 100) / 100,
      speed: Math.round(between(SNOW.minSpeed, SNOW.maxSpeed)),
      sway: SNOW.sway,
      delay,
      duration: Math.round((SNOW.allGone - delay) * 100) / 100,
    });
  }
  return out;
}

// ── Bats: a few silhouettes that flit across the top third and leave (never a loop) ──

export const BATS = Object.freeze({
  /** Eight in all, 18–34 px across, 30–50% (pale on Night, slate on Day). */
  count: 8,
  minSize: 18,
  maxSize: 34,
  minOpacity: 0.3,
  maxOpacity: 0.5,
  /** Each crosses in a 2–3 s arc… */
  minFlight: 2,
  maxFlight: 3,
  /** …rising or dipping up to this far (px) on the way. */
  arc: 24,
  /** Wing beats a second: two frames, open and folded. */
  flapsPerSecond: 5,
  /** No new bat after this (s)… */
  lastStart: 3,
  /** …and every one has gone by this (s). */
  allGone: 6,
});

export interface Bat {
  /** Where it flies across, px from the top of the box. */
  y: number;
  /** px across (its height is half that). */
  size: number;
  opacity: number;
  /** 1 crosses left to right, -1 right to left. */
  dir: 1 | -1;
  /** px it rises (negative) or dips at the middle of its flight. */
  rise: number;
  /** Degrees it leans as it flies. */
  tilt: number;
  /** Seconds before it appears. */
  delay: number;
  /** Seconds the crossing takes: it has left at `delay + duration`, never later than `allGone`. */
  duration: number;
  /** Wing beats over the crossing. */
  flaps: number;
}

/** The bats for a box `height` px tall: where each crosses, how big, how bright, when and how fast. */
export function batPlan(seed: number, height: number): Bat[] {
  const r = seeded(seed);
  const between = (a: number, b: number) => a + r() * (b - a);
  const out: Bat[] = [];
  for (let i = 0; i < BATS.count; i++) {
    const delay = Math.round(between(0, BATS.lastStart) * 100) / 100;
    const duration = Math.round(Math.min(between(BATS.minFlight, BATS.maxFlight), BATS.allGone - delay) * 100) / 100;
    out.push({
      y: Math.round(between(0.06, 0.8) * Math.max(0, height)),
      size: Math.round(between(BATS.minSize, BATS.maxSize) * 10) / 10,
      opacity: Math.round(between(BATS.minOpacity, BATS.maxOpacity) * 100) / 100,
      dir: r() < 0.5 ? 1 : -1,
      rise: Math.round(between(-BATS.arc, BATS.arc * 0.5)),
      tilt: Math.round(between(-12, 12)),
      delay,
      duration,
      flaps: Math.max(4, Math.round(duration * BATS.flapsPerSecond)),
    });
  }
  return out;
}

// ── The season's words ──

interface SeasonWords {
  /** "Christmas". */
  name: string;
  /** Home's chip: "Carols", and its spoken label. */
  chip: string;
  chipLabel: string;
  /** Hymns' shelf: "Carols for Christmas". */
  shelf: string;
  /** The chip's and the shelf's glyph. */
  icon: IconName;
  /** The Practice card's line under its title. */
  cardBody: string;
  /** The path screen's title. */
  pathTitle: string;
  /** The sticker the path earns. */
  sticker: string;
  /** The sticker sheet's line. */
  stickerBody: string;
  /** Doh's line once every drill is sung. */
  allSungLine: string;
  /** When the path cannot be had: off for the season, or not loaded. */
  away: string;
  failed: string;
  playFailed: string;
  /** The open drill's way on once it is passed. */
  nextLabel: string;
  /** Analytics names: the card's tap, a drill started and marked. */
  opened: string;
  started: string;
  marked: string;
}

const WORDS: Record<SeasonName, SeasonWords> = {
  christmas: {
    name: "Christmas",
    chip: "Carols",
    chipLabel: "Carols for Christmas",
    shelf: "Carols for Christmas",
    icon: "snow",
    cardBody: "Six short drills from carols we hold: a Gloria warm-up, Silent Night in thirds, and more.",
    pathTitle: "Carols",
    sticker: "Carol singer",
    stickerBody: "You sang all six carols. This sticker stays in your book after Christmas.",
    allSungLine: "You sang all six carols. Merry Christmas!",
    away: "The carols are put away until next Christmas.",
    failed: "The carols didn't load.",
    playFailed: "Could not play the carol. Please try again.",
    nextLabel: "Next carol",
    opened: "carols_opened",
    started: "carol_started",
    marked: "carol_marked",
  },
  halloween: {
    name: "Halloween",
    chip: "Spooky songs",
    chipLabel: "Songs for Halloween",
    shelf: "Songs for Halloween",
    icon: "ghost",
    cardBody:
      "Six short drills from spooky songs: the Mountain King's tiptoe, Bach's organ turn, a ghostly round, and All Saints to finish.",
    pathTitle: "The Midnight path",
    sticker: "Night Singer",
    stickerBody: "You sang all six on the Midnight path. This sticker stays in your book after Halloween.",
    allSungLine: "You sang all six on the Midnight path. Happy Halloween!",
    away: "The Midnight path is back next Halloween.",
    failed: "The Midnight path didn't load.",
    playFailed: "Could not play the tune. Please try again.",
    nextLabel: "Next drill",
    opened: "midnight_opened",
    started: "midnight_started",
    marked: "midnight_marked",
  },
};

export function seasonWords(season: SeasonName): Readonly<SeasonWords> {
  return WORDS[season];
}

/** The season's tint: a wash, a hairline and its small labels (pine and candle; pumpkin and moon). Never an accent. */
export function seasonTint(c: Palette, season: SeasonName): { soft: string; line: string; label: string } {
  return season === "halloween"
    ? { soft: c.pumpkinSoft, line: c.pumpkinLine, label: c.moon }
    : { soft: c.pineSoft, line: c.pineLine, label: c.candle };
}

/** Home's question. */
export function homeTitle(season: SeasonFlag): string {
  const on = activeSeason(season);
  return on ? `What are we singing this ${WORDS[on].name}?` : "What are we singing today?";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Until 6 January" from the path's last day (yyyy-mm-dd); null when it runs until switched off. */
export function untilLabel(until: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(until ?? "");
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `Until ${Number(m[3])} ${month}` : null;
}

// ── The season's path: the carols (board d-christmas/03), the Midnight path (board j-halloween/03) ──

/** The Practice hub's season card (pine at Christmas, pumpkin at Halloween). */
export interface SeasonCard {
  season: SeasonName;
  eyebrow: string;
  title: string;
  body: string;
  /** One per drill: sung (passed) or not. */
  segments: boolean[];
  sung: string;
  /** "Next: Silent Night, in thirds", or the line once every one is sung. */
  next: string;
  action: string;
  label: string;
}

export function seasonCard(s: PracticeSeason): SeasonCard {
  const season = seasonOf(s.season);
  const words = WORDS[season];
  const until = untilLabel(s.until);
  const done = s.next == null;
  // The Midnight path names its first drill as the first; the carols always said "Next".
  const lead = season === "halloween" && s.sung === 0 ? "First" : "Next";
  return {
    season,
    eyebrow: until ? `${words.name} · ${until}` : words.name,
    title: s.title,
    body: words.cardBody,
    segments: s.steps.map((st) => st.passed),
    sung: `${s.sung} of ${s.total} sung`,
    next: done ? `All sung. The ${words.sticker} sticker is yours.` : `${lead}: ${s.next!.cue}`,
    action: done ? "Sing again" : s.sung === 0 ? "Start" : "Continue",
    label: `${s.title}: ${s.sung} of ${s.total} sung.${done ? "" : ` ${lead}: ${s.next!.cue}.`}`,
  };
}

export type SeasonRowState = "done" | "open" | "todo";

export interface SeasonRow {
  index: number;
  title: string;
  /** "Angels We Have Heard on High · one breath". */
  line: string;
  state: SeasonRowState;
  bestScore: number | null;
}

export interface SeasonView {
  season: SeasonName;
  /** "Christmas · 2 of 6". */
  eyebrow: string;
  rows: SeasonRow[];
  /** The step open for singing: the one chosen, else the next not yet passed, else the last. */
  open: number;
  allSung: boolean;
}

/** The path as its screen draws it, `chosen` the step the singer tapped (null: the next one). */
export function seasonView(s: PracticeSeason, chosen: number | null = null): SeasonView {
  const season = seasonOf(s.season);
  const indexes = s.steps.map((st) => st.index);
  const fallback = s.next?.index ?? indexes[indexes.length - 1] ?? 1;
  const open = chosen != null && indexes.includes(chosen) ? chosen : fallback;
  return {
    season,
    eyebrow: `${WORDS[season].name} · ${s.sung} of ${s.total}`,
    rows: s.steps.map((st) => ({
      index: st.index,
      title: st.title,
      line: `${st.carol} · ${st.detail}`,
      state: st.index === open ? "open" : st.passed ? "done" : "todo",
      bestScore: st.bestScore,
    })),
    open,
    allSung: s.next == null,
  };
}

const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Doh's word over the Midnight path (Playful), by the song the next drill comes from. */
function midnightLine(next: NonNullable<PracticeSeason["next"]>): string {
  const song = fold(next.carol);
  if (song.includes("mountain king")) return "Shh, tiptoe with me: the Mountain King's run, soft and short.";
  if (song.includes("toccata")) return "A perfect tiptoe! Now the organ's turn: m r m, quick as a wink.";
  if (song.includes("ghost of john")) return "Boo sings the first line of the round. You come in at the second!";
  if (song.includes("bones")) return "Now climb Dem Bones, one little semitone at a time.";
  if (song.includes("marionette")) return "Tiptoe like a puppet: the Marionette's march.";
  if (song.includes("all saints")) return "Last one, for All Saints' Day: sing it from the top doh down.";
  return `Next: ${next.cue}. Boo and I are listening!`;
}

/** Doh's word over the path (Playful), for the step that is next. */
export function seasonBuddyLine(s: PracticeSeason): string {
  const season = seasonOf(s.season);
  if (!s.next) return WORDS[season].allSungLine;
  if (season === "halloween") return midnightLine(s.next);
  switch (s.next.index) {
    case 1:
      return "A Gloria to warm up: can you sing it all in one breath?";
    case 2:
      return "Lovely Gloria! Now Joy to the World, all the way down.";
    case 3:
      return "Joyful! Now sing under the tune, like the altos do.";
    case 4:
      return "Now sing Silent Night along with the words.";
    case 5:
      return "Hark! Leap up from low soh to doh.";
    default:
      return `Last one: ${s.next.title.toLowerCase()} with ${s.next.carol}.`;
  }
}

/** Whether a take just earned the season's sticker (its code among the reward's new badges). */
export function earnedSeasonBadge(newBadges: readonly { code: string }[] | null | undefined, badgeCode: string): boolean {
  return !!newBadges?.some((b) => b.code === badgeCode);
}

/** The sticker sheet's line, as it prints: the whole carol line, or the Mountain King's phrase with its figures. */
export function stickerLine(season: SeasonName, notes: readonly NoteEvent[]): string {
  return season === "halloween" ? phraseLine(notes) : solfaLine(notes);
}
