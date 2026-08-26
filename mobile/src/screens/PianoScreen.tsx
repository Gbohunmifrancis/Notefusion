import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { Screen } from "../components/Screen";
import { Touchable } from "../components/Touchable";
import { Button } from "../components/Button";
import {
  PianoStaff,
  STAFF_HEIGHT,
  beatToX,
  staffMetrics,
} from "../components/PianoStaff";
import { useColors, useTheme, useThemedStyles } from "../lib/theme";
import * as haptics from "../lib/haptics";
import { markPractisedToday } from "../lib/practiceReminder";
import { beatSecOf } from "../lib/synth";
import { beatsPerBar, buildMusicXml, resolveKeySignature } from "../lib/musicxml";
import { KEY_CHOICES, deriveSolfa } from "../lib/solfa";
import { spell } from "../lib/keySignature";
import { libraryApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { playKey, prepareKeyboard, releaseKeyboard } from "../lib/keyboardVoices";
import {
  fonts,
  motion,
  pitchColor,
  radii,
  spacing,
  typography,
  type Palette,
  type PitchLetter,
} from "../design/theme";
import type { NoteEvent } from "../api/types";
import type { RootStackParams } from "../navigation/types";

/**
 * PianoScreen — one landscape keyboard doing three jobs.
 *
 *   **play**    the transcription scrolls under a playhead and you play along, scored
 *               on pitch and timing together.
 *   **correct** the same stave, stopped: tap a wrong note, press the right key, save.
 *               The save overwrites the transcription it came from.
 *   **free**    no piece at all — a keyboard for playing anything, captured against a
 *               fixed tempo and saveable to the library.
 *
 * They are one screen rather than three because they are the same instrument and the
 * same stave, and because the interesting path between them has no navigation in it:
 * play badly and the end card offers to fix the piece, which is a mode switch.
 *
 * ── Why landscape ─────────────────────────────────────────────────────────────
 * A keyboard wide enough to hit and a stave long enough to read ahead on do not both
 * fit across a portrait phone. `RootNavigator` gives this one screen
 * `orientation: "landscape"` and every other screen stays portrait; that is a native
 * option on `react-native-screens`, so it needs a build rather than an OTA update.
 *
 * ── Where the clock comes from ────────────────────────────────────────────────
 * `Date.now()`, not an audio position. In a play-along the *player* makes the sound,
 * so there is no backing track whose clock could drift away from the animation. The
 * one number shared with the rest of the app is `beatSecOf` — everything mapping
 * beats onto audio uses the same tempo floor, or a slow transcription silently plays
 * at a different speed here than it does on Result.
 *
 * ── Why the keyboard is warmed up first ───────────────────────────────────────
 * See `lib/keyboardVoices.ts`. Rendering one note is tens of milliseconds, so the
 * samples are all built up front behind a progress readout rather than on the tap.
 * That cost is why the shown range is capped: every key on screen is a live player.
 *
 * ── Who owns the corrected notes ──────────────────────────────────────────────
 * Not this screen. Correct mode calls `onApply(notes)` and pops, exactly as
 * `NoteEditor` reports upward — Result and Library hold the rollback path, and a
 * second copy of it here would be a second thing to get wrong. The price is a route
 * param that is a function, so React Navigation logs its dev-only
 * non-serialisable-params warning for this route; nothing here uses state
 * persistence and the notification deep link only targets Result.
 */

// ─── Keyboard geometry ────────────────────────────────────────────────────────

/** Semitone offsets of the white keys within an octave, from C. */
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;
/** Letter step of each white semitone, so a MIDI pitch class reads back as a letter. */
const WHITE_STEP_OF_SEMITONE: Record<number, number> = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
/**
 * Which white keys have a black key on their upper edge. 2 is E and 6 is B — the
 * two boundaries in an octave with no black key between them, which is the whole
 * reason a keyboard looks the way it does.
 */
const BLACK_ABOVE_WHITE = new Set([0, 1, 3, 4, 5]);

/** Letter name of each white key within an octave, matching `WHITE_SEMITONES`. */
const WHITE_LETTERS: readonly PitchLetter[] = ["C", "D", "E", "F", "G", "A", "B"];

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;

/** A black key is narrower and shorter than a white one, as on the instrument. */
const BLACK_WIDTH_RATIO = 0.62;
const WHITE_KEY_HEIGHT = 152;
const BLACK_KEY_HEIGHT = 94;

/**
 * How many white keys the keyboard shows — and with it, how wide every key gets.
 *
 * The keys are laid out to fill the screen, so this is the key-width dial and nothing
 * else: ten whites across a landscape phone is about 80 dp each, against a fingertip
 * of roughly 45. Fourteen left them near 57 and three octaves under 40, which is when
 * playing became a game of aiming.
 *
 * Ten is also a musical span rather than a round number — an octave and a third, C up
 * to the E above — which is where most sung melodies sit. What falls outside is folded
 * by octave in play mode and walked to with the ◀ ▶ shifters in the other two. Fewer
 * keys you can hit beats more keys you cannot.
 */
const WHITE_KEYS = 10;

/**
 * The white keys are drawn as cards of three and four — C D E and F G A B — with this
 * much air between them. On a real keyboard that boundary is marked by the missing
 * black key; drawn flat on glass it needs the gap, or a player counting up from C
 * loses their place. No black key ever straddles one of these, which is what makes
 * the grouping safe: the five blacks sit inside C–D–E and F–G–A–B, never between.
 */
const GROUP_GAP = 10;

// ─── Timing ───────────────────────────────────────────────────────────────────

/** Horizontal scale of the stave, in px per quarter-note beat. */
const PX_PER_BEAT_PLAY = 96;
/** Wider when the stave is being edited: a chip is a tap target, not a target to read. */
const PX_PER_BEAT_EDIT = 124;

/** Where the playhead sits, measured from the left of the stave area. */
const PLAYHEAD_X = 120;

/** One bar of nothing before the first note, counted down on screen. */
const COUNT_IN_BARS = 1;

/**
 * How far off the beat a press can be and still count, and how close it has to be
 * to score full marks. 150 ms is about the width of the window rhythm games settle
 * on: tight enough that guessing does not pass, loose enough that touch latency —
 * which on Android is a good 40 ms before anything of ours runs — is not the thing
 * being measured.
 */
const HIT_WINDOW_MS = 150;
const PERFECT_MS = 60;

/** Combo multiplier: one step per five notes, capped so a long piece cannot run away. */
const COMBO_STEP = 5;
const MAX_MULTIPLIER = 4;

/** Drives the count-in readout and the missed-note sweep. Not the animation. */
const TICK_MS = 60;

/** Below this the end card offers to fix the piece instead of just replaying it. */
const POOR_ACCURACY = 60;

/**
 * How long the "turn your phone" prompt stays up.
 *
 * Long enough to read a line while the rotation animation plays, short enough that
 * someone who was already holding the handset sideways is not waiting on it. It runs
 * alongside the keyboard warm-up, so it costs nothing either way.
 */
const ROTATE_HINT_MS = 2600;

const PENDING = 0;
const HIT = 1;
const MISS = 2;

// ─── Free play ────────────────────────────────────────────────────────────────

/** Defaults for a piece that has no transcription behind it. */
const FREE_TEMPO = 90;
const FREE_KEY = "C major";
const FREE_METERS = ["4/4", "3/4", "6/8"] as const;
/** Bottom C of the free-play keyboard: C3, low enough to sing against, high enough to carry. */
const FREE_LOW_MIDI = 48;

/**
 * Free play is quantised to the half beat.
 *
 * Wall-clock onsets are not a rhythm — they are a performance of one, and written
 * out raw they produce a stave nobody can read and a MusicXML export full of
 * 64th-note tuplets. Half a beat is the coarsest grid that still distinguishes the
 * quavers people actually play, and the floor stops a stab becoming a zero-length
 * note the renderer would drop.
 */
const SNAP = 2;
const MIN_FREE_DUR = 0.5;

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "play" | "correct" | "free";
type Phase = "loading" | "ready" | "running" | "done";

interface KeyLayout {
  midi: number;
  /** Left edge, in px from the left of the keyboard. */
  x: number;
  width: number;
  black: boolean;
  /** Last white in its card, so it draws no divider on its right. */
  endsGroup: boolean;
}

/** One card of three or four white keys. Drawn behind them as the keyboard's outline. */
interface GroupLayout {
  x: number;
  width: number;
}

interface LaneNote {
  /** Pitch after folding into the shown range — what the player has to press. */
  pitch: number;
  startBeat: number;
  durBeats: number;
  /** Onset in ms from the downbeat, i.e. after the count-in. */
  timeMs: number;
}

interface Stats {
  score: number;
  combo: number;
  bestCombo: number;
  hits: number;
  perfects: number;
  misses: number;
}

const NO_STATS: Stats = { score: 0, combo: 0, bestCombo: 0, hits: 0, perfects: 0, misses: 0 };

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * MIDI offset of the highest key drawn, counting from the bottom C.
 *
 * Not simply `WHITE_KEYS` semitones: the window ends wherever its last white key ends,
 * and that white carries a black on its upper edge unless it is an E or a B. Ten whites
 * therefore reach E — no black above it — and the keyboard is seventeen keys wide.
 */
const TOP_OFFSET = topOffsetOf(WHITE_KEYS);

/** Cards the whites fall into: one per C–D–E, one per F–G–A–B, the last part-filled. */
function groupCountOf(whites: number): number {
  const step = (whites - 1) % 7;
  return Math.floor((whites - 1) / 7) * 2 + (step >= 3 ? 2 : 1);
}

function topOffsetOf(whites: number): number {
  const step = (whites - 1) % 7;
  const top = Math.floor((whites - 1) / 7) * 12 + WHITE_SEMITONES[step]!;
  return BLACK_ABOVE_WHITE.has(step) ? top + 1 : top;
}

/**
 * Which C the window starts on: the one at or below the lowest note in the piece.
 *
 * The window's *width* is no longer a decision — `WHITE_KEYS` fixes it, because it is
 * really a floor under how wide a key can be. So all that is left to choose is where
 * it sits, and starting on a C is what makes the keyboard readable: a player counting
 * up from the leftmost key is counting from a landmark. Play mode folds what will not
 * fit; correct and free mode shift the window instead.
 */
function lowCFor(pitches: number[]): number {
  if (pitches.length === 0) return 60;
  let low = pitches[0]!;
  for (const p of pitches) if (p < low) low = p;
  return Math.floor(low / 12) * 12;
}

/** Every pitch on the keyboard, low to high. Independent of screen width. */
function keyMidisFor(lowMidi: number): number[] {
  const midis: number[] = [];
  for (let i = 0; i <= TOP_OFFSET; i++) midis.push(lowMidi + i);
  return midis;
}

/**
 * Positions the keys across `width` as rounded cards of three and four whites. Blacks
 * straddle the boundary between two whites *inside* a card, which is what makes them
 * line up with the gaps a player expects.
 *
 * Returns the cards too. They are drawn as one outline per group with the keys sitting
 * inside it, rather than as a border per key — which is the difference between a
 * keyboard and a row of buttons.
 */
function layoutKeys(lowMidi: number, width: number): { keys: KeyLayout[]; groups: GroupLayout[] } {
  const groupCount = groupCountOf(WHITE_KEYS);
  const whiteWidth = (width - GROUP_GAP * (groupCount - 1)) / WHITE_KEYS;
  const blackWidth = whiteWidth * BLACK_WIDTH_RATIO;
  const keys: KeyLayout[] = [];
  const groups: GroupLayout[] = [];

  for (let i = 0; i < WHITE_KEYS; i++) {
    const octave = Math.floor(i / 7);
    const step = i % 7;
    const midi = lowMidi + octave * 12 + WHITE_SEMITONES[step]!;
    // Cards before this key: two per whole octave, plus one if it is past the E/F break.
    const groupsBefore = octave * 2 + (step >= 3 ? 1 : 0);
    const x = i * whiteWidth + groupsBefore * GROUP_GAP;

    // A card opens on C and on F, and closes when the next key opens a new one.
    if (step === 0 || step === 3) groups.push({ x, width: whiteWidth });
    else groups[groups.length - 1]!.width += whiteWidth;
    const endsGroup = i === WHITE_KEYS - 1 || step === 2 || step === 6;

    keys.push({ midi, x, width: whiteWidth, black: false, endsGroup });
    if (BLACK_ABOVE_WHITE.has(step)) {
      keys.push({
        midi: midi + 1,
        x: x + whiteWidth - blackWidth / 2,
        width: blackWidth,
        black: true,
        endsGroup: false,
      });
    }
  }
  return { keys, groups };
}

/** Shifts a pitch by whole octaves until it lands on the keyboard. */
function foldIntoRange(pitch: number, lowMidi: number, highMidi: number): number {
  let p = pitch;
  while (p < lowMidi) p += 12;
  while (p > highMidi) p -= 12;
  return p;
}

function noteNameOf(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Rounds a beat onto the half-beat grid free play is captured against. */
function snapBeat(beat: number): number {
  return Math.max(0, Math.round(beat * SNAP) / SNAP);
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function PianoScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const params = useRoute<RouteProp<RootStackParams, "Piano">>().params;
  const styles = useThemedStyles(makeStyles);
  const colors = useColors();
  const { mode: themeMode } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  /** The transcription behind the screen, or null in free play. */
  const piece = params.mode === "free" ? null : params;

  const [modeState, setModeState] = useState<Mode>(params.mode);
  /** Total, so nothing has to re-narrow `piece` to know a mode is reachable. */
  const mode: Mode = piece === null ? "free" : modeState;
  const editing = mode !== "play";

  /**
   * Measured rather than taken from the window: the shell insets for a notch, and in
   * landscape that inset is on the side the keys are laid out across. The window
   * width is only the first frame's guess.
   */
  const [width, setWidth] = useState(windowWidth);

  /**
   * The "turn your phone" prompt, up on arrival and again whenever the window is
   * still taller than it is wide.
   *
   * The route locks the *display* to landscape, which nothing in the app can do for
   * the handset in someone's hand — so tapping Piano from a phone held upright gives
   * a piano lying on its side, and the fix is a sentence rather than any amount of
   * layout. `useWindowDimensions` cannot see how the phone is being held, only what
   * the window became, so the timer is what does the actual notifying; the portrait
   * check is a safety net for the case where the lock does not take at all.
   */
  const [rotateHint, setRotateHint] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setRotateHint(false), ROTATE_HINT_MS);
    return () => clearTimeout(timer);
  }, []);

  // ── The piece ───────────────────────────────────────────────────────────────

  const [draft, setDraft] = useState<NoteEvent[]>(piece?.notes ?? []);
  const [keyText, setKeyText] = useState(piece?.musicalKey ?? FREE_KEY);
  const [tempoBpm, setTempoBpm] = useState(piece?.tempoBpm ?? FREE_TEMPO);
  const [timeSignature, setTimeSignature] = useState(piece?.timeSignature ?? FREE_METERS[0]);

  const beatSec = beatSecOf(tempoBpm);
  const beatMs = beatSec * 1000;
  const perBar = beatsPerBar(timeSignature);
  const countInBeats = COUNT_IN_BARS * perBar;

  /**
   * Solfa is never stored on the draft, only derived from it. That is the movable-do
   * rule made structural: a re-key or a corrected pitch re-labels, and a note whose
   * syllable was written down once would keep the old label for the new key.
   */
  const labelled = useMemo(
    () => deriveSolfa(draft, keyText, timeSignature).notes,
    [draft, keyText, timeSignature],
  );

  // ── Keyboard range ──────────────────────────────────────────────────────────

  /** How far the shown window has been nudged, in octaves, by the ◀ ▶ shifters. */
  const [octaveShift, setOctaveShift] = useState(0);

  const baseLow = useMemo(() => {
    if (piece === null) return FREE_LOW_MIDI;
    return lowCFor(draft.map((n) => n.pitchMidi).filter((p) => p > 0));
  }, [piece, draft]);

  // MIDI 12 (C0) to the C that leaves a whole window below 108, so a shifter can
  // never walk the keyboard off either end of the instrument.
  const lowMidi = Math.max(12, Math.min(108 - TOP_OFFSET, baseLow + 12 * octaveShift));
  const highMidi = lowMidi + TOP_OFFSET;

  // Width-independent, so a rotation cannot trigger a second warm-up.
  const keyMidis = useMemo(() => keyMidisFor(lowMidi), [lowMidi]);
  const { keys, keyGroups } = useMemo(() => {
    const laid = layoutKeys(lowMidi, width);
    return { keys: laid.keys, keyGroups: laid.groups };
  }, [lowMidi, width]);

  // ── What the stave shows ────────────────────────────────────────────────────

  /**
   * Play mode shows the *folded* pitches, because they are what the player has to
   * press: a stave showing a note two octaves above the key that scores it would be
   * lying about the exercise. Editing modes show the real pitches — that is the
   * thing being repaired — and fold nothing.
   */
  const shown = useMemo(() => {
    if (mode !== "play") return labelled;
    const folded = draft.map((n) => ({
      ...n,
      pitchMidi: foldIntoRange(n.pitchMidi, lowMidi, highMidi),
    }));
    return deriveSolfa(folded, keyText, timeSignature).notes;
  }, [mode, labelled, draft, lowMidi, highMidi, keyText, timeSignature]);

  const pxPerBeat = editing ? PX_PER_BEAT_EDIT : PX_PER_BEAT_PLAY;
  const metrics = useMemo(
    () => staffMetrics(shown, timeSignature, keyText, pxPerBeat, mode === "free" ? perBar * 2 : 0),
    [shown, timeSignature, keyText, pxPerBeat, mode, perBar],
  );

  // ── Play state ──────────────────────────────────────────────────────────────

  const [phase, setPhase] = useState<Phase>("loading");
  const [warmed, setWarmed] = useState({ done: 0, total: 0 });
  const [stats, setStats] = useState<Stats>(NO_STATS);
  const [countIn, setCountIn] = useState(countInBeats);
  /**
   * Judgements live in a ref so a hit does not re-render per note, but the stave has
   * to repaint to show them — so this counter is bumped alongside and the stave is
   * memoised on it. That is its only job.
   */
  const [judgeTick, setJudgeTick] = useState(0);

  /**
   * The piece, sorted by onset. Sorting is what lets the missed-note sweep be a
   * single advancing cursor instead of a scan of the whole piece every tick.
   */
  const lane = useMemo<LaneNote[]>(
    () =>
      shown
        .filter((n) => n.pitchMidi > 0)
        .map((n) => ({
          pitch: n.pitchMidi,
          startBeat: n.startBeat,
          durBeats: n.durBeats,
          timeMs: n.startBeat * beatMs,
        }))
        .sort((a, b) => a.startBeat - b.startBeat),
    [shown, beatMs],
  );

  const totalBeats = useMemo(
    () => lane.reduce((max, n) => Math.max(max, n.startBeat + n.durBeats), 0),
    [lane],
  );
  const totalMs = totalBeats * beatMs;

  const judgedRef = useRef<Uint8Array>(new Uint8Array(0));
  const sweepRef = useRef(0);
  const startedAtRef = useRef(0);
  /**
   * Which count-in beat has already been ticked out. `-1` is "the run has not
   * started", `0` is "the downbeat has landed" — so the first beat of a count-in
   * gets a tick like every other one, and the downbeat's heavier tick fires once.
   */
  const lastCountRef = useRef(-1);

  /** Ms since the downbeat. Negative through the count-in. */
  const musicMs = useCallback(
    () => Date.now() - startedAtRef.current - countInBeats * beatMs,
    [beatMs, countInBeats],
  );

  // ── Animation ───────────────────────────────────────────────────────────────

  /** Translation of the stave. The playhead is fixed; the music moves past it. */
  const sweep = useSharedValue(PLAYHEAD_X);
  const sweepStyle = useAnimatedStyle(() => ({ transform: [{ translateX: sweep.value }] }));

  /** 0‥1 through the piece, driven by the same linear clock as `sweep`. */
  const progress = useSharedValue(0);
  const progressStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -width * (1 - progress.value) }],
  }));

  // ── Warm-up ─────────────────────────────────────────────────────────────────

  // Hold the samples only as long as the screen is mounted, and rebuild them when
  // the shown window moves — a key with no player is a silent key.
  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setWarmed({ done: 0, total: keyMidis.length });
    void prepareKeyboard(keyMidis, (done, total) => {
      if (alive) setWarmed({ done, total });
    }).then((ok) => {
      if (alive && ok) setPhase("ready");
    });
    return () => {
      alive = false;
      releaseKeyboard();
    };
  }, [keyMidis]);

  // ── Play mode: run, judge, sweep ────────────────────────────────────────────

  const start = useCallback(() => {
    judgedRef.current = new Uint8Array(lane.length);
    sweepRef.current = 0;
    lastCountRef.current = -1;
    setStats(NO_STATS);
    setCountIn(countInBeats);
    setJudgeTick((v) => v + 1);
    startedAtRef.current = Date.now();

    // Assign then animate: the assignment lands this frame, so the run always starts
    // a count-in's worth of stave to the right rather than wherever the previous run
    // left it. Beat b sits under the playhead when translateX is
    // PLAYHEAD_X − beatToX(b), which is what makes both ends of this exact.
    const from = PLAYHEAD_X - beatToX(-countInBeats, metrics, pxPerBeat);
    const to = PLAYHEAD_X - beatToX(totalBeats, metrics, pxPerBeat);
    sweep.value = from;
    sweep.value = withTiming(to, {
      duration: (countInBeats + totalBeats) * beatMs,
      easing: Easing.linear,
    });

    progress.value = 0;
    progress.value = withDelay(
      countInBeats * beatMs,
      withTiming(1, { duration: Math.max(1, totalMs), easing: Easing.linear }),
    );

    setPhase("running");
  }, [lane.length, totalBeats, totalMs, beatMs, countInBeats, metrics, pxPerBeat, sweep, progress]);

  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => {
      const t = musicMs();

      if (t < 0) {
        const remaining = Math.max(1, Math.ceil(-t / beatMs));
        if (remaining !== lastCountRef.current) {
          lastCountRef.current = remaining;
          haptics.play("light");
        }
        setCountIn(remaining);
        return;
      }
      if (lastCountRef.current !== 0) {
        lastCountRef.current = 0;
        haptics.play("medium");
        setCountIn(0);
      }

      // Sorted by onset, so once a note's window has closed every note before it has
      // too — the cursor never needs to go back.
      let missed = 0;
      while (
        sweepRef.current < lane.length &&
        lane[sweepRef.current]!.timeMs + HIT_WINDOW_MS < t
      ) {
        if (judgedRef.current[sweepRef.current] === PENDING) {
          judgedRef.current[sweepRef.current] = MISS;
          missed++;
        }
        sweepRef.current++;
      }
      if (missed > 0) {
        haptics.play("warning");
        setStats((s) => ({ ...s, misses: s.misses + missed, combo: 0 }));
        setJudgeTick((v) => v + 1);
      }

      if (t > totalMs + HIT_WINDOW_MS) setPhase("done");
    }, TICK_MS);
    return () => clearInterval(id);
  }, [phase, lane, beatMs, totalMs, musicMs]);

  // ── Correct mode ────────────────────────────────────────────────────────────

  const [selected, setSelected] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  /**
   * How many notes were doubtful on arrival. The progress bar counts against this,
   * and it is captured once: correcting a note sets its confidence to 1, so a live
   * count of the denominator would shrink as fast as the numerator grew and the bar
   * would never move.
   */
  const flaggedAtEntry = useRef(piece?.notes.filter((n) => n.conf < 0.5).length ?? 0).current;
  const flaggedNow = useMemo(() => draft.filter((n) => n.conf < 0.5).length, [draft]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectNote = useCallback(
    (index: number) => {
      setSelected(index);
      const note = draft[index];
      if (note) playKey(foldIntoRange(note.pitchMidi, lowMidi, highMidi));
      haptics.play("light");
    },
    [draft, lowMidi, highMidi],
  );

  const deleteNote = useCallback((index: number) => {
    setDraft((prev) => {
      // Refuse the last note: an empty piece has nothing to draw, nothing to save
      // and no way back to a stave, which is a worse outcome than a wrong note.
      if (prev.length <= 1) return prev;
      haptics.play("warning");
      return prev.filter((_, i) => i !== index);
    });
    setSelected(null);
  }, []);

  /** Auto-scroll so the selected chip is on screen without hunting for it. */
  useEffect(() => {
    if (!editing || selected === null) return;
    const note = draft[selected];
    if (!note) return;
    const x = beatToX(note.startBeat, metrics, pxPerBeat) - width / 2;
    scrollRef.current?.scrollTo({ x: Math.max(0, x), animated: true });
  }, [editing, selected, draft, metrics, pxPerBeat, width]);

  // ── Free mode: capture ──────────────────────────────────────────────────────

  /** Wall clock of the first key press. 0 means "nothing recorded yet". */
  const recStartRef = useRef(0);
  /** Keys currently down, with the beat each was struck on. */
  const heldRef = useRef(new Map<number, number>());

  const beginNote = useCallback(
    (pitch: number) => {
      const now = Date.now();
      if (recStartRef.current === 0) recStartRef.current = now;
      heldRef.current.set(pitch, snapBeat((now - recStartRef.current) / beatMs));
    },
    [beatMs],
  );

  const endNote = useCallback(
    (pitch: number) => {
      const startBeat = heldRef.current.get(pitch);
      if (startBeat === undefined) return;
      heldRef.current.delete(pitch);
      const held = (Date.now() - recStartRef.current) / beatMs - startBeat;
      const durBeats = Math.max(MIN_FREE_DUR, snapBeat(held));
      setDraft((prev) =>
        [
          ...prev,
          // `degree`, `solfa` and `octaveMark` are placeholders: `deriveSolfa` fills
          // them from the current key, and holding them here would freeze a label.
          { pitchMidi: pitch, startBeat, durBeats, degree: 0, solfa: "", octaveMark: "", conf: 1 },
        ].sort((a, b) => a.startBeat - b.startBeat),
      );
    },
    [beatMs],
  );

  // ── Keys ────────────────────────────────────────────────────────────────────

  const pressKey = useCallback(
    (pitch: number) => {
      // Always sounds, in every mode and phase: the keyboard is an instrument first,
      // and being able to find a note before starting is half of practising.
      playKey(pitch);

      if (mode === "free") {
        beginNote(pitch);
        return;
      }

      if (mode === "correct") {
        if (selected === null) return;
        setDraft((prev) =>
          prev.map((n, i) =>
            // Confidence 1 because the user is the source for this note now — the
            // same claim `ResultScreen`'s stepper makes when it edits a pitch.
            i === selected ? { ...n, pitchMidi: pitch, conf: 1 } : n,
          ),
        );
        haptics.play("success");
        return;
      }

      if (phase !== "running") return;
      const t = musicMs();
      if (t < 0) return; // Nothing to judge yet during the count-in.

      let best = -1;
      let bestDelta = Infinity;
      for (let i = 0; i < lane.length; i++) {
        if (judgedRef.current[i] !== PENDING || lane[i]!.pitch !== pitch) continue;
        const delta = Math.abs(lane[i]!.timeMs - t);
        if (delta <= HIT_WINDOW_MS && delta < bestDelta) {
          best = i;
          bestDelta = delta;
        }
      }

      if (best < 0) {
        // Wrong key, or right key at the wrong moment. Both break the combo —
        // otherwise mashing the keyboard would score as well as playing it.
        setStats((s) => (s.combo === 0 ? s : { ...s, combo: 0 }));
        return;
      }

      judgedRef.current[best] = HIT;
      const perfect = bestDelta <= PERFECT_MS;
      haptics.play(perfect ? "success" : "light");
      setStats((s) => {
        const combo = s.combo + 1;
        const multiplier = Math.min(1 + Math.floor(combo / COMBO_STEP), MAX_MULTIPLIER);
        return {
          score: s.score + (perfect ? 100 : 50) * multiplier,
          combo,
          bestCombo: Math.max(s.bestCombo, combo),
          hits: s.hits + 1,
          perfects: s.perfects + (perfect ? 1 : 0),
          misses: s.misses,
        };
      });
      setJudgeTick((v) => v + 1);
    },
    [mode, phase, lane, musicMs, selected, beginNote],
  );

  const releaseKey = useCallback(
    (pitch: number) => {
      if (mode === "free") endNote(pitch);
    },
    [mode, endNote],
  );

  // ── Saving ──────────────────────────────────────────────────────────────────

  const applyCorrections = useCallback(() => {
    piece?.onApply?.(labelled);
    haptics.play("success");
    nav.goBack();
  }, [piece, labelled, nav]);

  const saveFreePlay = useCallback(async () => {
    if (labelled.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const musicXml = buildMusicXml(labelled, resolveKeySignature(keyText), timeSignature, {
        lyrics: true,
      });
      if (musicXml === null) throw new Error("Nothing to save yet.");
      await libraryApi.save({
        title: `Piano — ${new Date().toLocaleDateString()}`,
        key: keyText,
        tempoBpm,
        timeSignature,
        musicXml,
        notes: labelled,
        // Every note here was typed by the user, so there is nothing to be unsure of.
        overallConfidence: 1,
      });
      haptics.play("success");
      // Writing out a piece by hand counts as practice too.
      void markPractisedToday();
      nav.goBack();
    } catch (e) {
      setError(toApiError(e).message);
      haptics.play("warning");
    } finally {
      setSaving(false);
    }
  }, [labelled, keyText, timeSignature, tempoBpm, nav]);

  // ── Derived readouts ────────────────────────────────────────────────────────

  const accuracy = lane.length > 0 ? Math.round((stats.hits / lane.length) * 100) : 0;
  const canCorrect = piece !== null && typeof piece.onApply === "function";
  const editProgress =
    mode === "correct"
      ? flaggedAtEntry === 0
        ? 1
        : Math.min(1, (flaggedAtEntry - flaggedNow) / flaggedAtEntry)
      : 0;

  /**
   * The stave is the expensive part of a render — one SVG group per note — and the
   * count-in, the score and the miss sweep all set state while it is on screen. So
   * the element is memoised and `judgeTick` is what invalidates it, exactly as the
   * falling bars were before.
   */
  const stave = useMemo(
    () => (
      <PianoStaff
        notes={shown}
        timeSignature={timeSignature}
        musicalKey={keyText}
        pxPerBeat={pxPerBeat}
        minBeats={mode === "free" ? perBar * 2 : 0}
        selectedIndex={editing ? selected : null}
        onSelectNote={editing ? selectNote : undefined}
        onLongPressNote={mode === "correct" ? deleteNote : undefined}
        judged={mode === "play" ? judgedRef.current : undefined}
      />
    ),
    // `judgeTick` is the point of this memo: it changes when a note is hit or missed,
    // and the chips have to be rebuilt to recolour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      shown,
      timeSignature,
      keyText,
      pxPerBeat,
      mode,
      perBar,
      editing,
      selected,
      selectNote,
      deleteNote,
      judgeTick,
    ],
  );

  return (
    <Screen edges={["top", "left", "right", "bottom"]} contentStyle={styles.content}>
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <Touchable
          onPress={() => nav.goBack()}
          style={styles.iconButton}
          ripple="borderless"
          scaleTo={motion.scale.large}
          accessibilityLabel="Close the piano"
          accessibilityRole="button"
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </Touchable>

        {mode === "free" ? (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.keyRow}
            >
              {KEY_CHOICES.map((k) => (
                <Touchable
                  key={k}
                  onPress={() => setKeyText(k)}
                  style={[styles.chip, k === keyText && styles.chipOn]}
                  radius={radii.pill}
                  accessibilityLabel={`Key of ${k}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: k === keyText }}
                >
                  <Text style={[styles.chipText, k === keyText && styles.chipTextOn]}>{k}</Text>
                </Touchable>
              ))}
            </ScrollView>

            <Touchable
              onPress={() =>
                setTimeSignature(
                  (prev) =>
                    FREE_METERS[(FREE_METERS.indexOf(prev as (typeof FREE_METERS)[number]) + 1) %
                      FREE_METERS.length]!,
                )
              }
              style={styles.chip}
              radius={radii.pill}
              accessibilityLabel={`Meter ${timeSignature}, tap to change`}
              accessibilityRole="button"
            >
              <Text style={styles.chipText}>{timeSignature}</Text>
            </Touchable>

            <View style={styles.stepper}>
              <Touchable
                onPress={() => setTempoBpm((t) => Math.max(40, t - 5))}
                style={styles.stepperButton}
                ripple="borderless"
                accessibilityLabel="Slower"
                accessibilityRole="button"
              >
                <Ionicons name="remove" size={16} color={colors.accent} />
              </Touchable>
              <Text style={styles.stepperValue}>{`${Math.round(tempoBpm)} BPM`}</Text>
              <Touchable
                onPress={() => setTempoBpm((t) => Math.min(220, t + 5))}
                style={styles.stepperButton}
                ripple="borderless"
                accessibilityLabel="Faster"
                accessibilityRole="button"
              >
                <Ionicons name="add" size={16} color={colors.accent} />
              </Touchable>
            </View>
          </>
        ) : (
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>
              {mode === "correct" ? "Fix the notes" : (piece?.title ?? "Play along")}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {mode === "correct"
                ? flaggedNow > 0
                  ? `Tap a note, then press the right key · ${flaggedNow} left to check`
                  : "Tap a note, then press the right key"
                : `${keyText} · ${Math.round(tempoBpm)} BPM · ${noteNameOf(lowMidi)}–${noteNameOf(highMidi)}`}
            </Text>
          </View>
        )}

        {mode === "play" ? (
          <View style={styles.scoreBox}>
            <Text style={styles.score}>{stats.score}</Text>
            {stats.combo > 1 ? <Text style={styles.combo}>{`${stats.combo}×`}</Text> : null}
          </View>
        ) : (
          <Touchable
            onPress={mode === "correct" ? applyCorrections : () => void saveFreePlay()}
            disabled={saving || labelled.length === 0}
            style={styles.saveButton}
            radius={radii.pill}
            haptic="none"
            accessibilityLabel={mode === "correct" ? "Save the corrections" : "Save to your library"}
            accessibilityRole="button"
          >
            <Ionicons name="checkmark" size={16} color={colors.onAccent} />
            <Text style={styles.saveLabel}>{saving ? "Saving…" : "Save"}</Text>
          </Touchable>
        )}
      </View>

      {/* ── Progress ────────────────────────────────────────────────────────── */}
      <View style={styles.progressTrack}>
        {mode === "play" ? (
          <Animated.View style={[styles.progressFill, progressStyle, { width }]} />
        ) : mode === "correct" ? (
          <View style={[styles.progressFill, { width: `${editProgress * 100}%` }]} />
        ) : null}
      </View>

      {/* ── Stave ───────────────────────────────────────────────────────────── */}
      <View style={styles.staveArea} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {editing ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.staveScroll}
          >
            {stave}
          </ScrollView>
        ) : (
          <>
            <Animated.View style={[styles.staveTrack, sweepStyle]}>{stave}</Animated.View>
            <View style={[styles.playhead, { left: PLAYHEAD_X }]} pointerEvents="none" />
          </>
        )}

        {phase === "loading" ? (
          <View style={styles.overlay}>
            <Text style={styles.overlayTitle}>Tuning the keyboard</Text>
            <Text style={styles.overlayHint}>{`${warmed.done} of ${warmed.total} keys`}</Text>
          </View>
        ) : null}

        {mode === "play" && phase === "ready" ? (
          <View style={styles.overlay}>
            <Text style={styles.overlayTitle}>
              {lane.length > 0 ? `${lane.length} notes` : "Nothing to play"}
            </Text>
            <Text style={styles.overlayHint}>
              Press each key as its note reaches the line
            </Text>
            {lane.length > 0 ? (
              <Button label="Start" icon="play" onPress={start} style={styles.overlayButton} />
            ) : null}
          </View>
        ) : null}

        {mode === "play" && phase === "running" && countIn > 0 ? (
          <View style={styles.overlay} pointerEvents="none">
            <Text style={styles.countIn}>{countIn}</Text>
            <Text style={styles.overlayHint}>Get ready</Text>
          </View>
        ) : null}

        {mode === "play" && phase === "done" ? (
          <View style={styles.overlay}>
            <Text style={styles.overlayTitle}>{`${accuracy}% accurate`}</Text>
            <Text style={styles.overlayHint}>
              {`${stats.hits} of ${lane.length} notes · ${stats.perfects} perfect · best combo ${stats.bestCombo}`}
            </Text>
            <Text style={styles.finalScore}>{stats.score}</Text>
            <View style={styles.overlayRow}>
              <Button label="Play again" icon="refresh" onPress={start} style={styles.overlayAction} />
              {/* Offered on a poor run, which is the moment the transcription itself
                  is the likely culprit. A mode switch, not a navigation — the piece,
                  the keyboard and the warmed samples are all already here. */}
              {canCorrect && accuracy < POOR_ACCURACY ? (
                <Button
                  label="Fix it on the piano"
                  variant="secondary"
                  icon="create-outline"
                  onPress={() => {
                    setSelected(null);
                    setModeState("correct");
                  }}
                  style={styles.overlayAction}
                />
              ) : null}
              <Button
                label="Done"
                variant="ghost"
                onPress={() => nav.goBack()}
                style={styles.overlayAction}
              />
            </View>
          </View>
        ) : null}

        {error !== null ? (
          <View style={styles.errorBar} pointerEvents="none">
            <Text style={styles.errorText} numberOfLines={2}>
              {error}
            </Text>
          </View>
        ) : null}

        {/* Rotate prompt. Last, so it sits over the warm-up scrim, and untouchable so
            it can never be the thing standing between a stray tap and the ✕ — which
            is also why it needs no dismiss control of its own. */}
        {rotateHint || windowHeight > windowWidth ? (
          <View style={styles.rotateHint} pointerEvents="none">
            <Ionicons name="phone-landscape-outline" size={16} color={colors.onInk} />
            <Text style={styles.rotateHintText}>Turn your phone sideways to play</Text>
          </View>
        ) : null}
      </View>

      {/* ── Keyboard ────────────────────────────────────────────────────────── */}
      <View style={styles.keyboard}>
        {/* The cards, behind everything: one outline per group of three or four whites,
            with the keys sitting inside rather than each carrying its own border. */}
        {keyGroups.map((g) => (
          <View
            key={`group-${g.x}`}
            style={[styles.keyGroup, { left: g.x, width: g.width }]}
            pointerEvents="none"
          />
        ))}
        {keys
          .filter((k) => !k.black)
          .map((k) => {
            const letter = WHITE_LETTERS[WHITE_STEP_OF_SEMITONE[k.midi % 12] ?? 0] ?? "C";
            const octaveUp = Math.floor((k.midi - lowMidi) / 12);
            return (
              <PianoKey
                key={k.midi}
                layout={k}
                label={`${letter}${"↑".repeat(octaveUp)}`}
                labelColor={pitchColor(letter, themeMode)}
                onDown={pressKey}
                onUp={releaseKey}
                styles={styles}
              />
            );
          })}
        {keys
          .filter((k) => k.black)
          .map((k) => {
            const sp = spell(k.midi, metrics.key);
            const glyph = sp.alter > 0 ? "♯" : sp.alter < 0 ? "♭" : "";
            const letter = WHITE_LETTERS[sp.letter] ?? "C";
            return (
              <PianoKey
                key={k.midi}
                layout={k}
                label={k.width >= 18 ? `${letter}${glyph}` : ""}
                // Its letter's colour, exactly as a white key's is: the label is what
                // pairs a key with its chip on the stave, and a black key is no less an
                // E for being black. The dark-palette value in either theme, because a
                // black key is dark in both — this is the one place the colour must not
                // swing with the canvas.
                labelColor={pitchColor(letter, "dark")}
                onDown={pressKey}
                onUp={releaseKey}
                styles={styles}
              />
            );
          })}

        {/* Window shifters. Only in the hand-scrolled modes: play mode folds
            out-of-range notes onto the keys that are already there, so there is
            nothing off-screen for a shifter to go and get. */}
        {editing ? (
          <View style={styles.shifters} pointerEvents="box-none">
            <Touchable
              onPress={() => setOctaveShift((s) => s - 1)}
              style={styles.shifter}
              radius={radii.pill}
              accessibilityLabel="Shift the keyboard down an octave"
              accessibilityRole="button"
            >
              <Ionicons name="chevron-back" size={16} color={colors.accent} />
            </Touchable>
            <Touchable
              onPress={() => setOctaveShift((s) => s + 1)}
              style={styles.shifter}
              radius={radii.pill}
              accessibilityLabel="Shift the keyboard up an octave"
              accessibilityRole="button"
            >
              <Ionicons name="chevron-forward" size={16} color={colors.accent} />
            </Touchable>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

// ─── One key ──────────────────────────────────────────────────────────────────

/**
 * Its own component so the press ripple is local state: a `pressed` set on the
 * screen would re-render all forty-odd keys on every tap, and the stave with them.
 */
function PianoKey({
  layout,
  label,
  labelColor,
  onDown,
  onUp,
  styles,
}: {
  layout: KeyLayout;
  label: string;
  labelColor: string;
  onDown: (midi: number) => void;
  onUp: (midi: number) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [down, setDown] = useState(false);
  return (
    <Touchable
      onPressIn={() => {
        setDown(true);
        onDown(layout.midi);
      }}
      onPressOut={() => {
        setDown(false);
        onUp(layout.midi);
      }}
      haptic="none"
      ripple={false}
      // No scale: a key that shrinks opens a gap to its neighbours, and on a
      // keyboard that reads as the instrument coming apart rather than as feedback.
      scaleTo={1}
      style={[
        layout.black ? styles.blackKey : styles.whiteKey,
        !layout.black && !layout.endsGroup && styles.whiteKeyDivider,
        { left: layout.x, width: layout.width },
      ]}
      accessibilityLabel={noteNameOf(layout.midi)}
      accessibilityRole="button"
    >
      {down ? (
        <View
          style={[
            styles.halo,
            {
              width: layout.width * 1.6,
              height: layout.width * 1.6,
              borderRadius: layout.width * 0.8,
              backgroundColor: labelColor,
            },
          ]}
          pointerEvents="none"
        />
      ) : null}
      <Text style={[styles.keyLabel, { color: labelColor }]} numberOfLines={1}>
        {label}
      </Text>
    </Touchable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // The keyboard is full-bleed, so the shell's padding goes and the bars put
    // their own back.
    content: { paddingHorizontal: 0, paddingBottom: 0 },

    topBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xs,
    },
    iconButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
    headerText: { flex: 1, flexShrink: 1 },
    title: { ...typography.label, color: c.text },
    subtitle: { ...typography.caption, color: c.textMuted },

    scoreBox: { alignItems: "flex-end", minWidth: 56 },
    score: { ...typography.heading, color: c.accent },
    combo: { ...typography.caption, color: c.gold },

    saveButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm - 2,
      borderRadius: radii.pill,
      backgroundColor: c.ink,
    },
    saveLabel: { ...typography.caption, color: c.onAccent },

    // Free play's compact controls. A scroller rather than a picker: re-keying is a
    // re-label, never a re-transcribe, so trying one costs nothing and browsing them
    // is the fastest way to find the one that fits what you are playing.
    keyRow: { alignItems: "center", gap: spacing.xs, paddingRight: spacing.xs },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    chipOn: { backgroundColor: c.ink, borderColor: c.ink },
    chipText: { ...typography.caption, color: c.textMuted },
    chipTextOn: { color: c.onAccent },
    stepper: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.xs,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    stepperButton: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
    stepperValue: { ...typography.caption, color: c.text, minWidth: 56, textAlign: "center" },

    progressTrack: {
      height: 4,
      backgroundColor: c.surfaceAlt,
      overflow: "hidden",
    },
    // Play mode slides a full-width fill in from the left under the clip, rather
    // than animating a width: a percentage cannot be driven from the UI thread.
    progressFill: { height: 4, backgroundColor: c.success },

    staveArea: {
      flex: 1,
      minHeight: 0,
      overflow: "hidden",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    staveScroll: { alignItems: "center" },
    staveTrack: { height: STAFF_HEIGHT, justifyContent: "center" },
    /** Where a note counts, in play mode. */
    playhead: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: 3,
      borderRadius: 2,
      backgroundColor: c.gold,
    },

    overlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.xl,
      gap: spacing.xs,
      backgroundColor: c.scrim,
    },
    overlayTitle: { ...typography.heading, color: c.text, textAlign: "center" },
    overlayHint: { ...typography.caption, color: c.textMuted, textAlign: "center" },
    overlayButton: { marginTop: spacing.sm, minWidth: 200 },
    overlayRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    overlayAction: { flexShrink: 1 },
    countIn: { ...typography.hero, fontSize: 72, color: c.accent },
    finalScore: { ...typography.title, color: c.accent },

    errorBar: {
      position: "absolute",
      left: spacing.lg,
      right: spacing.lg,
      bottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.md,
      backgroundColor: c.dangerSoft,
      borderWidth: 1,
      borderColor: c.dangerBorder,
    },
    errorText: { ...typography.caption, color: c.danger },

    rotateHint: {
      position: "absolute",
      top: spacing.sm,
      left: spacing.lg,
      right: spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radii.pill,
      // Inverted rather than tinted: it has to be legible over the warm-up scrim in
      // both palettes, and the scrim already darkens whatever is under it.
      backgroundColor: c.ink,
    },
    rotateHintText: { ...typography.caption, color: c.onInk },

    keyboard: { height: WHITE_KEY_HEIGHT, position: "relative" },
    /**
     * The card behind a group of whites, and the keyboard's only outline. Bordering
     * every key instead would draw ten boxes where a player sees three landmarks.
     */
    keyGroup: {
      position: "absolute",
      top: 0,
      height: WHITE_KEY_HEIGHT,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.md,
    },
    whiteKey: {
      position: "absolute",
      top: 0,
      height: WHITE_KEY_HEIGHT,
      // No fill and no border: the card behind supplies both, which leaves a key as a
      // touch target with a label. No `overflow: hidden` either, so the press halo
      // stays the circle it is drawn as instead of being clipped into a pill.
      backgroundColor: "transparent",
      alignItems: "center",
      justifyContent: "flex-end",
      paddingBottom: spacing.md,
    },
    /** Hairline between two whites inside a card; the last of a card draws none. */
    whiteKeyDivider: {
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: c.border,
    },
    blackKey: {
      position: "absolute",
      top: 0,
      height: BLACK_KEY_HEIGHT,
      zIndex: 2,
      backgroundColor: c.ink,
      borderRadius: radii.sm,
      alignItems: "center",
      justifyContent: "flex-end",
      paddingBottom: spacing.sm,
      // Raised, because a black key is raised. Without it the blacks read as holes
      // cut in the card rather than as keys sitting on top of it.
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 4,
    },
    keyLabel: { fontFamily: fonts.bold, fontSize: 16 },
    /** The press ripple, in the key's own colour so it names the note it played. */
    halo: { position: "absolute", bottom: -8, opacity: 0.24 },

    shifters: {
      position: "absolute",
      top: -spacing.xxl,
      left: spacing.md,
      right: spacing.md,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    shifter: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
  });
