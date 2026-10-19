import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BATS,
  JOY_LINE,
  JOY_OPENING,
  KING_BPM,
  KING_OPENING,
  KING_PHRASE_NOTES,
  NO_SEASON,
  SEASON_INTRO_KEY,
  SNOW,
  activeSeason,
  batPlan,
  brimOnMark,
  capOnDoh,
  capOnMark,
  chimeSeconds,
  costumeOf,
  earnedSeasonBadge,
  hatOnDoh,
  hatOnMark,
  homeTitle,
  kingPhrase,
  parseSeason,
  phraseLine,
  seasonBuddyLine,
  seasonCard,
  seasonChime,
  seasonFrom,
  seasonIntroKey,
  seasonKey,
  seasonView,
  seasonWords,
  serializeSeason,
  snowPlan,
  solfaLine,
  splashSeason,
  stickerLine,
  untilLabel,
} from "./season.ts";
import type { CarolStep, NoteEvent, PracticeSeason } from "../api/types";

const ON = { christmas: true, halloween: false };
const HALLOWEEN = { christmas: false, halloween: true };

test("the flag as the phone keeps it: only an answer of true turns the season on, anything else is off", () => {
  assert.deepEqual(seasonFrom({ christmas: true }), ON);
  assert.deepEqual(seasonFrom({ christmas: false }), NO_SEASON);
  assert.deepEqual(seasonFrom({ christmas: "true" }), NO_SEASON);
  assert.deepEqual(seasonFrom(null), NO_SEASON);
  assert.deepEqual(seasonFrom("<html>"), NO_SEASON);
  assert.deepEqual(parseSeason(serializeSeason(ON)), ON);
  assert.deepEqual(parseSeason(serializeSeason(NO_SEASON)), NO_SEASON);
  assert.deepEqual(parseSeason(null), NO_SEASON);
  assert.deepEqual(parseSeason("{not json"), NO_SEASON);
  assert.deepEqual(parseSeason("null"), NO_SEASON);
});

test("a season is named by the year it starts in, so December and early January are one season", () => {
  assert.equal(seasonKey(new Date(2026, 11, 1)), "christmas-2026");
  assert.equal(seasonKey(new Date(2026, 11, 31, 23, 59)), "christmas-2026");
  assert.equal(seasonKey(new Date(2027, 0, 6)), "christmas-2026");
  assert.equal(seasonKey(new Date(2027, 10, 30)), "christmas-2027");
});

test("the splash: as today with the season off; the intro once a season; the cap alone after that", () => {
  const dec = new Date(2026, 11, 12);
  assert.equal(splashSeason(NO_SEASON, null, dec), "none");
  assert.equal(splashSeason(NO_SEASON, "christmas-2026", dec), "none");
  assert.equal(splashSeason(ON, null, dec), "intro");
  assert.equal(splashSeason(ON, "christmas-2026", dec), "dressed");
  assert.equal(splashSeason(ON, "christmas-2026", new Date(2027, 0, 3)), "dressed");
  // the next December plays it again
  assert.equal(splashSeason(ON, "christmas-2026", new Date(2027, 11, 2)), "intro");
});

test("the chime is Joy to the World: d' t l s on the splash, the whole line for the sticker", () => {
  assert.equal(solfaLine(JOY_OPENING), "d' t l s");
  assert.equal(solfaLine(JOY_LINE), "d' t l s f m r d");
  // a falling D major scale an octave above the carol's own D5, every note a semitone or tone below the last
  assert.deepEqual(JOY_LINE.map((n) => n.pitchMidi), [86, 85, 83, 81, 79, 78, 76, 74]);
  // crotchet, dotted quaver, semiquaver, dotted crotchet at 120: about 1.7 s, and the line under 4 s
  assert.deepEqual(JOY_OPENING.map((n) => n.durBeats), [1, 0.75, 0.25, 1.5]);
  assert.ok(Math.abs(chimeSeconds(JOY_OPENING) - 0.6 - 1.75) < 1e-9);
  assert.ok(chimeSeconds(JOY_LINE) < 4.5);
  for (let i = 1; i < JOY_LINE.length; i++) {
    const a = JOY_LINE[i - 1]!, b = JOY_LINE[i]!;
    assert.equal(b.startBeat, a.startBeat + a.durBeats, `note ${i} follows the one before`);
  }
});

