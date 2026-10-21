import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Icon, type IconName } from "../components/Icon";
import { usePreventRemove } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Ellipse } from "react-native-svg";
import { Screen } from "../components/Screen";
import { KeyboardAvoider } from "../components/KeyboardAvoider";
import { Button } from "../components/Button";
import { Touchable } from "../components/Touchable";
import { TextField } from "../components/TextField";
import { NoteEditor } from "../components/NoteEditor";
import { SingAlong } from "../components/SingAlong";
import { Mark } from "../components/night/NightUI";
import { GuestAccountCard } from "../components/GuestAccountCard";
import { GUEST_MAX_SECONDS } from "../lib/guestPreview";
import ScoreView, { type ScoreViewHandle } from "../components/ScoreView";
import { SheetGrid, barOf } from "../components/result/SheetGrid";
import { PlayerDock, DOCK_CLEARANCE } from "../components/result/PlayerDock";
import { RehearseView } from "../components/result/RehearseView";
import { PracticeView } from "../components/result/PracticeView";
import { Segmented } from "../components/result/Segmented";
import { DohPicker } from "../components/result/DohPicker";
import { LayoutMenu, type LayoutSamples } from "../components/result/LayoutMenu";
import { usePractice } from "../components/result/usePractice";
import { DohToast } from "../components/doh/DohToast";
import { firstCelebration } from "../lib/dohPrefs";
import { libraryApi, transcriptionsApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import type { ChordSymbol, HymnCredit, KeyAlternative, NoteEvent, TranscriptionPart, TranscriptionResult } from "../api/types";
import { chordRows } from "../lib/chordRow";
import { dohChoices, writeInKey } from "../lib/dohChoice";
import { hymnbookSheet, hymnCreditLine, hymnLabel, hymnOffer, type HymnbookSheet } from "../lib/hymnbook";
import { showDialog, type DialogAction } from "../lib/dialog";
import { showToast } from "../lib/toast";
import { useSubscription } from "../lib/subscription";
import {
  ascendingFlags,
  deriveSolfa,
  dohHeader,
  dohLetter,
  dohPitchClass,
  parseKey,
  partReference,
  referenceDoh,
  renderSolfaLines,
  sameKey,
  syllable,
} from "../lib/solfa";
import { buildMusicXml, resolveKeySignature } from "../lib/musicxml";
import { midiBase64 } from "../lib/midi";
import { synthesizeMelodyWavBase64, synthesizeVoicesWavBase64 } from "../lib/synth";
import { hymnRows, lyricsUnderNotes, pitchName, rangeReport, shiftKeyName, VOICES, type VoiceName } from "../lib/choir";
import { stopAudition } from "../lib/audition";
import { sectionOf } from "../lib/clipRange";
import { choosePart, defaultRange, levels, partsOf, practiceTempo, speedsFor, type Balance } from "../lib/practice";
import { logAnalyticsEvent } from "../lib/analytics";
import { isNetworkCode } from "../lib/reachability";
import { useOfflineLibrary } from "../lib/offlineLibrary";
import { takeOpened } from "../lib/outbox";
import { linkJobStore } from "../lib/linkJobStore";
import { savedToastBody, SHARING_STOPPED, takeKind, worthAListenLine } from "../lib/savedSheet";
import { askToDelete, deleteSheets, keepSheetOffline, renameSheet, shareSheetLinks } from "../lib/sheetActions";
import { transposeLocally } from "../lib/localTranspose";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { rating } from "../lib/rating";
import { exportMidi, exportMusicXml, exportPdf, exportSolfa } from "../lib/export";
import type { HeldChange } from "../lib/heldChange";
import { holdWithUndo, type Held } from "../lib/heldChangeRuntime";
import { deletedLine, dohNowLine, HYMNBOOK_IN_LINE, movedLine } from "../lib/undoWords";
import { openingBars } from "../lib/solfaOpening";
import { firstBarOf, firstBarSyllables, firstHymnBar, layoutName, type SolfaLayout } from "../lib/readingLayouts";
import {
  fonts,
  motion,
  radii,
  spacing,
  typography,
  type Palette,
} from "../design/theme";
import { ThemeOverride, useColors, useThemedStyles } from "../lib/theme";
import { confidenceLevel, confidenceNote } from "../lib/confidence";
import * as haptics from "../lib/haptics";
import type { RootStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "Result">;

/**
 * The working note list, plus each entry's index in the pristine list from the
 * route params. Held as one value so the two can never drift: a delete removes
 * from both, which is what lets "Revert" still find the right original after one.
 */
interface Draft {
  notes: NoteEvent[];
  origins: number[];
}

const pristine = (notes: NoteEvent[]): Draft => ({
  notes,
  origins: notes.map((_, i) => i),
});

/**
 * Threads a note list the piano handed back onto the draft it was given.
 *
 * `origins` is what lets "Revert" find a note's pristine pitch, so a list corrected on
 * another screen cannot simply replace `notes` — the two halves would drift the moment
 * the piano deleted anything. Correcting a note never moves it in time and deleting one
 * never reorders the rest, so walking both lists by onset recovers the mapping.
 */
function realign(next: NoteEvent[], from: Draft): Draft {
  const last = from.origins.length - 1;
  const origins: number[] = [];
  let j = 0;
  for (const n of next) {
    while (j < last && from.notes[j]!.startBeat < n.startBeat) j++;
    origins.push(from.origins[Math.min(j, last)]!);
    j++;
  }
  return { notes: next, origins };
}

type Parts = NonNullable<TranscriptionResult["parts"]>;

/**
 * Everything another doh, the hymnbook version or a transposition rewrites. Each is shown at once with an Undo toast
 * (board m-ux-medium P1e), and Undo puts back exactly this.
 */
interface SheetState {
  baseline: { notes: NoteEvent[]; key: string; solfaLines: string[] };
  draft: Draft;
  persisted: Draft;
  key: string;
  timeSignature: string;
  tempo: number;
  lyrics: string;
  chords: ChordSymbol[] | null;
  parts: Parts | null;
  partsMusicXml: string;
  preview: string;
  doubt: KeyAlternative[];
  hymnSource: HymnCredit | null;
  hymnAnswered: boolean;
}

/**
 * A part's solfa lines for a key. The worker labels the parts it returns; a saved sheet
 * (and a transposed one) comes back with pitches only, so the lines are made here. The
 * octave marks are relative to the soprano's reference doh (`partReference`: the melody's
 * when there is no soprano), as the worker does it, so a bass "d," sits where the tune's "d" does.
 */
function partLines(
  name: VoiceName,
  part: TranscriptionPart,
  reference: readonly NoteEvent[],
  keyText: string,
  timeSignature: string,
): string[] {
  if (part.solfaLines.length > 1) return part.solfaLines;
  const key = parseKey(keyText);
  if (!key || part.notes.length === 0) return [];
  const labelled = labelPart(part.notes, reference, keyText);
  return renderSolfaLines(labelled, `${dohHeader(dohPitchClass(key))} · ${name[0]!.toUpperCase()}${name.slice(1)}`, timeSignature);
}

/** A part's notes, each with its syllable for the key, octave marks from the reference's doh. */
function labelPart(notes: readonly NoteEvent[], reference: readonly NoteEvent[], keyText: string): NoteEvent[] {
  const key = parseKey(keyText);
  if (!key || notes.length === 0) return [...notes];
  const pc = dohPitchClass(key);
  const refDoh = referenceDoh(reference.map((n) => n.pitchMidi), pc, key.mode);
  const flags = ascendingFlags(notes.map((n) => n.pitchMidi), pc);
  return notes.map((n, i) => ({ ...n, ...syllable(n.pitchMidi, pc, refDoh, flags[i]!) }));
}

/** How many bars the tune spans — what the passage loop counts in. */
function barCountOf(notes: readonly NoteEvent[], timeSignature: string): number {
  if (notes.length === 0) return 0;
  const [num, den] = timeSignature.split("/").map(Number);
  const barBeats = num && den ? (num * 4) / den : 4;
  const end = Math.max(...notes.map((n) => n.startBeat + Math.max(0, n.durBeats)));
  return Math.max(1, Math.ceil(end / barBeats - 1e-9));
}

// ─── Component ────────────────────────────────────────────────────────────────

const PROVIDERS: Record<string, string> = { youtube: "YouTube", spotify: "Spotify", apple_music: "Apple Music" };

/** The space between a guest's "Keep this sheet" card and the player above it. */
const KEEP_GAP = 8;

/** Long enough for one full-screen modal to leave before the next is shown (iOS presents one at a time). */
const MODAL_HANDOVER_MS = 400;

/** The player dock's height before it has been laid out: play (44) in 12 px of padding, and its border. */
const DOCK_HEIGHT_GUESS = 70;
/** Save to Library floats this far over the dock, and the sheet's end leaves room for it (48 + 12). */
const SAVE_PILL_GAP = 12;
const SAVE_PILL_ROOM = 48 + SAVE_PILL_GAP;

type Panel = "transpose" | "lyrics" | "parts" | "sing" | "export";

/** The part a singer practised last on this device; Learn my part opens on it when the sheet has it. */
const PRACTICE_PART_KEY = "nf.practice.part";
type SolfaStyle = SolfaLayout;
/** The way of reading a sheet chosen last on this device; every sheet opens on it. */
const NOTATION_VIEW_KEY = "nf.result.view";
const NOTATION_VIEWS: readonly string[] = ["bars", "grid", "curwen", "hymn", "staff"];

/**
 * ResultScreen — the sheet (night board 04) and, over it, Rehearse (05).
 *
 * Layout (top → bottom):
 *   • Round back / share / save buttons; the sheet's name large, a muted line
 *     under it (artist, section, key) and the song's credit when it has one.
 *   • One row of the numbers that matter — DOH, BPM, TIME. DOH opens the doh picker
 *     (a sheet of the twelve dohs), BPM and TIME their pickers beneath the row.
 *   • One amber row when the model doubted some notes — the way into a review — and
 *     the round actions — transpose, lyrics, SATB, sing, export, more — each opening
 *     its panel below the row. Above the notation, so they are on the first screen
 *     however long the sheet is (board m-ux-medium P1c).
 *   • Solfa | Staff, and the Layout button naming the solfa layout in use (board
 *     n-ux-low Q1a–b). The notation: a bar to a row, a syllable to a beat, the words
 *     beneath, the mark faint behind it. The same note list can be read as the text
 *     grid, as Curwen, as a hymn layout or on the stave. Every syllable opens the editor.
 *   • The player docked over the bottom; its Practise opens Learn my part (Rehearse on a sheet without parts).
 *
 * PRD honesty rule: the SURE figure is always visible and coloured by level, and
 * low-confidence notes are amber with a dotted underline so users double-check.
 *
 * A guest's preview (`guest`, board l-ux-high/07) is the same sheet, only read: × closes it, the figures and the
 * ways to read it stay, the player plays it, and "Keep this sheet" is pinned under the player in place of
 * everything an account brings (save, share, export, parts, edits).
 */
export function ResultScreen({ route, navigation }: Props) {
  const {
    result,
    sourceJobId,
    savedId: initialSavedId,
    title: initialTitle,
    fresh,
    practise,
    guest,
  } = route.params;

  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { isPro, subscription, refresh: refreshSubscription } = useSubscription();
  /** A free account's one four-part harmony, until it is used; the API decides, this mirrors it. */
  const freeHarmony = !isPro && !!subscription?.freeHarmonyAvailable;

  const [title, setTitle] = useState(
    initialTitle ?? `${result.key} · ${new Date().toLocaleDateString()}`,
  );
  const [committedTitle, setCommittedTitle] = useState(initialTitle);
  const [savedId, setSavedId] = useState<string | undefined>(initialSavedId);
  /**
   * Opened straight from its finished job, which the server filed in the Library as it finished (option A,
   * board 12): the sheet is already theirs, so Save is Rename and every choice made here is saved as it is made.
   */
  const autoSaved = !!fresh && !!initialSavedId;
  /**
   * Set when a saved sheet was transposed, or given another doh, on the phone while offline: the screen then shows
   * notes the server does not have, so note corrections and parts are not saved from it (they would store moved
   * pitches under the old key). Opening the sheet again, or transposing it online, clears it.
   */
  const movedOffline = useRef(false);
  function blockedByLocalTranspose(): boolean {
    if (!movedOffline.current) return false;
    showDialog({
      title: "Changed on this phone only",
      message: "This sheet was changed while you were offline, so changes to it here aren't saved. Open it again from your Library to edit it.",
      icon: "offline",
    });
    return true;
  }
  /** A change that could not be saved, said plainly, with Try again beside OK rather than OK alone. */
  function failedWithRetry(title: string, e: unknown, retry: () => void) {
    showDialog({
      title,
      message: toApiError(e).message,
      icon: "problem",
      tone: "danger",
      actions: [
        { label: "OK", style: "cancel" },
        { label: "Try again", onPress: retry },
      ],
    });
  }
  /** Which saved sheets are kept on the phone ("Keep offline", or keep-all in Settings). */
  const offlineCopies = useOfflineLibrary();
  const [saving, setSaving] = useState(false);
  /** The player dock's height, so Save to Library floats 12 px over it. */
  const [dockHeight, setDockHeight] = useState(DOCK_HEIGHT_GUESS);
  const [renaming, setRenaming] = useState(false);
  const [exportingType, setExportingType] = useState<"musicxml" | "solfa" | "midi" | "pdf" | null>(null);
  const scoreRef = useRef<ScoreViewHandle>(null);
  /** The acknowledgement for a linked song; null for a recording. */
  const provider = result.source ? (PROVIDERS[result.source.provider] ?? result.source.provider) : null;
  const credit = result.source
    ? `${result.source.title}${result.source.artist ? ` — ${result.source.artist}` : ""} (${provider})`
    : null;
  /** "1:05–1:35 of 3:33" when a section of the song was chosen; null for the whole song or a recording. */
  const section = result.source ? sectionOf(result.source) : null;

  // ── Key override (F-03) ────────────────────────────────────────────────────
  // Solfa is movable-do, so a key change re-labels the existing notes — it
  // never re-transcribes. The syllables update locally the instant the user
  // taps, and the choice is persisted only for transcriptions already saved.
  const [key, setKey] = useState(result.key);
  const [pickingKey, setPickingKey] = useState(false);
  const [rekeying, setRekeying] = useState(false);
  /**
   * When the worker was unsure of the doh: the other keys the voice fits nearly as well, each with
   * the notes written in its scale. Asked once, on the sheet as it came back; answering, re-keying,
   * transposing or correcting a note puts the question away.
   */
  const [doubt, setDoubt] = useState<KeyAlternative[]>(() =>
    dohChoices(result.key, result.notes, result.keyAlternatives, (k) => {
      const parsed = parseKey(k);
      return parsed ? dohPitchClass(parsed) : null;
    }),
  );

  /**
   * "Is this Amazing Grace? Use the hymnbook version." The worker recognised a hymn we hold; the match
   * carries its published score in the key that was sung. Asked once, before saving; taking it makes the
   * sheet the hymnbook version, and `hymnSource` then credits it (on a saved sheet, from the library).
   */
  const [hymnAnswered, setHymnAnswered] = useState(false);
  const [hymnSource, setHymnSource] = useState<HymnCredit | null>(result.hymn ?? null);

  // ── Transpose for my choir ────────────────────────────────────────────────
  // The one edit that moves the notes. After it, the *baseline* the corrections are
  // judged against is the transposed sheet, not the worker's — otherwise every note
  // would count as a correction and "Discard" would silently undo the transposition.
  const [baseline, setBaseline] = useState<{ notes: NoteEvent[]; key: string; solfaLines: string[] }>({
    notes: result.notes,
    key: result.key,
    solfaLines: result.solfaLines,
  });
  const [semitones, setSemitones] = useState(0);
  const [transposing, setTransposing] = useState(false);
  const [parts, setParts] = useState<Parts | null>(result.parts ?? null);
  const [partsMusicXml, setPartsMusicXml] = useState(result.partsMusicXml ?? "");
  const [harmonising, setHarmonising] = useState(false);
  /** The chords heard under the tune (chords mode, songs with accompaniment); transposed with it. */
  const [chords, setChords] = useState<ChordSymbol[] | null>(result.chords?.length ? result.chords : null);

  // ── Rehearsal mix ─────────────────────────────────────────────────────────
  const [voiceOn, setVoiceOn] = useState<Record<VoiceName, boolean>>({ soprano: true, alto: true, tenor: true, bass: true });

  // ── Learn my part ─────────────────────────────────────────────────────────
  // While it is open the player sounds every part at the practice levels and the practice speed
  // (lib/practice.ts); closing it gives the player back to the mix above.
  const [practising, setPractising] = useState(false);
  const [practicePart, setPracticePart] = useState<VoiceName>("soprano");
  const [practiceBalance, setPracticeBalance] = useState<Balance>("balance");
  const [practiceSpeed, setPracticeSpeed] = useState(1);
  /** The loop starts on its default the first time only; Rehearse's speed comes back on close. */
  const practiceSeen = useRef(false);
  const rateBeforePractice = useRef(1);

  // ── Lyrics & sharing ─────────────────────────────────────────────────────
  const [lyrics, setLyrics] = useState(result.lyrics ?? "");
  const committedLyrics = useRef(result.lyrics ?? "");
  const [shareToken, setShareToken] = useState<string | null>(result.shareToken ?? null);
  const [sharing, setSharing] = useState(false);
  const [tempo, setTempo] = useState(result.tempo);
  const [pickingTempo, setPickingTempo] = useState(false);
  const [timeSignature, setTimeSignature] = useState(result.timeSignature);
  const [pickingMeter, setPickingMeter] = useState(false);

  // Solfa is the product's headline output; the stave is the familiar cross-check.
  // Both read from the same `view.notes`, so a key change relabels one and
  // re-places the other from the identical data.
  const [notationView, setNotationView] = useState<"solfa" | "staff">("solfa");

  // ── Tap-to-correct (F-07) ──────────────────────────────────────────────────
  // The note list is the source of truth for both notation views and for
  // playback, so a correction lives here and everything downstream re-derives
  // from it. Route params keep the pristine list, which is what makes discarding
  // free — nothing has to be re-fetched to get back to the model's version.
  const [draft, setDraft] = useState<Draft>(() => pristine(result.notes));
  /** Index being edited; `null` closes the sheet. */
  const [editing, setEditing] = useState<number | null>(null);
  /** Frozen when a guided review starts, so fixing a note doesn't reshuffle the path. */
  const [reviewQueue, setReviewQueue] = useState<number[] | null>(null);
  /** Last draft the server acknowledged — the rollback target if a correction fails to save. */
  const persisted = useRef<Draft>(draft);
  /**
   * Synthesised melody for the player; re-made when the notes change. Always rendered
   * here, never the server's `audioPreviewBase64`: that is the old additive voice, and
   * the piano must not change underfoot between the first play and the first edit.
   */
  const [preview, setPreview] = useState(() => synthesizeMelodyWavBase64(result.notes, result.tempo));

  // Counts deletions as well as pitch changes: both are corrections the exported
  // score doesn't know about, and both are what "Discard" would undo. Zero means
  // the list is byte-for-byte the model's, even if the user has been busy.
  const correctedCount = useMemo(
    () =>
      draft.notes.filter((n, i) => n !== baseline.notes[draft.origins[i]]).length +
      (baseline.notes.length - draft.notes.length),
    [draft, baseline.notes],
  );
  const edited = correctedCount > 0;
  const hymnAsk = edited
    ? null
    : hymnOffer(result.hymnMatch, { saved: !!savedId && !autoSaved, answered: hymnAnswered || !!hymnSource, hasParts: !!parts });

  /** How the tune starts in each doh on offer: the rewrite a tap on it makes (board m-ux-medium P1e). */
  const dohPreviews = useMemo(
    () =>
      doubt.map((choice) => ({
        choice,
        opening: openingBars(
          deriveSolfa(writeInKey(baseline.notes, choice), choice.key, timeSignature, result.chromaticSpelling ?? "direction").notes,
          timeSignature,
        ),
      })),
    [doubt, baseline.notes, timeSignature, result.chromaticSpelling],
  );

  const [solfaStyle, setSolfaStyle] = useState<SolfaStyle>("bars");
  /** The Layout menu (board n-ux-low Q1b) is open. */
  const [choosingLayout, setChoosingLayout] = useState(false);
  /** A reading chosen on this visit, which the remembered one arriving late must not undo. */
  const viewChosen = useRef(false);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(NOTATION_VIEW_KEY)
      .then((v) => {
        if (!live || viewChosen.current || !v || !NOTATION_VIEWS.includes(v)) return;
        if (v === "staff") setNotationView("staff");
        else setSolfaStyle(v as SolfaStyle);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const hasLyrics = lyrics.trim().length > 0;
  useEffect(() => {
    if (!hasLyrics && solfaStyle === "hymn") setSolfaStyle("grid");
  }, [hasLyrics, solfaStyle]);

  // The server already labelled the original key, so trust its output until
  // the user actually overrides — that keeps the fresh-transcription path
  // byte-identical to what the worker produced.
  const view = useMemo(() => {
    const derived = deriveSolfa(
      draft.notes,
      key,
      timeSignature,
      result.chromaticSpelling ?? "direction",
    );
    if (key === baseline.key && timeSignature === result.timeSignature && !edited) {
      return {
        notes: baseline.notes,
        solfaLines: baseline.solfaLines,
        curwenLines: derived.curwenLines,
      };
    }
    return derived;
  }, [
    draft.notes,
    edited,
    key,
    baseline,
    result.timeSignature,
    timeSignature,
    result.chromaticSpelling,
  ]);

  const hymn = useMemo(
    () => (hasLyrics ? hymnRows(view.notes, lyrics, timeSignature) : []),
    [hasLyrics, view.notes, lyrics, timeSignature],
  );

  /** Each layout's sample in the Layout menu: the tune's own first bar as that layout writes it. */
  const layoutSamples = useMemo<LayoutSamples>(() => {
    const bar = (solfa: string | null) => (solfa ? { solfa } : null);
    return {
      bars: bar(firstBarSyllables(view.notes, timeSignature)),
      grid: bar(firstBarOf(view.solfaLines)),
      curwen: bar(firstBarOf(view.curwenLines)),
      hymn: hasLyrics ? firstHymnBar(hymn) : null,
    };
  }, [view, timeSignature, hasLyrics, hymn]);

  /** "Use the hymnbook version?": the take's opening and the hymnbook's, each in its own meter. */
  const hymnPreview = useMemo(() => {
    if (hymnAsk !== "version" || !result.hymnMatch) return null;
    const sheet = hymnbookSheet(result.hymnMatch, tempo);
    if (!sheet) return null;
    const book = deriveSolfa(sheet.notes, sheet.key, sheet.timeSignature, result.chromaticSpelling ?? "direction").notes;
    return {
      yours: openingBars(view.notes, timeSignature),
      yoursMeter: timeSignature,
      book: openingBars(book, sheet.timeSignature),
      bookMeter: sheet.timeSignature,
    };
  }, [hymnAsk, result.hymnMatch, result.chromaticSpelling, tempo, view.notes, timeSignature]);

  /** The parts' solfa lines, labelled for the current key. */
  const partsView = useMemo(() => {
    if (!parts) return null;
    const out: { name: VoiceName; part: TranscriptionPart; lines: string[] }[] = [];
    const reference = partReference(parts, view.notes);
    for (const name of VOICES) {
      const part = parts[name];
      if (part) out.push({ name, part, lines: partLines(name, part, reference, key, timeSignature) });
    }
    return out.length > 0 ? out : null;
  }, [parts, view.notes, key, timeSignature]);

  const barCount = useMemo(() => barCountOf(view.notes, timeSignature), [view.notes, timeSignature]);
  const hasParts = !!partsView;

  /** The syllable each note carries, for the sheet and for Rehearse's line of words. */
  const lyricsUnder = useMemo(
    () => (hasLyrics ? lyricsUnderNotes(view.notes, lyrics) : null),
    [hasLyrics, view.notes, lyrics],
  );

  // ── Layout state for the sheet's surfaces ───────────────────────────────────
  // One panel under the action row at a time; parts heard from a choir open on
  // arrival, since they are half of what was transcribed.
  const [panel, setPanel] = useState<Panel | null>(result.parts && !guest ? "parts" : null);
  const [naming, setNaming] = useState(false);
  const [rehearsing, setRehearsing] = useState(false);
  /** A guest's "Keep this sheet" card, pinned under the player: its height lifts the dock and the sheet's end. */
  const [keepHeight, setKeepHeight] = useState(0);

  // The rehearsal mix: the tune plus whichever parts are switched on, re-rendered when
  // any of them changes. Without parts the player keeps the melody preview above.
  useEffect(() => {
    if (!hasParts || !parts) return;
    if (practising) {
      // My part at its own level, the others by the balance; slower is the notes played slower.
      const lv = levels(partsOf(parts), practicePart, practiceBalance);
      const mix = partsOf(parts)
        .filter((v) => lv[v]! > 0)
        .map((v) => ({ notes: v === "soprano" ? partReference(parts, view.notes) : parts[v]!.notes, gain: (v === "soprano" ? 1 : 0.8) * lv[v]! }));
      try {
        setPreview(synthesizeVoicesWavBase64(mix, practiceTempo(tempo, practiceSpeed)));
      } catch {
        // preview synthesis is non-fatal
      }
      return;
    }
    // The tune is the soprano: the parts' own when written (a man's tune sits an octave up there,
    // over the alto, tenor and bass written for it), the melody otherwise.
    const voices = [{ notes: voiceOn.soprano ? partReference(parts, view.notes) : [], gain: 1 }];
    for (const name of VOICES) {
      if (name === "soprano" || !voiceOn[name] || !parts[name]) continue;
      voices.push({ notes: parts[name].notes, gain: 0.8 });
    }
    try {
      setPreview(synthesizeVoicesWavBase64(voices, tempo));
    } catch {
      // preview synthesis is non-fatal
    }
  }, [hasParts, parts, voiceOn, view.notes, tempo, practising, practicePart, practiceBalance, practiceSpeed]);

  const activeSolfaLines = useMemo(() => {
    return solfaStyle === "curwen" && view.curwenLines.length > 0
      ? view.curwenLines
      : view.solfaLines;
  }, [solfaStyle, view.curwenLines, view.solfaLines]);

  // The chords, with each root's syllable read in the key on screen: a key override relabels the
  // solfa under a chord exactly as it relabels the tune (the letter name stays — the sound did not move).
  const chordView = useMemo(() => {
    if (!chords) return null;
    const parsed = parseKey(key);
    const dohPc = parsed ? dohPitchClass(parsed) : null;
    return chords.map((ch) => ({
      ...ch,
      solfa: dohPc === null ? ch.solfa : syllable(60 + ch.root, dohPc, 60).solfa,
    }));
  }, [chords, key]);

  /** One chord line per grid solfa line, character-aligned with the bars below. Grid layout only. */
  const chordLines = useMemo(
    () => (chordView && solfaStyle === "grid" ? chordRows(chordView, view.solfaLines, timeSignature) : null),
    [chordView, solfaStyle, view.solfaLines, timeSignature],
  );

  const lowCount = useMemo(
    () => view.notes.filter((n) => n.conf < 0.5).length,
    [view.notes],
  );

  // One player for the dock and Rehearse; the note it reports drives the sheet's
  // highlight and the stave's cursor.
  const practice = usePractice(
    preview,
    view.notes,
    practising ? practiceTempo(tempo, practiceSpeed) : tempo,
    timeSignature,
    barCount,
  );

  /** The parts Learn my part offers, each labelled from the soprano's doh, as the parts panel is. */
  const practiceParts = useMemo(() => {
    if (!parts) return null;
    const reference = partReference(parts, view.notes);
    const out: Partial<Record<VoiceName, NoteEvent[]>> = {};
    for (const v of partsOf(parts)) out[v] = labelPart(v === "soprano" ? reference : parts[v]!.notes, reference, key);
    return out;
  }, [parts, view.notes, key]);

  async function openPractice() {
    let remembered: string | null = null;
    try {
      remembered = await AsyncStorage.getItem(PRACTICE_PART_KEY);
    } catch {
      // unreadable: the tune is the default
    }
    setPracticePart(choosePart(parts ? partsOf(parts) : ["soprano"], remembered));
    if (!practiceSeen.current) {
      practiceSeen.current = true;
      const range = defaultRange(barCount);
      practice.setLoopFrom(range.from);
      practice.setLoopTo(range.to);
    }
    rateBeforePractice.current = practice.rate;
    practice.pause();
    practice.setRate(1);
    practice.setLoopOn(true);
    setPractising(true);
    void logAnalyticsEvent("practice_started");
  }

  function closePractice() {
    practice.pause();
    practice.setLoopOn(false);
    practice.setRate(rateBeforePractice.current);
    setPractising(false);
  }

  function choosePracticePart(v: VoiceName) {
    setPracticePart(v);
    AsyncStorage.setItem(PRACTICE_PART_KEY, v).catch(() => undefined);
    void logAnalyticsEvent("practice_part", { part: v });
  }

  /** Marking a take is Pro, as Sing is; practising is free. */
  function practiceUpsell() {
    showDialog({
      title: "Marking your singing is Pro",
      message: "Keep practising free. With Pro, sing your part back and see every note marked: in tune, close, or off.",
      icon: "pro",
      tone: "premium",
      actions: [
        { label: "Not now", style: "cancel" },
        { label: "See Pro plans", onPress: () => navigation.navigate("Upgrade") },
      ],
    });
  }
  /** Note the player is sounding, −1 when stopped. */
  const playingNote = practice.currentNoteIndex;

  /** null parks the cursor off the page, which is what "not playing" should look like. */
  const cursorBeat = view.notes[playingNote]?.startBeat ?? null;

  /**
   * The score as it stands now, for export. `result.musicXml` is the worker's
   * engraving of the *original* transcription, so it knows nothing about a
   * correction or a key override — this is generated from the same note list the
   * stave draws, which is what lets the export claim to match the screen.
   */
  const scoreXml = useMemo(
    () =>
      buildMusicXml(
        view.notes,
        resolveKeySignature(key),
        timeSignature,
        { title: committedTitle || title, lyrics: true },
      ) ?? "",
    [view.notes, key, timeSignature, committedTitle, title],
  );

  // A corrected note is the user's, not the model's, so the headline figure has
  // to move with it — the same mean over the note confidences that the worker
  // reports, rounded the same way, so a corrected result stays comparable.
  const overallConfidence = useMemo(
    () =>
      edited
        ? Math.round(
            (draft.notes.reduce((sum, n) => sum + n.conf, 0) /
              draft.notes.length) *
              1000,
          ) / 1000
        : hymnSource
          ? 1 // the hymnbook version: published notes, nothing in doubt
          : result.overallConfidence,
    [draft.notes, edited, result.overallConfidence, hymnSource],
  );

  // ── Shown at once, sent after its Undo (board m-ux-medium P1e) ──────────────
  /** The sheet as it stands, for an Undo to put back. */
  function sheetState(): SheetState {
    return {
      baseline,
      draft,
      persisted: persisted.current,
      key,
      timeSignature,
      tempo,
      lyrics,
      chords,
      parts,
      partsMusicXml,
      preview,
      doubt,
      hymnSource,
      hymnAnswered,
    };
  }

  function applySheet(next: SheetState) {
    setBaseline(next.baseline);
    setDraft(next.draft);
    persisted.current = next.persisted;
    setKey(next.key);
    setTimeSignature(next.timeSignature);
    setTempo(next.tempo);
    setLyrics(next.lyrics);
    setChords(next.chords);
    setParts(next.parts);
    setPartsMusicXml(next.partsMusicXml);
    setPreview(next.preview);
    setDoubt(next.doubt);
    setHymnSource(next.hymnSource);
    setHymnAnswered(next.hymnAnswered);
  }

  /** The change still held behind its Undo toast, if any. */
  const held = useRef<Held | null>(null);
  function hold(message: string, change: HeldChange, icon: IconName) {
    held.current = holdWithUndo(message, change, icon);
  }
  /**
   * A change still held is sent before anything else on the sheet changes or is saved: its Undo would otherwise take
   * the later edit with it, and its write would land on top of it.
   */
  function settleHeld() {
    held.current?.settle();
    held.current = null;
  }
  // Leaving the screen sends it: an Undo can only put back a sheet that is still open.
  useEffect(() => () => settleHeld(), []);

  /**
   * Saves the sheet to the Library. Resolves to its id, or null when it could not be saved (and the dialog said why).
   * `offerRename`: saved by the one tap on Save to Library, under the title shown, so the toast offers Rename.
   */
  async function save({ offerRename = false }: { offerRename?: boolean } = {}): Promise<string | null> {
    settleHeld();
    setSaving(true);
    try {
      const saved = await libraryApi.save({
        title: title.trim() || `${key} transcription`,
        key,
        tempoBpm: tempo,
        timeSignature,
        musicXml: scoreXml || result.musicXml,
        notes: view.notes,
        overallConfidence,
        sourceJobId,
        lyrics: lyrics.trim(),
        parts: parts ?? undefined,
        partsMusicXml: partsMusicXml || undefined,
        chords: chords ?? undefined,
        hymnSlug: hymnSource?.slug ?? null,
      });
      committedLyrics.current = lyrics.trim();
      setSavedId(saved.id);
      setCommittedTitle(saved.title);
      // Corrections rode along in the payload, so the server is now level with
      // the draft and a later edit only has to send the difference.
      persisted.current = draft;
      // Fired here rather than from the button's press-in: the success pattern
      // means "it happened", and on press-in nothing has happened yet.
      haptics.play("success");
      // The third save may bring the store-rating ask, which says the sheet was saved
      // itself; two sheets stacked on the same moment would be one too many.
      const askingForRating = await rating.recordSave();
      if (!askingForRating)
        showToast(
          "Saved to your Library",
          offerRename ? { action: { label: "Rename", onPress: () => setNaming(true) } } : undefined,
        );
      return saved.id;
    } catch (e) {
      failedWithRetry("Could not save", e, () => void save({ offerRename }));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function applyKey(next: string) {
    settleHeld();
    setPickingKey(false);
    setDoubt([]);
    if (sameKey(next, key)) return;

    const previous = key;
    setKey(next); // re-label immediately — no round-trip needed to read solfa

    if (!savedId) return; // unsaved: the key travels with the save payload
    setRekeying(true);
    try {
      await libraryApi.updateKey(savedId, next);
    } catch (e) {
      if (isNetworkCode(toApiError(e).code)) {
        // Offline: solfa is movable-do, so reading it in another doh needs nothing from the server.
        // The relabel stays on screen; the saved sheet keeps its key until this is done online.
        showDialog({
          title: "You're offline",
          message: `Showing it with doh in ${next} for now. The saved sheet stays in ${previous} — change the key again when you're online to keep it.`,
          icon: "offline",
        });
        return;
      }
      setKey(previous); // the label would otherwise disagree with the server
      failedWithRetry("Could not change key", e, () => void applyKey(next));
    } finally {
      setRekeying(false);
    }
  }

  /**
   * The answer to "which doh is it?". Another doh brings its own pitches — a note the singer left
   * between two scale tones is written as that key's tone — so it is the sheet as heard in that key,
   * not a correction: the baseline moves with it, as it does for a transposition. Shown at once with
   * "Doh is D now · Undo"; a saved sheet is written when the toast leaves, so Undo sends nothing.
   */
  function chooseDoh(choice: KeyAlternative | null) {
    if (!choice) {
      setDoubt([]);
      return;
    }
    settleHeld();
    const before = sheetState();
    const relabelled = deriveSolfa(
      writeInKey(baseline.notes, choice), choice.key, timeSignature, result.chromaticSpelling ?? "direction");
    applySheet({
      ...before,
      baseline: { notes: relabelled.notes, key: choice.key, solfaLines: relabelled.solfaLines },
      draft: pristine(relabelled.notes),
      persisted: pristine(relabelled.notes),
      key: choice.key,
      preview: synthesizeMelodyWavBase64(relabelled.notes, tempo),
      doubt: [],
    });
    haptics.play("success");
    const id = savedId;
    hold(
      dohNowLine(dohLetter(choice.key)),
      {
        commit: async () => {
          if (!id) return; // unsaved: the key and notes travel with the save payload
          setRekeying(true);
          try {
            await libraryApi.updateNotes(id, relabelled.notes);
            await libraryApi.updateKey(id, choice.key);
          } catch (e) {
            if (isNetworkCode(toApiError(e).code)) {
              // Offline, as a re-key: the doh stays on screen, and the saved sheet keeps its own until this is done
              // online. Its notes are now ones the server does not have, so edits here are not saved from it.
              movedOffline.current = true;
              showDialog({
                title: "You're offline",
                message: `Showing it with doh in ${dohLetter(choice.key)} for now. The saved sheet stays with doh in ${dohLetter(before.key)} until you choose again online.`,
                icon: "offline",
              });
              return;
            }
            applySheet(before);
            failedWithRetry("Could not change the doh", e, () => chooseDoh(choice));
          } finally {
            setRekeying(false);
          }
        },
        undo: () => applySheet(before),
      },
      "solfa",
    );
  }

  /**
   * The answer to "Use the hymnbook version?". Yes swaps the sheet for the hymn's published score — its
   * notes, rhythm, time signature and pickup, already in the key that was sung, at the pace it was sung,
   * with the first verse under it when no words were typed. Like another doh, it is the sheet, not a
   * correction: the baseline moves with it. What was read against the old beats (the chords) goes.
   * Shown at once with "Hymnbook version in · Undo"; Undo puts back the take as heard, its chords and the question.
   */
  function chooseHymnbook(take: boolean) {
    const sheet = take && result.hymnMatch ? hymnbookSheet(result.hymnMatch, tempo) : null;
    if (!sheet) {
      setHymnAnswered(true);
      return;
    }
    settleHeld();
    const before = sheetState();
    const relabelled = deriveSolfa(sheet.notes, sheet.key, sheet.timeSignature, result.chromaticSpelling ?? "direction");
    applySheet({
      ...before,
      baseline: { notes: relabelled.notes, key: sheet.key, solfaLines: relabelled.solfaLines },
      draft: pristine(relabelled.notes),
      persisted: pristine(relabelled.notes),
      key: sheet.key,
      timeSignature: sheet.timeSignature,
      tempo: sheet.tempo,
      lyrics: !lyrics.trim() && sheet.lyrics ? sheet.lyrics : lyrics,
      chords: null,
      preview: synthesizeMelodyWavBase64(relabelled.notes, sheet.tempo),
      doubt: [],
      hymnSource: sheet.hymn,
      hymnAnswered: true,
    });
    haptics.play("success");
    // On a sheet already in the Library (filed as its job finished) the swap is saved when the toast leaves: the
    // hymnbook version replaces the filed copy, as a Save of the same job does.
    const id = savedId;
    hold(
      HYMNBOOK_IN_LINE,
      {
        commit: () => (id ? saveHymnbook(sheet, relabelled.notes) : undefined),
        undo: () => applySheet(before),
      },
      "hymns",
    );
  }

  async function saveHymnbook(sheet: HymnbookSheet, notes: NoteEvent[]) {
    const name = committedTitle || title;
    try {
      const saved = await libraryApi.save({
        title: name.trim() || `${sheet.key} transcription`,
        key: sheet.key,
        tempoBpm: sheet.tempo,
        timeSignature: sheet.timeSignature,
        musicXml:
          buildMusicXml(notes, resolveKeySignature(sheet.key), sheet.timeSignature, { title: name, lyrics: true }) ??
          result.hymnMatch?.musicXml ??
          result.musicXml,
        notes,
        overallConfidence: 1,
        sourceJobId,
        lyrics: (lyrics.trim() || sheet.lyrics || "").trim(),
        hymnSlug: sheet.hymn.slug,
      });
      committedLyrics.current = saved.lyrics ?? "";
      setSavedId(saved.id);
      setCommittedTitle(saved.title);
    } catch (e) {
      failedWithRetry("Could not save", e, () => void saveHymnbook(sheet, notes));
    }
  }

  async function handleTempoChange(nextTempo: number) {
    if (nextTempo < 20 || nextTempo > 300 || nextTempo === tempo) return;
    settleHeld();
    const previous = tempo;
    setTempo(nextTempo);
    try {
      setPreview(synthesizeMelodyWavBase64(view.notes, nextTempo));
    } catch {
      // preview synthesis is non-fatal
    }
    if (!savedId) return;
    try {
      await libraryApi.updateTempo(savedId, nextTempo);
    } catch (e) {
      setTempo(previous);
      failedWithRetry("Could not change tempo", e, () => void handleTempoChange(nextTempo));
    }
  }

  async function handleMeterChange(nextMeter: string) {
    if (nextMeter === timeSignature) return;
    settleHeld();
    const previous = timeSignature;
    setTimeSignature(nextMeter);
    setPickingMeter(false);
    if (!savedId) return;
    try {
      await libraryApi.updateTimeSignature(savedId, nextMeter);
    } catch (e) {
      setTimeSignature(previous);
      failedWithRetry("Could not change meter", e, () => void handleMeterChange(nextMeter));
    }
  }

  // ── Tap-to-correct handlers (F-07) ─────────────────────────────────────────

  /** A free tap on any chip. Prev/Next then walk the whole list. */
  function openNote(index: number) {
    settleHeld();
    setReviewQueue(null);
    setEditing(index);
  }

  /** "Review them" — a pre-filled path through the notes the model doubted. */
  function startReview() {
    const flagged = view.notes
      .map((n, i) => (n.conf < 0.5 ? i : -1))
      .filter((i) => i >= 0);
    if (flagged.length === 0) return;
    settleHeld();
    setReviewQueue(flagged);
    setEditing(flagged[0]);
  }


  /** ±1 for a semitone, ±12 for an octave. Clamped to the range the server also enforces. */
  function transpose(index: number, semitones: number) {
    setDraft((d) => ({
      ...d,
      notes: d.notes.map((n, i) =>
        i === index
          ? {
              ...n,
              pitchMidi: Math.min(127, Math.max(0, n.pitchMidi + semitones)),
              // The user is the source for this note now, so it stops being flagged
              // and the review queue empties as they work.
              conf: 1,
            }
          : n,
      ),
    }));
  }

  function revertNote(index: number) {
    setDraft((d) => ({
      ...d,
      notes: d.notes.map((n, i) =>
        i === index ? baseline.notes[d.origins[i]] : n,
      ),
    }));
  }

  function deleteNote(index: number) {
    if (draft.notes.length === 1) {
      showDialog({
        title: "Can't delete this note",
        message:
          "A sheet needs at least one note. Correct its pitch instead.",
        icon: "problem",
      });
      return;
    }

    showDialog({
      title: "Delete this note?",
      message:
        "It leaves the solfa, the stave and the playback. The notes around it keep their timing, and a rest takes its place.",
      icon: "delete",
      tone: "danger",
      actions: [
        {
          label: "Delete",
          style: "destructive",
          onPress: () => {
            const wasLast = index === draft.notes.length - 1;
            setDraft((d) => ({
              notes: d.notes.filter((_, i) => i !== index),
              origins: d.origins.filter((_, i) => i !== index),
            }));
            // Every later index shifts down by one, so the frozen review path has
            // to shift with it or Prev/Next would land on the wrong notes.
            setReviewQueue((q) =>
              q === null
                ? null
                : q.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)),
            );
            // Stay on the same slot — now the following note — unless there is no
            // following note.
            setEditing(wasLast ? index - 1 : index);
          },
        },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  /**
   * Persists a corrected list for a transcription that is already in the library.
   * Called once when the sheet closes rather than on every nudge, and it reverts
   * the display on failure so the screen never disagrees with the server.
   */
  async function commitNotes(target: Draft) {
    if (!savedId) return; // unsaved: corrections travel with the save payload
    if (blockedByLocalTranspose()) return;
    if (target.notes === persisted.current.notes) return;

    const rollback = persisted.current;
    persisted.current = target;
    try {
      await libraryApi.updateNotes(savedId, target.notes);
    } catch (e) {
      persisted.current = rollback;
      setDraft(rollback);
      setPreview(synthesizeMelodyWavBase64(rollback.notes, tempo));
      // Try again puts the corrections back on screen and sends them once more.
      failedWithRetry("Could not save your corrections", e, () => {
        setDraft(target);
        setPreview(synthesizeMelodyWavBase64(target.notes, tempo));
        void commitNotes(target);
      });
    }
  }

  function closeEditor() {
    setEditing(null);
    setReviewQueue(null);
    stopAudition();
    // Synthesising walks every sample on the JS thread, so it happens once here
    // rather than on each nudge, which would jank the stepper.
    // At the tempo chosen, not the one heard: a fix must not undo a tempo change.
    if (draft.notes !== result.notes)
      setPreview(synthesizeMelodyWavBase64(draft.notes, tempo));
    void commitNotes(draft);
  }

  /** "Finish review" on the last flagged note: the walk is over, and a toast says so rather than a greyed-out Next. */
  function finishReview() {
    const count = reviewQueue?.length ?? 0;
    closeEditor();
    showToast(count === 1 ? "The flagged note is checked" : `All ${count} flagged notes checked`);
  }

  function discardCorrections() {
    settleHeld();
    const original = pristine(baseline.notes);
    setDraft(original);
    setPreview(synthesizeMelodyWavBase64(baseline.notes, tempo));
    void commitNotes(original);
  }

  /** Every fix made by hand goes at once and cannot be brought back, so it asks first, as a delete does. */
  function confirmDiscard() {
    showDialog({
      title: correctedCount === 1 ? "Discard your correction?" : `Discard ${correctedCount} corrections?`,
      message: "The notes go back to how they were heard. This can't be undone.",
      icon: "retry",
      actions: [
        { label: "Keep them", style: "cancel" },
        { label: "Discard", style: "destructive", onPress: discardCorrections },
      ],
    });
  }

  /**
   * Four-part harmony, only when asked: a hummed or sung line is one voice, and alto, tenor
   * and bass under it are an arrangement, not a transcription. A saved sheet keeps them.
   */
  async function writeParts() {
    if (harmonising || view.notes.length === 0) return;
    if (savedId && blockedByLocalTranspose()) return;
    settleHeld();
    setHarmonising(true);
    try {
      const written = await transcriptionsApi.harmonise({ key, tempoBpm: Math.round(tempo), timeSignature, notes: view.notes });
      if (!written.parts) {
        showDialog({ title: "Nothing to harmonise yet", message: "The tune needs a few notes before parts can be written under it.", icon: "about" });
        return;
      }
      // A saved sheet keeps its parts on the server first: showing them before they are kept would
      // let them vanish when the sheet is reopened.
      if (savedId) {
        try {
          await libraryApi.setParts(savedId, written.parts, written.partsMusicXml ?? null);
        } catch (e) {
          showDialog({
            title: "Parts written, not saved",
            message: `The parts could not be kept with this saved sheet: ${toApiError(e).message}`,
            icon: "problem",
            tone: "danger",
            actions: [
              { label: "OK", style: "cancel" },
              { label: "Try again", onPress: () => void writeParts() },
            ],
          });
          return;
        }
      }
      setParts(written.parts as Parts);
      setPartsMusicXml(written.partsMusicXml ?? "");
      haptics.play("success");
      // The free one is spent: re-read so the next sheet offers the plans instead.
      if (!isPro) void refreshSubscription(false);
    } catch (e) {
      failedWithRetry("Could not write the parts", e, () => void writeParts());
    } finally {
      setHarmonising(false);
    }
  }

  /**
   * Transpose for my choir. Saved sheets move on the server (the library row is the
   * source of truth); an unsaved result goes through the stateless endpoint so the
   * engraving is respelled by the same code. Either way the solfa reads as before.
   */
  async function applyTranspose() {
    if (semitones === 0) return;
    settleHeld();
    setTransposing(true);
    const before = sheetState();
    const by = semitones;
    try {
      const moved = savedId
        ? await libraryApi.transpose(savedId, semitones).then((s) => ({
            key: s.key,
            notes: s.notes ?? [],
            musicXml: s.musicXml ?? "",
            parts: s.parts ?? null,
            partsMusicXml: s.partsMusicXml ?? null,
            chords: s.chords ?? null,
          }))
        : await transcriptionsApi.transpose({
            key,
            semitones,
            notes: view.notes,
            musicXml: scoreXml || result.musicXml,
            parts,
            partsMusicXml: partsMusicXml || null,
            chords,
          });
      const relabelled = deriveSolfa(moved.notes, moved.key, timeSignature, result.chromaticSpelling ?? "direction");
      const notes = relabelled.notes;
      const after: SheetState = {
        ...before,
        baseline: { notes, key: moved.key, solfaLines: relabelled.solfaLines },
        draft: pristine(notes),
        persisted: pristine(notes),
        key: moved.key,
        parts: (moved.parts as Parts | null) ?? null,
        partsMusicXml: moved.partsMusicXml ?? "",
        chords: moved.chords?.length ? moved.chords : null,
        preview: synthesizeMelodyWavBase64(notes, tempo),
        doubt: [],
      };
      applySheet(after);
      setSemitones(0);
      // The server moved the saved sheet and the screen now shows exactly that.
      movedOffline.current = false;
      haptics.play("success");
      // The one edit that moves the notes: its Undo moves them back, on the saved sheet too.
      const id = savedId;
      hold(
        movedLine(by, moved.key),
        {
          commit: () => undefined, // already moved where it is kept
          undo: () => {
            applySheet(before);
            if (!id) return;
            libraryApi.transpose(id, -by).catch((e) => {
              applySheet(after);
              showDialog({ title: "Could not move it back", message: toApiError(e).message, icon: "problem", tone: "danger" });
            });
          },
        },
        "transpose",
      );
    } catch (e) {
      if (isNetworkCode(toApiError(e).code)) {
        transposeOffline();
        return;
      }
      failedWithRetry("Could not transpose", e, () => void applyTranspose());
    } finally {
      setTransposing(false);
    }
  }

  /**
   * "Transpose for my choir" with no connection: every note, part and chord moved on the phone
   * (lib/localTranspose), so a saved copy can be sung from in another key offline. The view only —
   * the saved sheet is moved when this is done online.
   */
  function transposeOffline() {
    if (savedId) movedOffline.current = true;
    const moved = transposeLocally({ key, notes: view.notes, parts: parts as Parts | null, chords }, semitones);
    const relabelled = deriveSolfa(moved.notes, moved.key, timeSignature, result.chromaticSpelling ?? "direction");
    setBaseline({ notes: relabelled.notes, key: moved.key, solfaLines: relabelled.solfaLines });
    setDraft(pristine(relabelled.notes));
    persisted.current = pristine(relabelled.notes);
    setKey(moved.key);
    setParts((moved.parts as Parts | null) ?? null);
    // The engraved parts score was in the old key; the stave is drawn from the notes either way.
    setPartsMusicXml("");
    setChords(moved.chords?.length ? moved.chords : null);
    setPreview(synthesizeMelodyWavBase64(relabelled.notes, tempo));
    setSemitones(0);
    setDoubt([]);
    void logAnalyticsEvent("offline_transpose", { semitones });
    showDialog({
      title: "Transposed on this phone",
      message: savedId
        ? `You're offline, so this is shown in ${moved.key} for now; the saved sheet is unchanged. Transpose again when you're online to keep it.`
        : `You're offline, so this was moved on the phone, to ${moved.key}.`,
      icon: "offline",
    });
  }

  /** Lyrics are saved when the field loses focus, so typing never races the server. */
  async function commitLyrics() {
    const next = lyrics.trim();
    if (!savedId || next === committedLyrics.current) return;
    settleHeld();
    const previous = committedLyrics.current;
    committedLyrics.current = next;
    try {
      await libraryApi.updateLyrics(savedId, next);
    } catch (e) {
      committedLyrics.current = previous;
      failedWithRetry("Could not save the lyrics", e, () => void commitLyrics());
    }
  }

  /** The public link: made once, then handed to the OS share sheet. */
  /**
   * A share link points at a sheet in the Library, so an unsaved sheet is saved first, then shared: one tap, where
   * it used to stop at "Save it first".
   */
  async function shareLink() {
    if (sharing) return;
    setSharing(true);
    const id = savedId ?? (await save());
    if (!id) {
      setSharing(false);
      return;
    }
    const tokens = await shareSheetLinks([{ id, title: committedTitle || title.trim() || `${key} transcription` }]);
    if (tokens) setShareToken(tokens.get(id) ?? null);
    setSharing(false);
  }

  /** Share on a sheet already shared (board n-ux-low Q1c): its link once more, or the link taken down. */
  function openShared() {
    showDialog({
      kind: "options",
      title: "Shared with a link",
      message: "Anyone with the link can open this sheet, with playback.",
      actions: [
        { label: "Share the link again", icon: "link", onPress: () => void shareLink() },
        { label: "Stop sharing", icon: "link-off", onPress: () => void stopSharing() },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  async function stopSharing() {
    if (!savedId) return;
    setSharing(true);
    try {
      await libraryApi.unshare(savedId);
      setShareToken(null);
      showToast(SHARING_STOPPED);
    } catch (e) {
      failedWithRetry("Could not stop sharing", e, () => void stopSharing());
    } finally {
      setSharing(false);
    }
  }

  /** Set synchronously: the field's blur and the Rename tap that caused it would otherwise rename twice. */
  const renamingRef = useRef(false);

  async function rename() {
    if (!savedId || renamingRef.current) return;
    settleHeld();
    renamingRef.current = true;
    setRenaming(true);
    // Shown at once: the server's name replaces it when it answers, or the old one comes back if it refuses.
    const before = committedTitle;
    setCommittedTitle(title.trim());
    const kept = await renameSheet(savedId, title);
    setCommittedTitle(kept ?? before);
    renamingRef.current = false;
    setRenaming(false);
  }

  /** A saved sheet's typed name is kept when the field is submitted or left, not only on Rename. */
  function commitTitle() {
    const next = title.trim();
    if (!savedId || !next || next === committedTitle) return;
    void rename();
  }

  /** Return on the name: a saved sheet keeps it, an unsaved one is saved under it, as its Save to Library does. */
  function submitTitle() {
    if (savedId) commitTitle();
    else if (title.trim() && !saving) void save();
  }

  // Back can take the screen away before a focused field reports its blur: leaving saves the lyrics and a typed
  // name as the blur would have. Read through a ref, so the listener always sees what was typed last.
  const commitOnLeave = useRef(() => {});
  commitOnLeave.current = () => {
    void commitLyrics();
    commitTitle();
  };
  useEffect(() => navigation.addListener("beforeRemove", () => commitOnLeave.current()), [navigation]);

  // A sheet that is not in the Library keeps its changes only on this screen (a saved one keeps each as it is made),
  // so Back asks before it takes corrections, words, a new key or tempo, a transposition or parts away with it.
  const firstTitle = useRef(title);
  const unsavedChanges =
    !savedId &&
    !guest &&
    (edited ||
      baseline.notes !== result.notes ||
      key !== result.key ||
      tempo !== result.tempo ||
      timeSignature !== result.timeSignature ||
      lyrics.trim() !== (result.lyrics ?? "").trim() ||
      parts !== (result.parts ?? null) ||
      title !== firstTitle.current);
  usePreventRemove(unsavedChanges, ({ data }) => {
    showDialog({
      title: "Keep your changes?",
      message: "This sheet isn't in your Library yet, so what you changed here goes when you leave.",
      icon: "save",
      actions: [
        {
          label: "Save to Library",
          onPress: () =>
            void save().then((id) => {
              if (id) navigation.dispatch(data.action);
            }),
        },
        { label: "Leave without saving", style: "destructive", onPress: () => navigation.dispatch(data.action) },
        { label: "Keep editing", style: "cancel" },
      ],
    });
  });

  // ── Export (MusicXML) ──────────────────────────────────────────────────────
  // Exports `scoreXml`, engraved here from the live note list, rather than the
  // worker's `result.musicXml` — the two are identical until the first
  // correction or key override, and after that only this one is the score on
  // screen. No success alert: the OS share sheet is its own confirmation, and it
  // has already closed by the time this resolves.
  async function handleExportSolfa() {
    setExportingType("solfa");
    try {
      const outcome = await exportSolfa(activeSolfaLines, title, {
        key,
        tempo,
        timeSignature,
      });
      if (!outcome.ok) {
        showDialog({
          title: "Could not share solfa",
          message: outcome.message,
          icon: "problem",
          tone: "danger",
        });
      }
    } finally {
      setExportingType(null);
    }
  }

  /**
   * Downloads are Pro. The solfa share stays free — it is text a choir leader pastes
   * into WhatsApp — while the files (PDF, MusicXML, MIDI) open the upgrade sheet.
   */
  function requirePro(): boolean {
    if (isPro) return true;
    showDialog({
      title: "Downloads are a Pro feature",
      message: "Upgrade to download this sheet as PDF, MusicXML or MIDI, transcribe full songs from a link, and skip the queue.",
      icon: "pro",
      tone: "premium",
      actions: [
        { label: "Not now", style: "cancel" },
        { label: "See Pro plans", onPress: () => navigation.navigate("Upgrade") },
      ],
    });
    return false;
  }

  // ── PDF from the solfa view ───────────────────────────────────────────────
  // The PDF is made from the engraved stave. With Staff not open, Download PDF used to stop at "Open the Staff view
  // first"; now it opens Staff and makes the PDF as soon as the stave has drawn.
  /** Counts the stave's draws (ScoreView `onRendered`): a change runs the PDF that was waiting for one. */
  const [staffDraws, setStaffDraws] = useState(0);
  const pdfWhenDrawn = useRef(false);
  const pdfWait = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (pdfWait.current) clearTimeout(pdfWait.current);
  }, []);
  useEffect(() => {
    if (!pdfWhenDrawn.current || staffDraws === 0) return;
    pdfWhenDrawn.current = false;
    if (pdfWait.current) clearTimeout(pdfWait.current);
    void handleExportPdf();
    // Runs on a draw alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffDraws]);

  function pdfAfterStaffDraws() {
    pdfWhenDrawn.current = true;
    setExportingType("pdf");
    setNotationView("staff");
    if (pdfWait.current) clearTimeout(pdfWait.current);
    pdfWait.current = setTimeout(() => {
      if (!pdfWhenDrawn.current) return;
      pdfWhenDrawn.current = false;
      setExportingType(null);
      showDialog({ title: "Not ready yet", message: "The staff is still drawing. Try again in a moment.", icon: "clock" });
    }, 20_000);
  }

  /** Free accounts get the PDF with a NoteFusion mark; it was the most-tapped locked button. */
  async function handleExportPdf() {
    if (!scoreRef.current) {
      pdfAfterStaffDraws();
      return;
    }
    setExportingType("pdf");
    try {
      let svg: string | undefined;
      try {
        svg = await scoreRef.current?.getSvg();
      } catch {
        // Not drawn yet, or the engraver was slow to answer: it was dropped silently with the spinner.
        showDialog({ title: "Not ready yet", message: "The staff is still drawing. Try again in a moment.", icon: "clock" });
        return;
      }
      if (!svg) {
        showDialog({
          title: "Open the Staff view first",
          message: "The PDF is made from the engraved stave. Switch to Staff, wait for it to draw, then export.",
          icon: "about",
        });
        return;
      }
      const outcome = await exportPdf(svg, {
        title: committedTitle || title,
        credit: hymnSource
          ? hymnCreditLine(hymnSource)
          : credit ? `Lead vocal transcribed from “${credit}” with NoteFusion` : null,
        key,
        tempoBpm: tempo,
        timeSignature,
        solfaLines: activeSolfaLines,
        hymn: hasLyrics ? hymn : undefined,
        parts: partsView?.filter((p) => p.name !== "soprano").map((p) => ({ name: p.name, lines: p.lines })),
        watermark: !isPro,
      });
      if (!outcome.ok) {
        showDialog({ title: "Could not export PDF", message: outcome.message, icon: "problem", tone: "danger" });
      }
    } finally {
      setExportingType(null);
    }
  }

  /**
   * The MIDI is made here from the sheet on screen, as the MusicXML is: the notes as corrected and transposed, at the
   * tempo, meter and key chosen, one track per part when there are parts (the tune is the soprano's). The worker's
   * `midiBase64` was the recording as first heard and knew none of that.
   */
  async function handleExportMidi() {
    if (!requirePro()) return;
    setExportingType("midi");
    try {
      const signature = resolveKeySignature(key);
      const tracks = parts
        ? partsOf(parts).map((v) => ({
            name: v.charAt(0).toUpperCase() + v.slice(1),
            notes: v === "soprano" ? partReference(parts, view.notes) : parts[v]!.notes,
          }))
        : [{ name: "Tune", notes: view.notes }];
      const midi = midiBase64({
        tempoBpm: tempo,
        timeSignature,
        fifths: signature.fifths,
        minor: signature.mode === "minor",
        tracks,
      });
      const outcome = await exportMidi(midi, committedTitle || title);
      if (!outcome.ok) {
        showDialog({
          title: "Could not export MIDI",
          message: outcome.message,
          icon: "problem",
          tone: "danger",
        });
      }
    } finally {
      setExportingType(null);
    }
  }

  async function exportScore() {
    if (!requirePro()) return;
    setExportingType("musicxml");
    try {
      const outcome = await exportMusicXml(scoreXml, title);
      if (!outcome.ok) {
        showDialog({
          title: "Could not export",
          message: outcome.message,
          icon: "problem",
          tone: "danger",
        });
      }
    } finally {
      setExportingType(null);
    }
  }


  const hasScore = scoreXml.length > 0;
  /** A sheet not in the Library (deleted and opened again, or from before option A): one tap saves it as titled. */
  const offerSave = !guest && !savedId;

  const insets = useSafeAreaInsets();
  const shownTitle = committedTitle || title;
  const doh = dohLetter(key);
  const confNote = confidenceNote(overallConfidence, lowCount > 0);
  const subtitle = [result.source ? result.source.artist || provider : null, section, key]
    .filter(Boolean)
    .join(" · ");
  /** The first doubtful note, named in the amber row so the ear knows where to go. */
  const firstLow = view.notes.find((n) => n.conf < 0.5);
  /** "Use the hymnbook version?" is on screen: its answer rewrites every note. */
  const askingHymnbook = hymnAsk === "version" && !!result.hymnMatch && !guest;
  /** "Which doh is it?" is on screen: its answer rewrites the pitches. */
  const askingDoh = doubt.length > 0 && !edited && !parts && hymnAsk !== "version" && !guest;
  /**
   * One question at a time: the hymnbook's, then the doh's, then the notes to check. The first two rewrite the notes
   * the last points at, so the amber row (and the first-open toast's Check) waits until they are answered.
   */
  const asking = askingHymnbook || askingDoh;
  const showCheck = lowCount > 0 && !!firstLow && !guest && !asking;
  /** The plain note under the figures, unless a question comes first or the amber row already says "check them". */
  const shownConfNote = asking || (showCheck && confidenceLevel(overallConfidence) === "check") ? null : confNote;

  /** Practise this tune: Learn my part when the sheet has parts, else Rehearse's loop for the tune alone. */
  function practiseNow() {
    if (parts) void openPractice();
    else setRehearsing(true);
  }

  /**
   * Learn my part's Rehearse row: the dock's Practise opens Learn my part on a sheet with parts, so Rehearse is
   * reached from there. Opened once Learn my part has gone, as iOS shows one modal at a time.
   */
  function rehearseFromPractice() {
    closePractice();
    setTimeout(() => setRehearsing(true), MODAL_HANDOVER_MS);
  }

  // Home's "Practise this tune" opens the sheet straight on its practice.
  useEffect(() => {
    if (practise) practiseNow();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Doh's first-open toast (board c-practice/8b) ─────────────────────────
  // Only on a sheet opened straight from its finished job, once per job: Doh cheers with the headline numbers and
  // offers to practise it — or, when some notes are worth a listen, says so and offers to check them. Leaves after
  // 5 s or on any touch, and takes the player dock's place, so it never covers the solfa.
  /**
   * Doh's cheer (or note check), or — on a sheet filed as it finished — "Saved to your Library" with Rename, or with
   * Check when it has notes worth a listen.
   */
  const [celebrate, setCelebrate] = useState<{ doubtful: boolean; saved?: boolean } | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  // Opened from its job (the record screen, a push, the Library): its take in the send queue is finished with.
  useEffect(() => {
    if (sourceJobId) {
      takeOpened(sourceJobId);
      void linkJobStore.forget(sourceJobId);
    }
    // Opened: a sheet the server filed stops showing as unopened in the Library.
    if (autoSaved && initialSavedId) void libraryApi.markOpened(initialSavedId).catch(() => undefined);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!fresh || !sourceJobId || result.notes.length === 0) return;
    let live = true;
    void firstCelebration(sourceJobId).then(async (first) => {
      if (!live || !first) return;
      if (autoSaved) {
        // A sheet the person has now opened counts toward the rating ask (as a Save did); the ask, when it comes,
        // says the sheet was saved itself, so the toast stands aside for it.
        if (await rating.recordSave()) return;
        if (!live) return;
        // Notes under the check line turn the toast's one action into Check (board m-ux-medium P1f), unless the
        // hymnbook or the doh is asked first.
        setCelebrate({ doubtful: !asking && result.notes.some((n) => n.conf < 0.5), saved: true });
      } else {
        setCelebrate({ doubtful: !asking && result.notes.some((n) => n.conf < 0.5) });
      }
      setCelebrating(true);
    });
    return () => {
      live = false;
    };
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const endCelebration = () => setCelebrating(false);
  /** A touch that began on the toast is the toast's own: it reaches the toast first, then bubbles to the screen. */
  const touchOnToast = useRef(false);
  function touchedSheet() {
    if (touchOnToast.current) touchOnToast.current = false;
    else endCelebration();
  }

  function goBack() {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Tabs", { screen: "Home" });
  }

  /** The DOH figure opens the doh picker (board n-ux-low Q1a); Transpose has a panel of its own. */
  function openDohPicker() {
    setPickingKey(true);
    setPickingTempo(false);
    setPickingMeter(false);
  }

  function togglePanel(next: Panel) {
    setPanel((p) => (p === next ? null : next));
  }

  /** Solfa | Staff and the Layout menu: the way of reading chosen is the one every sheet opens on, on this device. */
  function chooseView(next: SolfaStyle | "staff") {
    viewChosen.current = true;
    AsyncStorage.setItem(NOTATION_VIEW_KEY, next).catch(() => undefined);
    if (next === "staff") {
      setNotationView("staff");
    } else {
      setNotationView("solfa");
      setSolfaStyle(next);
    }
  }

  function openOptions() {
    const actions: DialogAction[] = [
      {
        // Straight to the notes that need it when the model flagged some,
        // otherwise to the first note — the sheet itself is the other way in.
        label: "Edit notes",
        icon: "rename",
        onPress: () => (lowCount > 0 ? startReview() : openNote(0)),
      },
    ];
    if (edited) {
      actions.push({
        label: "Discard corrections",
        icon: "retry",
        onPress: confirmDiscard,
      });
    }
    if (savedId) {
      const kept = offlineCopies.keepAll || offlineCopies.pinned.has(savedId);
      actions.push({
        label: offlineCopies.keepAll ? "Kept offline (all sheets)" : kept ? "Don't keep offline" : "Keep offline",
        icon: kept ? "kept" : "keep-offline",
        onPress: offlineCopies.keepAll ? undefined : () => void keepSheetOffline(savedId, !kept),
      });
      actions.push({
        label: "Delete from Library",
        style: "destructive",
        icon: "delete",
        // A red row never deletes at once: it asks, as every other delete in the app does.
        onPress: () => confirmDeleteSheet(savedId),
      });
    }
    actions.push({ label: "Cancel", style: "cancel" });

    showDialog({
      kind: "options",
      // The thing acted on is the title (board 7c).
      title: shownTitle || "Sheet options",
      actions,
    });
  }

  /** The same question as every delete of a saved sheet (lib/sheetActions); gone, the screen closes. */
  function confirmDeleteSheet(id: string) {
    askToDelete([{ id, title: shownTitle || "This sheet" }], async () => {
      settleHeld();
      if (!(await deleteSheets([{ id, title: shownTitle }]))) return;
      // The screen goes with it, so the toast (above the navigator) is what says it worked.
      showToast(deletedLine([shownTitle || "This sheet"]));
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.navigate("Tabs", { screen: "Library" });
      }
    });
  }

  /**
   * Transpose for my choir: the one edit that moves the notes. Re-keying, the key's other door, is the doh picker's
   * (a re-label: the notes never move, only the syllables above them).
   */
  const transposeControls = (
    <View style={styles.panel}>
      <Text style={styles.panelEyebrow} accessibilityRole="header">Transpose for my choir</Text>
      <Text style={styles.panelHint}>
        Moves every note so the parts sit in your singers' range. The solfa reads exactly as before — only Doh moves.
      </Text>
      <View style={styles.transposeRow}>
        <Touchable
          style={styles.roundStep}
          radius={radii.pill}
          onPress={() => setSemitones((s) => Math.max(-12, s - 1))}
          disabled={semitones <= -12}
          accessibilityLabel="A semitone lower"
        >
          <Icon name="minus" size={18} color={colors.text} />
        </Touchable>
        <View style={styles.transposeReadout}>
          <Text style={styles.transposeValue}>{semitones > 0 ? `+${semitones}` : semitones}</Text>
          <Text style={styles.transposeUnit}>
            {Math.abs(semitones) === 1 ? "semitone" : "semitones"} · {semitones === 0 ? key : `${key} → ${shiftKeyName(key, semitones)}`}
          </Text>
        </View>
        <Touchable
          style={styles.roundStep}
          radius={radii.pill}
          onPress={() => setSemitones((s) => Math.min(12, s + 1))}
          disabled={semitones >= 12}
          accessibilityLabel="A semitone higher"
        >
          <Icon name="add" size={18} color={colors.text} />
        </Touchable>
      </View>
      {rangeReport(view.notes, parts, semitones).map((r) => (
        <View key={r.voice} style={styles.rangeRow}>
          <Text style={styles.rangeVoice}>{r.voice}</Text>
          <Text style={styles.rangeSpan}>
            {pitchName(r.low)} – {pitchName(r.high)}
          </Text>
          <Text
            style={[
              styles.rangeStatus,
              { color: r.status === "ok" ? colors.successText : colors.warningText },
            ]}
          >
            {r.status === "ok"
              ? "comfortable"
              : r.status === "wide"
                ? "too wide"
                : `${r.overBy} ${r.overBy === 1 ? "semitone" : "semitones"} too ${r.status}`}
          </Text>
        </View>
      ))}
      <Button
        label={semitones === 0 ? "Choose a shift" : `Transpose to ${shiftKeyName(key, semitones)}`}
        icon="transpose"
        onPress={applyTranspose}
        loading={transposing}
        disabled={semitones === 0}
        style={styles.panelButton}
      />
    </View>
  );

  const nothingToShow = solfaStyle === "bars" ? view.notes.length === 0 : activeSolfaLines.length === 0;
  /** No notes were heard (the editor never deletes the last one): why, and the way to another take. */
  const emptySheet = (
    <View style={styles.emptySheet}>
      <Text style={styles.panelHint}>
        No notes were heard in this recording, so there is nothing to read yet. Hum or sing a little closer to the
        phone and record it again.
      </Text>
      {guest ? null : (
        <Button
          label="Record again"
          icon="mic"
          variant="secondary"
          onPress={() => navigation.navigate("Tabs", { screen: "Record" })}
        />
      )}
    </View>
  );

  return (
    // Any touch on the sheet sends Doh's toast away; the touch still does what it was for.
    <Screen contentStyle={styles.screen} onTouchStart={celebrating ? touchedSheet : undefined}>
      <KeyboardAvoider>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom:
                (preview ? DOCK_CLEARANCE : spacing.xl) +
                insets.bottom +
                (guest ? keepHeight + KEEP_GAP : 0) +
                (offerSave ? SAVE_PILL_ROOM : 0),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Top bar ──────────────────────────────────────────────────── */}
          {/* A guest's preview (board l-ux-high/07) is only read: × closes it, and nothing saves or shares. */}
          <View style={styles.topBar}>
            <IconButton icon={guest ? "close" : "back"} label={guest ? "Close" : "Go back"} onPress={goBack} />
            {guest ? null : (
              <View style={styles.topActions}>
                {/* The link's one home (board n-ux-low Q1c): a shared sheet's Share offers it again or stops it. */}
                <IconButton
                  icon="share"
                  label={shareToken ? "Shared with a link" : "Share a link"}
                  onPress={shareToken ? openShared : () => void shareLink()}
                  busy={sharing}
                />
                {/* The pencil names the sheet; an unsaved one is saved by the Save to Library pill over the dock. */}
                <IconButton
                  icon="rename"
                  label={savedId ? "Rename" : "Name this sheet"}
                  onPress={() => setNaming((n) => !n)}
                  active={naming}
                />
              </View>
            )}
          </View>

          {/* ── Title ───────────────────────────────────────────────────── */}
          {guest ? (
            <Text style={styles.title} accessibilityRole="header">
              {shownTitle}
            </Text>
          ) : (
            <Touchable
              onPress={() => setNaming((n) => !n)}
              ripple={false}
              scaleTo={motion.scale.row}
              haptic="none"
              style={styles.titleRow}
              accessibilityRole="button"
              accessibilityLabel={`${shownTitle}. ${savedId ? "Rename" : "Name and save"}`}
            >
              <Text style={[styles.title, styles.titleInRow]}>{shownTitle}</Text>
              {/* The pencil says the name can be changed, as the top bar's does. */}
              <Icon name="rename" size={18} color={colors.textMuted} style={styles.titlePencil} />
            </Touchable>
          )}
          {/* What the take was; "saved" is said once, by the toast (board n-ux-low Q1c). */}
          {guest ? (
            <Text style={styles.subtitle}>{`${takeKind(result)} · ${key}`}</Text>
          ) : autoSaved && !result.source ? (
            <Text style={styles.subtitle}>{takeKind(result)}</Text>
          ) : subtitle ? (
            <Text style={styles.subtitle}>{subtitle}</Text>
          ) : null}

          {naming ? (
            <View style={styles.panel}>
              {savedId ? null : <Text style={styles.panelHint}>Give this sheet a name so you can find it later.</Text>}
              <TextField
                label="Title"
                value={title}
                onChangeText={setTitle}
                onBlur={commitTitle}
                onSubmitEditing={submitTitle}
                returnKeyType="done"
                autoCapitalize="sentences"
                placeholder="Name this sheet…"
              />
              {savedId ? (
                <Button
                  label="Rename"
                  variant="secondary"
                  onPress={rename}
                  loading={renaming}
                  disabled={!title.trim() || title.trim() === committedTitle}
                />
              ) : (
                <Button
                  label="Save to Library"
                  icon="save"
                  onPress={save}
                  loading={saving}
                  disabled={!title.trim()}
                />
              )}
            </View>
          ) : null}

          {/* ── Song credit: a linked song is acknowledged by title and artist ─── */}
          {result.source ? (
            <View style={styles.credit}>
              {result.source.thumbnailUrl ? (
                <Image source={{ uri: result.source.thumbnailUrl }} style={styles.creditThumb} />
              ) : (
                <View style={[styles.creditThumb, styles.creditThumbEmpty]}>
                  <Icon name="song" size={18} color={colors.textMuted} />
                </View>
              )}
              <View style={styles.creditBody}>
                <Text style={styles.creditTitle} numberOfLines={1}>{result.source.title}</Text>
                <Text style={styles.creditLine} numberOfLines={1}>Lead vocal, transcribed with NoteFusion</Text>
              </View>
            </View>
          ) : null}
          {hymnSource ? (
            <Text style={styles.notice}>
              {hymnCreditLine(hymnSource)}{" "}
              {hymnSource.url ? (
                <Text style={styles.hymnName} onPress={() => Linking.openURL(hymnSource.url).catch(() => undefined)}>
                  See the hymn
                </Text>
              ) : null}
            </Text>
          ) : null}
          {guest ? (
            <Text style={styles.notice}>
              Free preview: the first {GUEST_MAX_SECONDS} seconds. Create a free account to keep the sheet.
            </Text>
          ) : result.source?.preview && result.source.notice ? (
            <Text style={styles.notice}>{result.source.notice}</Text>
          ) : result.truncated ? (
            <Text style={styles.notice}>
              {section
                ? "Only the first part of the section you chose fit; the rest was left out."
                : isPro
                  ? "The first six minutes of the song were transcribed."
                  : "Free preview: the first minute. Upgrade to Pro for the whole song and the PDF."}
            </Text>
          ) : null}

          {/* ── The numbers that matter ─────────────────────────────────── */}
          <View style={styles.stats}>
            {/* A guest's figures are read, not changed: no pickers behind them. */}
            <Stat
              value={doh}
              caption={rekeying ? "Saving" : "Doh"}
              onPress={guest ? undefined : openDohPicker}
              active={pickingKey}
              accessibilityLabel={`Key ${key}, doh is ${doh}.${guest ? "" : " Change key"}`}
            />
            <Stat
              value={String(tempo)}
              caption="BPM"
              onPress={guest ? undefined : () => {
                setPickingTempo((p) => !p);
                setPickingKey(false);
                setPickingMeter(false);
              }}
              active={pickingTempo}
              accessibilityLabel={`Tempo ${tempo} BPM.${guest ? "" : " Change tempo"}`}
            />
            <Stat
              value={timeSignature}
              caption="Time"
              onPress={guest ? undefined : () => {
                setPickingMeter((p) => !p);
                setPickingKey(false);
                setPickingTempo(false);
              }}
              active={pickingMeter}
              accessibilityLabel={`Time signature ${timeSignature}.${guest ? "" : " Change meter"}`}
            />
          </View>

          {/* No percentage: a plain note, and only when there is something to do. The
              doubtful notes are tinted on the sheet, so a middling one points at them. */}
          {shownConfNote ? <Text style={styles.notice}>{shownConfNote}</Text> : null}

          {hymnAsk && result.hymnMatch && !guest ? (
            <View style={styles.panel}>
              <Text style={styles.panelEyebrow} accessibilityRole="header">Is this a hymn?</Text>
              <Text style={styles.panelHint}>
                This sounds like{" "}
                <Text style={styles.hymnName} onPress={() => Linking.openURL(result.hymnMatch!.url).catch(() => undefined)}>
                  {hymnAsk === "version" ? hymnLabel(result.hymnMatch) : result.hymnMatch.title}
                </Text>
                {hymnAsk === "version"
                  ? ". Use the hymnbook version? Its notes, rhythm and bar lines come from the published score, in the key you sang."
                  : "."}
              </Text>
              {/* Both openings, bar lines and meter as each writes them, so the swap is seen before it is made. */}
              {hymnPreview ? (
                <View style={styles.compare}>
                  <Text style={styles.compareLabel}>Yours · {hymnPreview.yoursMeter}</Text>
                  <Text style={styles.compareLine}>{hymnPreview.yours}</Text>
                  <Text style={[styles.compareLabel, styles.compareGap]}>Hymnbook · {hymnPreview.bookMeter}</Text>
                  <Text style={[styles.compareLine, styles.compareBook]}>{hymnPreview.book}</Text>
                </View>
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                {hymnAsk === "version" ? (
                  <Touchable
                    style={[styles.chip, styles.chipOn]}
                    radius={radii.pill}
                    onPress={() => chooseHymnbook(true)}
                    accessibilityLabel={`Use the hymnbook version of ${result.hymnMatch.title}`}
                  >
                    <Text style={[styles.chipText, styles.chipTextOn]}>Use the hymnbook</Text>
                  </Touchable>
                ) : null}
                <Touchable
                  style={styles.chip}
                  radius={radii.pill}
                  onPress={() => chooseHymnbook(false)}
                  accessibilityLabel={hymnAsk === "version" ? "Keep your own version" : "Dismiss"}
                >
                  <Text style={styles.chipText}>{hymnAsk === "version" ? "Keep mine" : "Dismiss"}</Text>
                </Touchable>
              </ScrollView>
            </View>
          ) : null}

          {askingDoh ? (
            <View style={styles.panel}>
              <Text style={styles.panelEyebrow} accessibilityRole="header">Which doh is it?</Text>
              <Text style={styles.panelHint}>
                Your tune fits more than one doh. Here is how it starts in each; tap the one you sang in.
              </Text>
              {/* Each row is the rewrite a tap makes, of the first eight notes; the one shown is "Now". */}
              <DohChoiceRow
                letter={doh}
                opening={openingBars(view.notes, timeSignature)}
                now
                disabled={rekeying}
                onPress={() => chooseDoh(null)}
              />
              {dohPreviews.map(({ choice, opening }) => (
                <DohChoiceRow
                  key={choice.key}
                  letter={dohLetter(choice.key)}
                  opening={opening}
                  disabled={rekeying}
                  onPress={() => chooseDoh(choice)}
                />
              ))}
            </View>
          ) : null}

          {/* ── Tempo picker (F-07) ────────────────────────────────────────── */}
          {pickingTempo ? (
            <View style={styles.panel}>
              <Text style={styles.panelHint}>
                Adjust playback tempo (20–300 BPM). Notes and beats realign in real time.
              </Text>
              <View style={styles.stepperRow}>
                {[-5, -1].map((d) => (
                  <Touchable
                    key={d}
                    onPress={() => handleTempoChange(Math.max(20, tempo + d))}
                    style={styles.stepPill}
                    radius={radii.pill}
                    accessibilityLabel={`Decrease tempo by ${-d} BPM`}
                  >
                    <Text style={styles.stepText}>{d}</Text>
                  </Touchable>
                ))}
                <Text style={styles.stepValue}>{tempo}</Text>
                {[1, 5].map((d) => (
                  <Touchable
                    key={d}
                    onPress={() => handleTempoChange(Math.min(300, tempo + d))}
                    style={styles.stepPill}
                    radius={radii.pill}
                    accessibilityLabel={`Increase tempo by ${d} BPM`}
                  >
                    <Text style={styles.stepText}>+{d}</Text>
                  </Touchable>
                ))}
              </View>
            </View>
          ) : null}

          {/* ── Meter picker ────────────────────────────────────────────────── */}
          {pickingMeter ? (
            <View style={styles.panel}>
              <Text style={styles.panelHint}>
                Select time signature. Re-groups bars for Curwen solfa and staff notation.
              </Text>
              <View style={styles.meterRow}>
                {(["4/4", "3/4", "2/4", "6/8", "12/8"] as const).map((m) => (
                  <Touchable
                    key={m}
                    onPress={() => handleMeterChange(m)}
                    style={[styles.chip, styles.meterChip, timeSignature === m && styles.chipOn]}
                    radius={radii.pill}
                    accessibilityState={{ selected: timeSignature === m }}
                    accessibilityLabel={`Set meter to ${m}`}
                  >
                    <Text style={[styles.chipText, timeSignature === m && styles.chipTextOn]}>{m}</Text>
                  </Touchable>
                ))}
              </View>
            </View>
          ) : null}

          {/* One amber row when the model doubted some notes. Tapping opens the piano on
              the flagged piece: a doubtful note is a *pitch* question, and the fastest
              answer to one is pressing the key and hearing it. */}
          {showCheck && firstLow ? (
            <Touchable
              style={styles.check}
              onPress={startReview}
              scaleTo={motion.scale.row}
              radius={16}
              accessibilityLabel={`Review ${lowCount} low-confidence notes`}
            >
              <Icon name="problem" size={18} color={colors.warning} />
              <Text style={styles.checkText} numberOfLines={1}>
                <Text style={styles.checkStrong}>
                  {lowCount} note{lowCount > 1 ? "s" : ""} to check
                </Text>
                {` · ${firstLow.solfa}${firstLow.octaveMark} in bar ${barOf(firstLow, timeSignature)}`}
              </Text>
              <Icon name="chevron" size={16} color={colors.textFaint} />
            </Touchable>
          ) : null}

          {/* ── Actions (none on a guest's preview: an account is what they come with) ── */}
          {guest ? null : (
            <View style={styles.actions}>
              <Action icon="transpose" label="Transpose" active={panel === "transpose"} onPress={() => togglePanel("transpose")} />
              <Action icon="lyrics" label="Lyrics" active={panel === "lyrics"} onPress={() => togglePanel("lyrics")} />
              <Action icon="parts" label="SATB" active={panel === "parts"} onPress={() => togglePanel("parts")} />
              <Action icon="sing" label="Sing" active={panel === "sing"} onPress={() => togglePanel("sing")} />
              <Action icon="export" label="Export" active={panel === "export"} onPress={() => togglePanel("export")} />
              <Action icon="more" label="More" onPress={openOptions} accessibilityLabel="Sheet options" />
            </View>
          )}

          {panel === "transpose" ? transposeControls : null}

          {/* ── Lyrics: the words under the solfa ──────────────────────────── */}
          {panel === "lyrics" ? (
            <View style={styles.panel}>
              <TextField
                label="Lyrics"
                value={lyrics}
                onChangeText={setLyrics}
                onBlur={() => void commitLyrics()}
                placeholder="A-ma-zing grace, how sweet the sound…"
                autoCapitalize="sentences"
                multiline
                numberOfLines={3}
              />
              <Text style={styles.panelHint}>
                Split syllables with hyphens (a-ma-zing); each syllable goes under the next note. Use grace_ to hold a syllable over two notes.
              </Text>
            </View>
          ) : null}

          {/* ── Voices: SATB under the tune ──────────────────────────────────── */}
          {panel === "parts" ? (
            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle} accessibilityRole="header">
                  {result.partsSource === "heard" ? "The four parts, as sung" : "Four-part harmony"}
                </Text>
                {!isPro && !partsView && !freeHarmony ? <ProTag /> : null}
              </View>
              {partsView ? (
                <Button
                  label="Learn my part"
                  icon="learn-part"
                  onPress={() => void openPractice()}
                  style={styles.panelButton}
                />
              ) : null}
              {partsView ? (
                partsView.map(({ name, lines }) => (
                  <View key={name} style={styles.voice}>
                    <Text style={styles.voiceName}>{name.charAt(0).toUpperCase() + name.slice(1)}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <Text style={styles.voiceLines}>{lines.slice(1).join("\n")}</Text>
                    </ScrollView>
                  </View>
                ))
              ) : isPro || freeHarmony ? (
                <>
                  <Text style={styles.panelHint}>
                    {freeHarmony
                      ? "Try it once, free: alto, tenor and bass written under this tune the way a hymn arranger would. Pro writes parts for every sheet."
                      : "The sheet shows the voice we heard. When you want a choir arrangement, alto, tenor and bass are written under it the way a hymn arranger would."}
                  </Text>
                  <Button
                    label={freeHarmony ? "Write alto, tenor and bass · 1 free" : "Write alto, tenor and bass"}
                    variant="secondary"
                    icon="parts"
                    loading={harmonising}
                    onPress={() => void writeParts()}
                    style={styles.panelButton}
                  />
                </>
              ) : (
                <Touchable
                  onPress={() => navigation.navigate("Upgrade")}
                  style={styles.teaser}
                  radius={radii.md}
                  accessibilityLabel="Unlock four-part harmony"
                >
                  <Text style={styles.teaserText}>
                    Alto, tenor and bass parts, written under this tune the way a hymn arranger would — ready for your choir. Unlock with Pro →
                  </Text>
                </Touchable>
              )}
            </View>
          ) : null}

          {/* ── Sing it: a take, marked note by note ────────────────────────── */}
          {panel === "sing" ? (
            view.notes.length > 0 ? (
              <SingAlong
                melody={view.notes}
                parts={isPro ? parts : null}
                tempoBpm={tempo}
                timeSignature={timeSignature}
                isPro={isPro}
                // Marking a take is what Pro adds here, so the practice words, not the downloads'.
                onRequirePro={practiceUpsell}
                sheetId={savedId}
              />
            ) : (
              <Text style={styles.panelHint}>There are no notes to sing: none were heard in this recording.</Text>
            )
          ) : null}

          {/* ── Export & Share ─────────────────────────────────────────────────── */}
          {panel === "export" ? (
            <View style={styles.panel}>
              <Text style={styles.panelHint}>
                {isPro
                  ? "Share the solfa to your choir group, or download the sheet as PDF, MusicXML or MIDI."
                  : "The solfa as text and the PDF are free; the PDF carries a NoteFusion mark. MusicXML, MIDI and an unmarked PDF come with Pro."}
              </Text>
              <ExportRow
                icon="solfa"
                label="Share Tonic Solfa text"
                onPress={() => void handleExportSolfa()}
                busy={exportingType === "solfa"}
              />
              <ExportRow
                icon="pdf"
                label={isPro ? "Download PDF" : "Download PDF (free, marked)"}
                onPress={() => void handleExportPdf()}
                busy={exportingType === "pdf"}
                disabled={!hasScore}
              />
              <ExportRow
                icon="midi"
                label="Download MIDI"
                pro={!isPro}
                onPress={() => void handleExportMidi()}
                busy={exportingType === "midi"}
                disabled={isPro && view.notes.length === 0}
              />
              <ExportRow
                icon="musicxml"
                label="Download MusicXML"
                pro={!isPro}
                onPress={() => void exportScore()}
                busy={exportingType === "musicxml"}
                disabled={!hasScore}
                last
              />
            </View>
          ) : null}

          {/* ── How to read it: Solfa | Staff, and the solfa's layout (board n-ux-low Q1a–b) ── */}
          <View style={styles.readingRow}>
            <Segmented
              segments={[
                { id: "solfa", label: "Solfa", icon: "solfa", accessibilityLabel: "Show tonic solfa" },
                { id: "staff", label: "Staff", icon: "staff", accessibilityLabel: "Show staff notation" },
              ]}
              value={notationView}
              onChange={(v) => chooseView(v === "staff" ? "staff" : solfaStyle)}
            />
            {notationView === "solfa" ? (
              <Touchable
                onPress={() => setChoosingLayout(true)}
                style={styles.layoutPill}
                radius={radii.pill}
                accessibilityLabel={`Layout: ${layoutName(solfaStyle)}. Change the layout`}
              >
                <Text style={styles.layoutPillText}>{layoutName(solfaStyle)}</Text>
                <Icon name="down" size={14} color={colors.textMuted} />
              </Touchable>
            ) : null}
          </View>

          {/* ── The notation, from the same note data whichever way it is read ── */}
          <View style={styles.notation}>
            {notationView === "solfa" ? (
              // The mark, faint behind the solfa — the board's watermark.
              <View pointerEvents="none" style={styles.watermark}>
                <Mark height={200} color={colors.text} />
              </View>
            ) : null}
            {notationView === "solfa" ? (
              nothingToShow ? (
                emptySheet
              ) : solfaStyle === "bars" ? (
                <>
                  <SheetGrid
                    notes={view.notes}
                    lyrics={lyricsUnder}
                    chords={chordView}
                    timeSignature={timeSignature}
                    barCount={barCount}
                    playingNote={playingNote}
                    onSelectNote={guest ? undefined : openNote}
                  />
                  {guest ? null : <Text style={styles.gridHint}>Tap a syllable to fix it.</Text>}
                </>
              ) : solfaStyle === "hymn" ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View>
                    <Text style={styles.solfaHeader}>{activeSolfaLines[0]}</Text>
                    {hymn.map((bars, r) => (
                      <View key={r} style={styles.hymnRow}>
                        {bars.map((bar, b) => (
                          <View key={b} style={styles.hymnBar}>
                            {bar.map((cell, c) => (
                              <View key={c} style={styles.hymnCell}>
                                <Text style={styles.hymnSolfa}>{cell.solfa}</Text>
                                <Text style={styles.hymnLyric} numberOfLines={1}>{cell.lyric}</Text>
                              </View>
                            ))}
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              ) : (
                activeSolfaLines.map((line, i) => (
                  <View key={i} style={styles.solfaLineWrap}>
                    {activeSolfaLines.length > 1 && (
                      <Text style={styles.solfaLineNum}>{i + 1}</Text>
                    )}
                    <View style={styles.solfaLineColumn}>
                      {/* The chords over the bar, in the same monospaced face so each symbol sits
                          on the syllable it belongs to (lib/chordRow). */}
                      {chordLines?.[i]?.trim() ? (
                        <Text style={styles.chordLine}>{chordLines[i]}</Text>
                      ) : null}
                      <Text style={[styles.solfaLine, i === 0 && styles.solfaHeader]}>{line}</Text>
                    </View>
                  </View>
                ))
              )
            ) : view.notes.length === 0 ? (
              emptySheet
            ) : (
              <View>
                <ScoreView
                  ref={scoreRef}
                  notes={view.notes}
                  timeSignature={timeSignature}
                  musicalKey={key}
                  cursorBeat={cursorBeat}
                  onSelectNote={guest ? undefined : openNote}
                  onRendered={() => setStaffDraws((n) => n + 1)}
                />
                {/* What the ring means, under the stave, only when there is a ringed note. */}
                {lowCount > 0 ? (
                  <View style={styles.ringLegend}>
                    <Svg width={24} height={24}>
                      <Circle cx={12} cy={12} r={10} fill="none" stroke={colors.warning} strokeWidth={1.6} strokeDasharray="2.4 2.6" />
                      <Ellipse cx={12} cy={12} rx={5.6} ry={4} transform="rotate(-22 12 12)" fill={colors.warning} />
                    </Svg>
                    <Text style={styles.ringLegendText}>
                      {guest ? "Ringed notes are worth a listen." : "Ringed notes are worth a listen. Tap one to hear and fix it."}
                    </Text>
                  </View>
                ) : null}
                {/* A free account reads the sheet on screen with the preview mark; the
                    download is the Pro half. */}
                {!isPro ? (
                  <View pointerEvents="none" style={styles.previewMark}>
                    <Text style={styles.previewMarkText}>NoteFusion preview</Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>

          {/* ── Chords: the progression heard, symbol over its solfa ───────── */}
          {chordView ? (
            <View style={styles.chordsBlock}>
              <Text style={styles.eyebrow} accessibilityRole="header">Chords</Text>
              <Text style={styles.panelHint}>
                As heard under the tune. The letter is the chord; the syllable beneath is its root in this key.
              </Text>
              <View style={styles.chordChips}>
                {chordView.map((ch, i) => (
                  <View key={`${ch.startBeat}-${i}`} style={styles.chordChip} accessibilityLabel={`${ch.symbol}, ${ch.solfa}`}>
                    <Text style={styles.chordChipSymbol}>{ch.symbol}</Text>
                    <Text style={styles.chordChipSolfa}>{ch.solfa}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoider>

      {/* ── Playback: hear the tune; Rehearse to loop, slow down and mute parts ─
          Doh's first-open toast takes the dock's place for its few seconds, so it never covers the solfa. */}
      {preview && !celebrate && (!guest || keepHeight > 0) ? (
        <PlayerDock
          practice={practice}
          onPractise={practiseNow}
          lift={guest ? keepHeight + KEEP_GAP : 0}
          onHeight={setDockHeight}
        />
      ) : null}

      {/* ── Not in the Library: Save to Library is the screen's one primary, over the dock where the thumb is ── */}
      {offerSave ? (
        <View
          pointerEvents="box-none"
          style={[styles.savePill, { bottom: insets.bottom + 10 + (preview ? dockHeight + SAVE_PILL_GAP : 0) }]}
        >
          <Button label="Save to Library" icon="save" onPress={() => void save({ offerRename: true })} loading={saving} />
        </View>
      ) : null}

      {/* ── A guest's preview: what an account adds, and the two ways to one (board l-ux-high/07) ── */}
      {guest ? (
        <GuestAccountCard
          title="Keep this sheet"
          message="Save it to your Library, hear it in four parts and share it with your choir. Free: 3 transcriptions a week."
          primary="Create a free account to keep it"
          style={[styles.keepCard, { bottom: insets.bottom + 10 }]}
          onLayout={(e) => setKeepHeight(Math.round(e.nativeEvent.layout.height))}
        />
      ) : null}

      <RehearseView
        visible={rehearsing}
        onClose={() => setRehearsing(false)}
        practice={practice}
        notes={view.notes}
        lyricsUnder={lyricsUnder}
        timeSignature={timeSignature}
        barCount={barCount}
        title={shownTitle}
        subtitle={subtitle}
        thumbnailUrl={result.source?.thumbnailUrl}
        doh={doh}
        voices={hasParts ? VOICES.filter((v) => v === "soprano" || parts?.[v]).map((v) => ({ name: v, on: voiceOn[v] })) : undefined}
        onToggleVoice={(v) => setVoiceOn((s) => ({ ...s, [v]: !s[v] }))}
      />

      {/* ── Learn my part: my part loud, a few bars looped and slowed, sung back and marked ── */}
      {practising && parts && practiceParts ? (
        <PracticeView
          onClose={closePractice}
          onRehearse={rehearseFromPractice}
          practice={practice}
          names={partsOf(parts)}
          part={practicePart}
          onPart={choosePracticePart}
          balance={practiceBalance}
          onBalance={(b) => {
            setPracticeBalance(b);
            void logAnalyticsEvent("practice_balance", { balance: b });
          }}
          speed={practiceSpeed}
          speeds={speedsFor(tempo)}
          onSpeed={(sp) => {
            setPracticeSpeed(sp);
            void logAnalyticsEvent("practice_speed", { speed: sp });
          }}
          partNotes={practiceParts[practicePart] ?? []}
          tempo={tempo}
          timeSignature={timeSignature}
          barCount={barCount}
          isPro={isPro}
          onRequirePro={practiceUpsell}
          sheetId={savedId}
        />
      ) : null}

      {/* ── Which doh? and the Layout menu (board n-ux-low Q1a–b) ──────────── */}
      {guest ? null : (
        <DohPicker
          visible={pickingKey}
          currentKey={key}
          disabled={rekeying}
          onChoose={(k) => void applyKey(k)}
          onClose={() => setPickingKey(false)}
        />
      )}
      <LayoutMenu
        visible={choosingLayout}
        current={solfaStyle}
        hasLyrics={hasLyrics}
        samples={layoutSamples}
        onChoose={(layout) => {
          setChoosingLayout(false);
          chooseView(layout);
        }}
        onClose={() => setChoosingLayout(false)}
      />

      {/* ── Tap-to-correct sheet (F-07) ─────────────────────────────────── */}
      <NoteEditor
        index={editing}
        notes={view.notes}
        tempoBpm={result.tempo}
        edited={
          editing !== null &&
          draft.notes[editing] !== baseline.notes[draft.origins[editing]]
        }
        reviewQueue={reviewQueue}
        onNavigate={setEditing}
        onTranspose={transpose}
        onRevert={revertNote}
        onDelete={deleteNote}
        onClose={closeEditor}
        onFinishReview={finishReview}
      />

      {/* ── Doh's first-open toast, where the player docks ─────────────────── */}
      {celebrate?.saved && celebrate.doubtful && lowCount > 0 ? (
        // Filed as it finished, with notes worth a listen: the good news with its tick, and Check (Rename stays one
        // tap away on the title's pencil).
        <DohToast
          visible={celebrating}
          icon="done"
          iconColor={colors.success}
          title="Saved to your Library"
          body={worthAListenLine(lowCount)}
          action="Check"
          bottom={insets.bottom + 10}
          onTouched={() => {
            touchOnToast.current = true;
          }}
          onAction={() => {
            endCelebration();
            startReview();
          }}
          onHide={endCelebration}
          onGone={() => setCelebrate(null)}
        />
      ) : celebrate?.saved ? (
        <DohToast
          visible={celebrating}
          icon="library"
          iconColor={colors.success}
          title="Saved to your Library"
          body={savedToastBody(shownTitle, result.hymnMatch?.title)}
          action="Rename"
          bottom={insets.bottom + 10}
          onTouched={() => {
            touchOnToast.current = true;
          }}
          onAction={() => {
            endCelebration();
            setNaming(true);
          }}
          onHide={endCelebration}
          onGone={() => setCelebrate(null)}
        />
      ) : celebrate ? (
        <DohToast
          visible={celebrating}
          pose={celebrate.doubtful ? "encourage" : "cheer-notes"}
          title={celebrate.doubtful ? "Done. A few notes are worth a listen." : `Here it is! Doh is ${doh}.`}
          body={celebrate.doubtful ? "They're outlined." : `${view.notes.length} notes. Sing it back once?`}
          action={celebrate.doubtful ? "Check" : "Practise"}
          bottom={insets.bottom + 10}
          onTouched={() => {
            touchOnToast.current = true;
          }}
          onAction={() => {
            endCelebration();
            if (celebrate.doubtful) startReview();
            else practiseNow();
          }}
          onHide={endCelebration}
          onGone={() => setCelebrate(null)}
        />
      ) : null}
    </Screen>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

/** A guest's preview in the signed-out stack, on the night canvas as every first-run screen is. */
export function GuestPreviewScreen(props: Props) {
  return (
    <ThemeOverride mode="dark">
      <ResultScreen {...props} />
    </ThemeOverride>
  );
}

/** The board's 40px round icon button: surface fill, hairline border. */
function IconButton({
  icon,
  label,
  onPress,
  busy,
  tint,
  active,
  filled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  busy?: boolean;
  tint?: string;
  active?: boolean;
  /** The selected treatment (a saved sheet's bookmark). */
  filled?: boolean;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <Touchable
      onPress={onPress}
      disabled={busy}
      style={[styles.iconBtn, active && styles.iconBtnActive]}
      radius={20}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? <ActivityIndicator size="small" color={colors.text} /> : <Icon name={icon} size={20} filled={filled} color={tint ?? colors.text} />}
    </Touchable>
  );
}

/** One figure in the stats row: big value, tiny uppercase caption. */
function Stat({
  value,
  caption,
  onPress,
  active,
  accessibilityLabel,
}: {
  value: string;
  caption: string;
  onPress?: () => void;
  active?: boolean;
  accessibilityLabel: string;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const body = (
    <>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <View style={styles.statCaptionRow}>
        <Text style={[styles.statCaption, active && styles.statCaptionActive]}>{caption}</Text>
        {/* A small chevron says the figure opens something (up while it is open); a pill would box the sheet's
            three biggest figures. */}
        {onPress ? (
          <Icon
            name="chevron"
            size={12}
            color={active ? colors.accent : colors.textMuted}
            style={active ? styles.chevronUp : styles.chevronDown}
          />
        ) : null}
      </View>
    </>
  );
  // Only the stats that change something get a touch target, so a read-only one
  // doesn't advertise an affordance it doesn't have.
  return onPress ? (
    <Touchable
      style={styles.stat}
      onPress={onPress}
      ripple={false}
      accessibilityRole="button"
      accessibilityState={{ expanded: !!active }}
      accessibilityLabel={accessibilityLabel}
    >
      {body}
    </Touchable>
  ) : (
    <View style={styles.stat} accessible accessibilityLabel={accessibilityLabel}>
      {body}
    </View>
  );
}

/** One answer to "Which doh is it?": the doh, how the tune starts in it, and "Now" on the one shown. */
function DohChoiceRow({
  letter,
  opening,
  now = false,
  disabled,
  onPress,
}: {
  letter: string;
  opening: string | null;
  now?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      style={[styles.dohRow, now && styles.dohRowOn]}
      radius={16}
      scaleTo={motion.scale.row}
      accessibilityRole="button"
      accessibilityState={{ selected: now }}
      accessibilityLabel={`${now ? `Keep doh as ${letter}` : `Doh is ${letter}`}${opening ? `. It starts ${opening}` : ""}`}
    >
      <View style={styles.dohRowText}>
        <Text style={styles.dohRowName}>Doh is {letter}</Text>
        {opening ? (
          <Text style={styles.dohRowOpening} numberOfLines={1}>
            {opening}
          </Text>
        ) : null}
      </View>
      {now ? <Text style={styles.nowPill}>Now</Text> : null}
    </Touchable>
  );
}

/** A round action with its name beneath. */
function Action({
  icon,
  label,
  onPress,
  active,
  accessibilityLabel,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <Touchable
      onPress={onPress}
      style={styles.action}
      ripple={false}
      accessibilityRole="button"
      accessibilityState={active === undefined ? undefined : { expanded: active }}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <View style={[styles.actionCircle, active && styles.actionCircleOn]}>
        <Icon name={icon} size={22} color={active ? colors.link : colors.text} />
      </View>
      <Text style={[styles.actionLabel, active && styles.actionLabelOn]} numberOfLines={1}>
        {label}
      </Text>
    </Touchable>
  );
}

function ProTag() {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.proTag}>
      <Icon name="pro" size={11} color={colors.premiumDeep} />
      <Text style={styles.proTagText}>PRO</Text>
    </View>
  );
}

/** A row in the export panel: icon, name, and a spinner, PRO tag or chevron at the end. */
function ExportRow({
  icon,
  label,
  onPress,
  busy,
  disabled,
  pro,
  last,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  pro?: boolean;
  last?: boolean;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled || busy}
      style={[styles.exportRow, !last && styles.exportRowRule, disabled && styles.disabled]}
      scaleTo={motion.scale.row}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      accessibilityLabel={pro ? `${label}, Pro` : label}
    >
      <Icon name={pro ? "lock" : icon} size={20} color={pro ? colors.textMuted : colors.icon} />
      <Text style={styles.exportLabel}>{label}</Text>
      {busy ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : pro ? (
        <ProTag />
      ) : (
        <Icon name="chevron" size={16} color={colors.textFaint} />
      )}
    </Touchable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    /** The ScrollView takes the gutter so the dock can sit over the full width. */
    screen: { paddingHorizontal: 0, paddingBottom: 0 },
    content: { paddingHorizontal: 22 },
    /** A guest's "Keep this sheet", pinned where the player docks (the player sits on it), at the dock's width. */
    /** Save to Library: 16 px from the edge, 12 px over the dock. */
    savePill: { position: "absolute", right: 16 },
    keepCard: {
      position: "absolute",
      left: 14,
      right: 14,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.35,
      shadowRadius: 24,
      elevation: 12,
    },

    // ── Top bar & title ───────────────────────────────────────────────────────
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 6,
    },
    topActions: { flexDirection: "row", gap: spacing.sm },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    iconBtnActive: { borderColor: c.accentGlow },
    title: {
      fontFamily: fonts.semibold,
      fontSize: 32,
      lineHeight: 36,
      letterSpacing: -1.2,
      color: c.text,
      marginTop: 16,
    },
    titleRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 16 },
    titleInRow: { marginTop: 0, flexShrink: 1 },
    /** Centred on the last line of the 36 px title. */
    titlePencil: { marginLeft: 8, marginBottom: 9 },
    // Sentences that explain are 15/22 and captions 12 at least (board m-ux-medium P1h); 15, not 16, so the solfa
    // stays the biggest thing on the sheet.
    subtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: c.textMuted, marginTop: 6 },

    credit: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: 14 },
    creditThumb: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.surfaceAlt },
    creditThumbEmpty: { alignItems: "center", justifyContent: "center" },
    creditBody: { flex: 1, minWidth: 0 },
    creditTitle: { fontFamily: fonts.medium, fontSize: 13.5, color: c.text },
    creditLine: { fontFamily: fonts.regular, fontSize: 12, color: c.textFaint, marginTop: 2 },
    hymnName: { fontFamily: fonts.medium, fontStyle: "italic", color: c.accent, textDecorationLine: "underline" },
    notice: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 22,
      color: c.noticeText,
      backgroundColor: c.accentSoft,
      borderRadius: 12,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      marginTop: 14,
      overflow: "hidden",
    },

    // ── Stats row ─────────────────────────────────────────────────────────────
    stats: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 18,
      paddingVertical: 16,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: c.border,
    },
    stat: { minWidth: 56 },
    statValue: {
      fontFamily: fonts.medium,
      fontSize: 30,
      lineHeight: 34,
      letterSpacing: -1.2,
      color: c.text,
    },
    statCaptionRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 6 },
    statCaption: {
      fontFamily: fonts.medium,
      fontSize: 12,
      letterSpacing: 1.5,
      textTransform: "uppercase",
      color: c.textMuted,
    },
    chevronDown: { transform: [{ rotate: "90deg" }] },
    chevronUp: { transform: [{ rotate: "-90deg" }] },
    statCaptionActive: { color: c.accent },

    // ── Panels (pickers, lyrics, parts, export, the name) ────────────────────
    panel: {
      marginTop: 14,
      padding: spacing.lg,
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
    },
    panelHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    panelTitle: { ...typography.heading, fontSize: 16, color: c.text, flex: 1 },
    panelEyebrow: {
      fontFamily: fonts.medium,
      fontSize: 12,
      letterSpacing: 1.7,
      textTransform: "uppercase",
      color: c.textMuted,
    },
    panelHint: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: c.textMuted },
    panelButton: { marginTop: spacing.xs },
    eyebrow: {
      fontFamily: fonts.medium,
      fontSize: 12,
      letterSpacing: 1.7,
      textTransform: "uppercase",
      color: c.textMuted,
      marginBottom: spacing.xs,
    },

    /** Chips are 44 px tall and 8 px apart: big enough to hit (board l-ux-high 05a). */
    chipScroll: { gap: spacing.sm, paddingRight: spacing.md },
    chip: {
      minHeight: 44,
      justifyContent: "center",
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radii.pill,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    /** Selected takes one look on this screen (key, doh and meter chips, reading chips, actions): wash, line, blue words. */
    chipOn: { backgroundColor: c.selectedWash, borderColor: c.accent },
    chipText: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted },
    chipTextOn: { fontFamily: fonts.semibold, color: c.link },

    // ── Which doh is it? and the hymnbook version: seen before they are taken ──
    dohRow: {
      minHeight: 60,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: 14,
      borderRadius: 16,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1.5,
      borderColor: c.border,
    },
    dohRowOn: { backgroundColor: c.selectedWash, borderColor: c.accent },
    dohRowText: { flex: 1, minWidth: 0 },
    dohRowName: { fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    dohRowOpening: { fontFamily: typography.mono.fontFamily, fontSize: 14, letterSpacing: 0.3, color: c.accent, marginTop: 3 },
    nowPill: {
      fontFamily: fonts.semibold,
      fontSize: 12,
      color: c.link,
      backgroundColor: c.accentSoft,
      borderRadius: radii.pill,
      paddingVertical: 4,
      paddingHorizontal: 9,
      overflow: "hidden",
    },
    compare: {
      gap: 2,
      marginTop: 2,
      marginBottom: 4,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: c.surfaceAlt,
    },
    compareLabel: { fontFamily: fonts.medium, fontSize: 12, color: c.textMuted },
    compareGap: { marginTop: 6 },
    compareLine: { fontFamily: typography.mono.fontFamily, fontSize: 14, letterSpacing: 0.3, color: c.text },
    compareBook: { color: c.accent },

    transposeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginVertical: spacing.xs },
    roundStep: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    transposeReadout: { flex: 1, alignItems: "center" },
    transposeValue: { fontFamily: typography.mono.fontFamily, fontSize: 28, color: c.text },
    transposeUnit: { ...typography.caption, color: c.textMuted, marginTop: 2, textAlign: "center" },
    rangeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 },
    rangeVoice: { ...typography.caption, color: c.textMuted, width: 64, textTransform: "capitalize" },
    rangeSpan: { fontFamily: typography.mono.fontFamily, color: c.text, fontSize: 13, width: 84 },
    rangeStatus: { ...typography.caption, flex: 1, fontFamily: fonts.semibold },

    stepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.xs },
    stepPill: {
      minWidth: 48,
      height: 40,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    stepText: { fontFamily: typography.mono.fontFamily, fontSize: 13, color: c.text },
    stepValue: { flex: 1, textAlign: "center", fontFamily: typography.mono.fontFamily, fontSize: 24, color: c.text },
    meterRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
    meterChip: { flexGrow: 1, alignItems: "center" },

    // ── Notation ──────────────────────────────────────────────────────────────
    /** Solfa | Staff on the left, the Layout button on the right. */
    readingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginTop: 14 },
    /** The Layout button: a quiet 44 px pill naming the solfa layout in use. */
    layoutPill: {
      height: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 14,
      borderRadius: radii.pill,
      backgroundColor: c.surfaceAlt,
    },
    layoutPillText: { fontFamily: fonts.semibold, fontSize: 15, color: c.text },

    notation: { marginTop: 10, minHeight: 120, position: "relative" },
    watermark: { position: "absolute", right: -30, top: 30, opacity: 0.05 },
    gridHint: { fontFamily: fonts.regular, fontSize: 13, color: c.textFaint, marginTop: spacing.sm },

    solfaLineWrap: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.md },
    /** Optional line-number prefix for multi-line results. */
    solfaLineNum: {
      fontFamily: typography.mono.fontFamily,
      color: c.textFaint,
      fontSize: 12,
      marginRight: spacing.sm,
      marginTop: 5,
      width: 14,
      textAlign: "right",
    },
    /** Holds a chord line over its solfa line. */
    solfaLineColumn: { flex: 1 },
    solfaLine: {
      fontFamily: typography.mono.fontFamily,
      color: c.text,
      fontSize: 16,
      lineHeight: 26,
      letterSpacing: 1,
    },
    /** The "Doh is F" line that heads every text layout. */
    solfaHeader: {
      fontFamily: typography.mono.fontFamily,
      color: c.accent,
      fontSize: 13,
      lineHeight: 22,
      letterSpacing: 1,
    },
    /** Same face, size and tracking as `solfaLine`: the alignment is character for character. */
    chordLine: {
      fontFamily: typography.mono.fontFamily,
      color: c.accent,
      fontSize: 16,
      lineHeight: 20,
      letterSpacing: 1,
    },
    /** No notes heard: the sentence, then Record again under it. */
    emptySheet: { gap: spacing.md, alignItems: "flex-start" },
    hymnRow: { flexDirection: "row", marginBottom: spacing.sm },
    hymnBar: { flexDirection: "row", borderLeftWidth: 1, borderLeftColor: c.border, paddingHorizontal: 4 },
    hymnCell: { minWidth: 34, alignItems: "center", marginRight: 2 },
    hymnSolfa: { fontFamily: typography.mono.fontFamily, color: c.text, fontSize: 15 },
    hymnLyric: { fontFamily: fonts.regular, color: c.textMuted, fontSize: 10, minHeight: 14 },
    previewMark: {
      position: "absolute",
      right: spacing.sm,
      bottom: spacing.sm,
      backgroundColor: c.accentSoft,
      borderRadius: radii.pill,
      paddingVertical: 4,
      paddingHorizontal: spacing.sm,
      opacity: 0.9,
    },
    previewMarkText: { ...typography.caption, color: c.accent, fontFamily: fonts.semibold },
    ringLegend: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 10 },
    ringLegendText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.textMuted },

    // ── The amber row ─────────────────────────────────────────────────────────
    check: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      marginTop: 14,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 16,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    checkText: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: c.textMuted },
    checkStrong: { fontFamily: fonts.semibold, color: c.warningText },

    // ── Actions ───────────────────────────────────────────────────────────────
    actions: { flexDirection: "row", justifyContent: "space-between", marginTop: 18 },
    action: { alignItems: "center", gap: 6, flex: 1 },
    actionCircle: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    actionCircleOn: { backgroundColor: c.selectedWash, borderColor: c.accent },
    actionLabel: { fontFamily: fonts.regular, fontSize: 12, color: c.textMuted },
    actionLabelOn: { color: c.link },

    // ── Parts ─────────────────────────────────────────────────────────────────
    voice: { paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
    voiceName: { ...typography.caption, color: c.textMuted, marginBottom: 4 },
    voiceLines: { fontFamily: typography.mono.fontFamily, fontSize: 14, color: c.text, lineHeight: 22 },
    teaser: { backgroundColor: c.accentSoft, borderRadius: radii.md, padding: spacing.md },
    teaserText: { fontFamily: fonts.regular, fontSize: 13, color: c.noticeText, lineHeight: 19 },
    proTag: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      backgroundColor: c.premiumSoft,
      borderRadius: radii.pill,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    proTagText: { ...typography.caption, color: c.premiumText, fontFamily: fonts.semibold, fontSize: 10 },

    // ── Export ────────────────────────────────────────────────────────────────
    exportRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 13 },
    exportRowRule: { borderBottomWidth: 1, borderBottomColor: c.border },
    exportLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 14.5, color: c.text },
    disabled: { opacity: 0.4 },

    // ── Chords ────────────────────────────────────────────────────────────────
    chordsBlock: { marginTop: 22, gap: spacing.xs },
    /** Read, not tapped: no box or border, so nothing here looks like a button. */
    chordChips: { flexDirection: "row", flexWrap: "wrap", rowGap: 2, columnGap: 14, marginTop: spacing.xs },
    chordChip: {
      alignItems: "center",
      minWidth: 30,
      paddingVertical: 4,
    },
    chordChipSymbol: { fontFamily: fonts.semibold, fontSize: 14, color: c.text },
    chordChipSolfa: { fontFamily: typography.mono.fontFamily, color: c.accent, fontSize: 13, marginTop: 1 },
  });
