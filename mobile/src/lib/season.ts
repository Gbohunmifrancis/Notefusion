/**
 * The Christmas season on the phone (board d-christmas), the pure half: the flag as the phone keeps it, which splash
 * a launch plays, once-a-season, the snow, the chime's notes, the season's words and the carols path as the screens
 * draw it. `seasonStore` reads and keeps the flag, `seasonChime` plays the carol.
 *
 * One switch decides it all: the admin console's, read at `GET /api/app/season` (`{ christmas }`) at startup and
 * whenever the app comes forward, and kept per device so the splash can dress before the network answers. With the
 * flag off every screen is exactly as it was; nothing here carries a date of its own.
 */

import type { NoteEvent, PracticeSeason } from "../api/types";

/** Where the phone keeps the last answer (AsyncStorage), so the next launch's splash knows it at once. */
export const SEASON_CACHE_KEY = "nf.season";
/** The season whose splash intro (the cap's drop and the chime) this phone has had: once a season. */
export const SEASON_INTRO_KEY = "nf.seasonIntro";

export interface SeasonFlag {
  christmas: boolean;
}

export const NO_SEASON: SeasonFlag = Object.freeze({ christmas: false });

/** The kept answer, or no season when there is none or it cannot be read (the default is always off). */
export function parseSeason(text: string | null | undefined): SeasonFlag {
  if (!text) return NO_SEASON;
  try {
    const x = JSON.parse(text) as Partial<SeasonFlag> | null;
    return x && x.christmas === true ? { christmas: true } : NO_SEASON;
  } catch {
    return NO_SEASON;
  }
}

/** The server's answer as the phone keeps it: only `true` turns the season on. */
export function seasonFrom(answer: unknown): SeasonFlag {
  return answer && typeof answer === "object" && (answer as { christmas?: unknown }).christmas === true
    ? { christmas: true }
    : NO_SEASON;
}

export function serializeSeason(s: SeasonFlag): string {
  return JSON.stringify({ christmas: s.christmas });
}

/**
 * A Christmas season's own name: the year it starts in. December 2026 and the first days of January 2027 are both
 * "christmas-2026", so the intro plays once across the turn of the year and again the next December.
 */
export function seasonKey(now: Date): string {
  const year = now.getFullYear();
  return `christmas-${now.getMonth() >= 6 ? year : year - 1}`;
}

/**
 * What the splash wears on this launch: nothing (the season is off, or the phone has never heard it is on), the
 * season's intro (once a season: the full four beats, the cap dropping onto the mark, a little snow and the chime),
 * or just the cap (every launch after that).
 */
export type SplashSeason = "none" | "intro" | "capped";

export function splashSeason(cached: SeasonFlag, lastIntro: string | null, now: Date): SplashSeason {
  if (!cached.christmas) return "none";
  return lastIntro === seasonKey(now) ? "capped" : "intro";
}

// ── The cap (design/practice-art/season.mjs: its brim's middle at (100, 125) of a 200 × 150 box) ──

/**
 * Where the cap sits on the brand mark's own 331 × 438 box: on the "5"'s stem, tipped back, the pompom hanging left.
 * At header sizes (30 px and under) it is drawn a third larger so it still reads as a cap.
 */
export function capOnMark(height: number): string {
  return height <= 30 ? "translate(150 26) rotate(-22) scale(1.45)" : "translate(150 22) rotate(-22) scale(1.1)";
}

/** Where it sits on Doh's 200 × 200 box: over the crown, tipped back so the note-crest still shows; higher when he jumps. */
export function capOnDoh(pose: string): string {
  const lift = pose.startsWith("doh-cheer") ? 8 : 0;
  return `translate(84 ${60 - lift}) rotate(-18) scale(.46)`;
}

// ── The carol: Joy to the World (ANTIOCH), doh D, an octave up so the piano rings like a celesta ──

/** The chime's tempo: crotchet = 120, so the opening lasts about 1.7 s and the line about 3.7 s. */
export const CHIME_BPM = 120;

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

/** The splash's chime: the first four notes, "Joy to the world" (d' t l s). */
export const JOY_OPENING: readonly NoteEvent[] = Object.freeze(JOY_LINE.slice(0, 4));

/** The line as the screens print it: "d' t l s f m r d". */
export function solfaLine(notes: readonly NoteEvent[]): string {
  return notes.map((n) => n.solfa + n.octaveMark).join(" ");
}

/** How long a chime sounds, its ring included. */
export function chimeSeconds(notes: readonly NoteEvent[], tempoBpm = CHIME_BPM): number {
  const end = notes.reduce((m, n) => Math.max(m, n.startBeat + n.durBeats), 0);
  return end * (60 / tempoBpm) + 0.6;
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

// ── The season's words ──

/** Home's question. */
export function homeTitle(season: SeasonFlag): string {
  return season.christmas ? "What are we singing this Christmas?" : "What are we singing today?";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Until 6 January" from the path's last day (yyyy-mm-dd); null when it runs until switched off. */
export function untilLabel(until: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(until ?? "");
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `Until ${Number(m[3])} ${month}` : null;
}

// ── The carols path (board d-christmas/03) ──

/** The Practice hub's pine card. */
export interface CarolsCard {
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

export function carolsCard(s: PracticeSeason): CarolsCard {
  const until = untilLabel(s.until);
  const done = s.next == null;
  return {
    eyebrow: until ? `Christmas · ${until}` : "Christmas",
    title: s.title,
    body: "Six short drills from carols we hold: a Gloria warm-up, Silent Night in thirds, and more.",
    segments: s.steps.map((st) => st.passed),
    sung: `${s.sung} of ${s.total} sung`,
    next: done ? "All sung. The Carol singer sticker is yours." : `Next: ${s.next!.cue}`,
    action: done ? "Sing again" : s.sung === 0 ? "Start" : "Continue",
    label: `${s.title}: ${s.sung} of ${s.total} sung.${done ? "" : ` Next: ${s.next!.cue}.`}`,
  };
}

export type CarolRowState = "done" | "open" | "todo";

export interface CarolRow {
  index: number;
  title: string;
  /** "Angels We Have Heard on High · one breath". */
  line: string;
  state: CarolRowState;
  bestScore: number | null;
}

export interface CarolsView {
  /** "Christmas · 2 of 6". */
  eyebrow: string;
  rows: CarolRow[];
  /** The step open for singing: the one chosen, else the next not yet passed, else the last. */
  open: number;
  allSung: boolean;
}

/** The path as its screen draws it, `chosen` the step the singer tapped (null: the next one). */
export function carolsView(s: PracticeSeason, chosen: number | null = null): CarolsView {
  const indexes = s.steps.map((st) => st.index);
  const fallback = s.next?.index ?? indexes[indexes.length - 1] ?? 1;
  const open = chosen != null && indexes.includes(chosen) ? chosen : fallback;
  return {
    eyebrow: `Christmas · ${s.sung} of ${s.total}`,
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

/** Doh's word over the carols path (Playful), for the step that is next. */
export function carolsBuddyLine(s: PracticeSeason): string {
  if (!s.next) return "You sang all six carols. Merry Christmas!";
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

/** Whether a take just earned the Carol singer sticker (its code among the reward's new badges). */
export function earnedCarolSinger(newBadges: readonly { code: string }[] | null | undefined, badgeCode = "carol_singer"): boolean {
  return !!newBadges?.some((b) => b.code === badgeCode);
}