test("snow: about fourteen slow flakes, 2–5 px and 30–60% white, none after 3 s, all gone by 6 s", () => {
  const plan = snowPlan(7, 280);
  assert.equal(plan.length, 14);
  assert.equal(plan.filter((f) => f.glyph).length, 2);
  for (const f of plan) {
    if (!f.glyph) assert.ok(f.size >= SNOW.minSize && f.size <= SNOW.maxSize, `dot ${f.size}`);
    else assert.ok(f.size >= SNOW.glyphMin && f.size <= SNOW.glyphMax, `glyph ${f.size}`);
    assert.ok(f.opacity >= 0.3 && f.opacity <= 0.6, `opacity ${f.opacity}`);
    assert.ok(f.speed >= 40 && f.speed <= 70, `speed ${f.speed}`);
    assert.equal(f.sway, 8);
    assert.ok(f.delay >= 0 && f.delay <= 3, `delay ${f.delay}`);
    assert.ok(f.delay + f.duration <= 6 + 1e-9, "gone by 6 s");
    assert.ok(f.x > 0 && f.x < 1);
    assert.ok(f.y >= -0.08 * 280 - 1 && f.y <= 0.45 * 280 + 1);
  }
  // seeded: the same sky every time, another seed another sky
  assert.deepEqual(snowPlan(7, 280), plan);
  assert.notDeepEqual(snowPlan(8, 280), plan);
});

test("the cap: a third larger on a header-sized mark, higher on Doh when he jumps", () => {
  assert.equal(capOnMark(132), "translate(150 22) rotate(-22) scale(1.1)");
  assert.equal(capOnMark(24), "translate(150 26) rotate(-22) scale(1.45)");
  assert.match(capOnMark(24), /scale\(1\.45\)/);
  assert.match(capOnMark(30), /scale\(1\.45\)/);
  assert.match(capOnMark(132), /scale\(1\.1\)/);
  assert.equal(capOnDoh("doh-wave"), "translate(84 60) rotate(-18) scale(.46)");
  assert.equal(capOnDoh("doh-cheer"), "translate(84 52) rotate(-18) scale(.46)");
});

test("the season's words: Home's question and the path's last day", () => {
  assert.equal(homeTitle(NO_SEASON), "What are we singing today?");
  assert.equal(homeTitle(ON), "What are we singing this Christmas?");
  assert.equal(untilLabel("2027-01-06"), "Until 6 January");
  assert.equal(untilLabel("2026-12-31"), "Until 31 December");
  assert.equal(untilLabel(null), null);
  assert.equal(untilLabel("6 Jan"), null);
});

const step = (index: number, title: string, carol: string, cue: string, detail: string, passed: boolean, bestScore: number | null = null): CarolStep =>
  ({ index, id: `carol-${index}@60`, title, carol, hymnSlug: "x", cue, detail, passed, bestScore });
const STEPS = (passed: number): CarolStep[] => [
  step(1, "Gloria warm-up", "Angels We Have Heard on High", "the Gloria warm-up", "one breath", passed >= 1, passed >= 1 ? 92 : null),
  step(2, "All the way down", "Joy to the World", "Joy to the World, all the way down", "d' t l s f m r d", passed >= 2, passed >= 2 ? 84 : null),
  step(3, "Sing in thirds", "Silent Night", "Silent Night, in thirds", "Doh is Bb · 4 notes", passed >= 3),
  step(4, "Sing along", "Silent Night", "Silent Night, sing along", "the first verse, with the words", passed >= 4),
  step(5, "Leap up to doh", "Hark! The Herald Angels Sing", "Hark! The Herald Angels Sing, leap up to doh", "s, d d t, d", passed >= 5),
  step(6, "Step up to soh", "The First Noel", "The First Noel, step up to soh", "m r d r m f s", passed >= 6),
];
const season = (passed: number): PracticeSeason => {
  const steps = STEPS(passed);
  return { season: "christmas", title: "Carols for Christmas", until: "2027-01-06", sung: passed, total: 6, next: steps.find((s) => !s.passed) ?? null, steps, badgeCode: "carol_singer" };
};

test("the hub's pine card: until when, six segments, how many sung and what is next", () => {
  const c = seasonCard(season(2));
  assert.equal(c.season, "christmas");
  assert.equal(c.eyebrow, "Christmas · Until 6 January");
  assert.equal(c.title, "Carols for Christmas");
  assert.deepEqual(c.segments, [true, true, false, false, false, false]);
  assert.equal(c.sung, "2 of 6 sung");
  assert.equal(c.next, "Next: Silent Night, in thirds");
  assert.equal(c.action, "Continue");
  assert.equal(seasonCard(season(0)).action, "Start");
  // the carols always said "Next", from the first drill on
  assert.equal(seasonCard(season(0)).next, "Next: the Gloria warm-up");
  const done = seasonCard(season(6));
  assert.equal(done.action, "Sing again");
  assert.equal(done.next, "All sung. The Carol singer sticker is yours.");
  assert.equal(seasonCard({ ...season(1), until: null }).eyebrow, "Christmas");
});

test("the carols path: the next drill open, the sung ones done, any one can be chosen again", () => {
  const v = seasonView(season(2));
  assert.equal(v.eyebrow, "Christmas · 2 of 6");
  assert.equal(v.open, 3);
  assert.deepEqual(v.rows.map((r) => r.state), ["done", "done", "open", "todo", "todo", "todo"]);
  assert.equal(v.rows[0]!.line, "Angels We Have Heard on High · one breath");
  assert.equal(v.rows[0]!.bestScore, 92);
  assert.equal(v.allSung, false);
  const again = seasonView(season(2), 1);
  assert.equal(again.open, 1);
  assert.deepEqual(again.rows.map((r) => r.state), ["open", "done", "todo", "todo", "todo", "todo"]);
  // a step that is not on the path falls back to the next one
  assert.equal(seasonView(season(2), 9).open, 3);
  const all = seasonView(season(6));
  assert.equal(all.allSung, true);
  assert.equal(all.open, 6);
});

test("Doh's word over the path follows the next drill, and the sticker is told by its code", () => {
  assert.equal(seasonBuddyLine(season(2)), "Joyful! Now sing under the tune, like the altos do.");
  assert.equal(seasonBuddyLine(season(5)), "Last one: step up to soh with The First Noel.");
  assert.equal(seasonBuddyLine(season(6)), "You sang all six carols. Merry Christmas!");
  assert.equal(earnedSeasonBadge([{ code: "streak_3" }, { code: "carol_singer" }], "carol_singer"), true);
  assert.equal(earnedSeasonBadge([{ code: "streak_3" }], "carol_singer"), false);
  assert.equal(earnedSeasonBadge(null, "carol_singer"), false);
});

// ── Halloween (board j-halloween) ──

test("one season at a time: Halloween is kept and read back, and Christmas wins if both ever say true", () => {
  assert.deepEqual(seasonFrom({ christmas: false, halloween: true }), HALLOWEEN);
  assert.deepEqual(seasonFrom({ halloween: true }), HALLOWEEN);
  assert.deepEqual(seasonFrom({ christmas: true, halloween: true }), ON);
  assert.deepEqual(seasonFrom({ halloween: "true" }), NO_SEASON);
  assert.deepEqual(parseSeason(serializeSeason(HALLOWEEN)), HALLOWEEN);
  // what an older build kept still reads
  assert.deepEqual(parseSeason('{"christmas":true}'), ON);
  assert.equal(activeSeason(HALLOWEEN), "halloween");
  assert.equal(activeSeason(ON), "christmas");
  assert.equal(activeSeason(NO_SEASON), null);
  assert.equal(costumeOf("halloween"), "hat");
  assert.equal(costumeOf("christmas"), "cap");
  assert.equal(costumeOf(null), null);
});

test("Halloween's intro plays once a season, kept under its own key beside Christmas's", () => {
  const oct = new Date(2026, 9, 24);
  assert.equal(seasonKey(oct, "halloween"), "halloween-2026");
  assert.equal(seasonKey(new Date(2026, 10, 1), "halloween"), "halloween-2026");
  assert.equal(seasonIntroKey("christmas"), SEASON_INTRO_KEY);
  assert.equal(seasonIntroKey("halloween"), "nf.seasonIntro.halloween");
  assert.equal(splashSeason(HALLOWEEN, null, oct), "intro");
  assert.equal(splashSeason(HALLOWEEN, "halloween-2026", oct), "dressed");
  // last Christmas's intro is not this Halloween's, and next October plays it again
  assert.equal(splashSeason(HALLOWEEN, "christmas-2025", oct), "intro");
  assert.equal(splashSeason(HALLOWEEN, "halloween-2026", new Date(2027, 9, 25)), "intro");
});

test("the witch hat: on the 5's top bar, a third larger at header sizes, higher on Doh when he jumps", () => {
  assert.equal(hatOnMark(132), "translate(150 30) rotate(-12) scale(1.18)");
  assert.equal(hatOnMark(31), "translate(150 30) rotate(-12) scale(1.18)");
  assert.equal(hatOnMark(30), "translate(150 38) rotate(-12) scale(1.6)");
  assert.equal(hatOnMark(24), "translate(150 38) rotate(-12) scale(1.6)");
  assert.equal(hatOnDoh("doh-wave"), "translate(90 62) rotate(-14) scale(.5)");
  assert.equal(hatOnDoh("doh-cheer-blink"), "translate(90 54) rotate(-14) scale(.5)");
  // the drop's wobble turns about the brim, in px on the splash's 132 px mark
  const [x, y] = brimOnMark("hat", 132);
  assert.ok(Math.abs(x - (150 * 132) / 438) < 1e-9 && Math.abs(y - (30 * 132) / 438) < 1e-9);
  const [cx, cy] = brimOnMark("cap", 132);
  assert.ok(Math.abs(cx - (150 * 132) / 438) < 1e-9 && Math.abs(cy - (22 * 132) / 438) < 1e-9);
});

test("the chime is the Mountain King's tiptoe: l, t, d r m d m an octave up, short and detached, about 1.6 s", () => {
  assert.equal(solfaLine(KING_OPENING), "l, t, d r m d m");
  assert.deepEqual(KING_OPENING.map((n) => n.pitchMidi), [71, 73, 74, 76, 78, 74, 78]);
  assert.deepEqual(KING_OPENING.map((n) => n.startBeat), [0, 0.5, 1, 1.5, 2, 2.5, 3]);
  // written quavers and a crotchet (4 beats at 150 = 1.6 s), each note sounding well short of its length
  const last = KING_OPENING[KING_OPENING.length - 1]!;
  assert.equal(((last.startBeat + 1) * 60) / KING_BPM, 1.6);
  for (let i = 0; i + 1 < KING_OPENING.length; i++) {
    const n = KING_OPENING[i]!;
    assert.ok(n.durBeats < KING_OPENING[i + 1]!.startBeat - n.startBeat, `note ${i} is detached`);
  }
  assert.ok(chimeSeconds(KING_OPENING, KING_BPM) < 2.2);
  assert.deepEqual(seasonChime("halloween"), { notes: KING_OPENING, bpm: KING_BPM });
  assert.equal(seasonChime("christmas").notes, JOY_OPENING);
});

/** The published Mountain King's first bars as the pack would hold them (B minor, from B3), labelled. */
function kingFromPack(): NoteEvent[] {
  const steps: [number, number, string, string][] = [
    [59, 0.5, "l", ","], [61, 0.5, "t", ","], [62, 0.5, "d", ""], [64, 0.5, "r", ""], [66, 0.5, "m", ""], [62, 0.5, "d", ""], [66, 1, "m", ""],
    [65, 0.5, "ma", ""], [61, 0.5, "t", ","], [65, 1, "ma", ""],
    [64, 0.5, "r", ""], [60, 0.5, "ta", ","], [64, 1, "r", ""],
    [59, 0.5, "l", ","], [61, 0.5, "t", ","],
  ];
  let at = 4;
  return steps.map(([pitchMidi, beats, solfa, octaveMark]) => {
    const n = { pitchMidi, startBeat: at, durBeats: beats, degree: 0, solfa, octaveMark, conf: 1 };
    at += beats;
    return n;
  });
}

test("the Night Singer's phrase: the pack's first phrase from its first note, where the chime sits, else the chime", () => {
  const phrase = kingPhrase(kingFromPack());
  assert.equal(phrase.length, KING_PHRASE_NOTES);
  assert.equal(phraseLine(phrase), "l, t, d r m d m · ma t, ma · r ta, r");
  assert.equal(stickerLine("halloween", phrase), "l, t, d r m d m · ma t, ma · r ta, r");
  // moved up an octave to start on B4 as the chime does, from beat 0, and played detached
  assert.equal(phrase[0]!.pitchMidi, 71);
  assert.equal(phrase[0]!.startBeat, 0);
  assert.ok(phrase.every((n) => n.durBeats <= 0.6 + 1e-9));
  // about 3 s at the chime's tempo
  const end = phrase[phrase.length - 1]!.startBeat + 1;
  assert.ok(Math.abs((end * 60) / KING_BPM - 3.2) < 1e-9);
  // no pack, or too short a tune: the opening
  assert.deepEqual(kingPhrase(null), KING_OPENING.map((n) => ({ ...n })));
  assert.equal(solfaLine(kingPhrase(kingFromPack().slice(0, 4))), "l, t, d r m d m");
  // Christmas's sticker line prints as it always did
  assert.equal(stickerLine("christmas", JOY_LINE), "d' t l s f m r d");
});

test("bats: eight silhouettes, 18–34 px at 30–50%, each across in 2–3 s, none after 3 s, all gone by 6 s", () => {
  const plan = batPlan(5, 280);
  assert.equal(plan.length, 8);
  for (const b of plan) {
    assert.ok(b.size >= BATS.minSize && b.size <= BATS.maxSize, `size ${b.size}`);
    assert.ok(b.opacity >= 0.3 && b.opacity <= 0.5, `opacity ${b.opacity}`);
    assert.ok(b.delay >= 0 && b.delay <= 3, `delay ${b.delay}`);
    assert.ok(b.duration >= 2 - 1e-9 && b.duration <= 3 + 1e-9, `flight ${b.duration}`);
    assert.ok(b.delay + b.duration <= 6 + 1e-9, "gone by 6 s");
    assert.ok(b.y >= 0 && b.y <= 0.8 * 280 + 1, `y ${b.y}`);
    assert.ok(b.dir === 1 || b.dir === -1);
    assert.ok(Math.abs(b.rise) <= BATS.arc);
    assert.ok(b.flaps >= 4);
  }
  // both ways across, the same sky every time, another seed another sky
  assert.ok(plan.some((b) => b.dir === 1) && plan.some((b) => b.dir === -1));
  assert.deepEqual(batPlan(5, 280), plan);
  assert.notDeepEqual(batPlan(6, 280), plan);
});

test("Halloween's words: Home's question, the chip, the shelf and the sticker", () => {
  assert.equal(homeTitle(HALLOWEEN), "What are we singing this Halloween?");
  const w = seasonWords("halloween");
  assert.equal(w.chip, "Spooky songs");
  assert.equal(w.icon, "ghost");
  assert.equal(w.shelf, "Songs for Halloween");
  assert.equal(w.pathTitle, "The Midnight path");
  assert.equal(w.sticker, "Night Singer");
  assert.equal(w.stickerBody, "You sang all six on the Midnight path. This sticker stays in your book after Halloween.");
  assert.equal(untilLabel("2026-11-01"), "Until 1 November");
  assert.equal(seasonWords("christmas").chip, "Carols");
});

const mstep = (index: number, title: string, carol: string, cue: string, detail: string, passed: boolean): CarolStep =>
  ({ index, id: `midnight-${index}@62`, title, carol, hymnSlug: "x", cue, detail, passed, bestScore: passed ? 90 : null });
const MIDNIGHT = (passed: number): CarolStep[] => [
  mstep(1, "Mountain King run", "In the Hall of the Mountain King", "the Mountain King run", "l, t, d r m d m", passed >= 1),
  mstep(2, "Toccata turn", "Toccata in D minor", "the Toccata turn", "m r m r d t, l, se, l,", passed >= 2),
  mstep(3, "Round entry", "Have You Seen the Ghost of John?", "the round's entry", "Boo starts, you come in", passed >= 3),
  mstep(4, "The semitone climb", "Dem Bones", "Dem Bones' climb", "d de r re m f fe s", passed >= 4),
  mstep(5, "Marionette march", "Funeral March of a Marionette", "the Marionette's march", "the 6/8 tiptoe", passed >= 5),
  mstep(6, "All Saints line", "All Saints (Darmstadt)", "All Saints, from the top doh down", "d' s l l s f m d", passed >= 6),
];
const midnight = (passed: number): PracticeSeason => {
  const steps = MIDNIGHT(passed);
  return { season: "halloween", title: "The Midnight path", until: "2026-11-01", sung: passed, total: 6, next: steps.find((s) => !s.passed) ?? null, steps, badgeCode: "night_singer" };
};

test("the hub's pumpkin card: Halloween until 1 November, the first drill named as the first, then the next", () => {
  const first = seasonCard(midnight(0));
  assert.equal(first.season, "halloween");
  assert.equal(first.eyebrow, "Halloween · Until 1 November");
  assert.equal(first.title, "The Midnight path");
  assert.equal(
    first.body,
    "Six short drills from spooky songs: the Mountain King's tiptoe, Bach's organ turn, a ghostly round, and All Saints to finish.",
  );
  assert.equal(first.sung, "0 of 6 sung");
  assert.equal(first.next, "First: the Mountain King run");
  assert.equal(first.action, "Start");
  assert.equal(seasonCard(midnight(2)).next, "Next: the round's entry");
  assert.equal(seasonCard(midnight(2)).action, "Continue");
  assert.equal(seasonCard(midnight(6)).next, "All sung. The Night Singer sticker is yours.");
});

test("the Midnight path: Halloween · n of 6, Doh's word by the next song, the Night Singer told by its code", () => {
  const v = seasonView(midnight(1));
  assert.equal(v.season, "halloween");
  assert.equal(v.eyebrow, "Halloween · 1 of 6");
  assert.equal(v.open, 2);
  assert.equal(v.rows[0]!.line, "In the Hall of the Mountain King · l, t, d r m d m");
  assert.equal(seasonBuddyLine(midnight(1)), "A perfect tiptoe! Now the organ's turn: m r m, quick as a wink.");
  assert.equal(seasonBuddyLine(midnight(0)), "Shh, tiptoe with me: the Mountain King's run, soft and short.");
  assert.equal(seasonBuddyLine(midnight(5)), "Last one, for All Saints' Day: sing it from the top doh down.");
  assert.equal(seasonBuddyLine(midnight(6)), "You sang all six on the Midnight path. Happy Halloween!");
  // a song this build has no line for still gets one, by its cue
  const other = midnight(0);
  other.next = { ...other.next!, carol: "Danse Macabre", cue: "the open fifth" };
  assert.equal(seasonBuddyLine(other), "Next: the open fifth. Boo and I are listening!");
  assert.equal(earnedSeasonBadge([{ code: "night_singer" }], "night_singer"), true);
  assert.equal(earnedSeasonBadge([{ code: "carol_singer" }], "night_singer"), false);
});
