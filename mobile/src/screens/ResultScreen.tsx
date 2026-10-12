import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "../components/Screen";
import { KeyboardAvoider } from "../components/KeyboardAvoider";
import { Button } from "../components/Button";
import { Touchable } from "../components/Touchable";
import { TextField } from "../components/TextField";
import { NoteEditor } from "../components/NoteEditor";
import { SingAlong } from "../components/SingAlong";
import { Mark } from "../components/night/NightUI";
import ScoreView, { type ScoreViewHandle } from "../components/ScoreView";
import { SheetGrid, barOf } from "../components/result/SheetGrid";
import { PlayerDock, DOCK_CLEARANCE } from "../components/result/PlayerDock";
import { RehearseView } from "../components/result/RehearseView";
import { usePractice } from "../components/result/usePractice";
import { libraryApi, transcriptionsApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import type { ChordSymbol, KeyAlternative, NoteEvent, TranscriptionPart, TranscriptionResult } from "../api/types";
import { chordRows } from "../lib/chordRow";
import { dohChoices, writeInKey } from "../lib/dohChoice";
import { showDialog, type DialogAction } from "../lib/dialog";
import { useSubscription } from "../lib/subscription";
import {
  ascendingFlags,
  deriveSolfa,
  dohHeader,
  dohLetter,
  dohPitchClass,
  KEY_CHOICES,
  parseKey,
  referenceDoh,
  renderSolfaLines,
  sameKey,
  syllable,
} from "../lib/solfa";
import { buildMusicXml, resolveKeySignature } from "../lib/musicxml";
import { synthesizeMelodyWavBase64, synthesizeVoicesWavBase64 } from "../lib/synth";
import { hymnRows, lyricsUnderNotes, pitchName, rangeReport, shiftKeyName, VOICES, type VoiceName } from "../lib/choir";
import { stopAudition } from "../lib/audition";
import { sectionOf } from "../lib/clipRange";
import { rating } from "../lib/rating";
import { exportMidi, exportMusicXml, exportPdf, exportSolfa } from "../lib/export";
import {
  confidenceColor,
  fonts,
  motion,
  radii,
  spacing,
  typography,
  type Palette,
} from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
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
 * A part's solfa lines for a key. The worker labels the parts it returns; a saved sheet
 * (and a transposed one) comes back with pitches only, so the lines are made here. The
 * octave marks are relative to the *melody's* reference doh, as the worker does it, so a
 * bass "d," sits where the tune's "d" does.
 */
function partLines(
  name: VoiceName,
  part: TranscriptionPart,
  melody: readonly NoteEvent[],
  keyText: string,
  timeSignature: string,
): string[] {
  if (part.solfaLines.length > 1) return part.solfaLines;
  const key = parseKey(keyText);
  if (!key || part.notes.length === 0) return [];
  const dohPc = dohPitchClass(key);
  const refDoh = referenceDoh(melody.map((n) => n.pitchMidi), dohPc);
  const flags = ascendingFlags(part.notes.map((n) => n.pitchMidi));
  const labelled = part.notes.map((n, i) => ({ ...n, ...syllable(n.pitchMidi, dohPc, refDoh, flags[i]!) }));
  return renderSolfaLines(labelled, `${dohHeader(dohPc)} · ${name[0]!.toUpperCase()}${name.slice(1)}`, timeSignature);
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

type Panel = "transpose" | "lyrics" | "parts" | "sing" | "export";
type SolfaStyle = "bars" | "grid" | "curwen" | "hymn";

/**
 * ResultScreen — the sheet (night board 04) and, over it, Rehearse (05).
 *
 * Layout (top → bottom):
 *   • Round back / share / save buttons; the sheet's name large, a muted line
 *     under it (artist, section, key) and the song's credit when it has one.
 *   • One row of the numbers that matter — DOH, BPM, TIME, SURE. The first three
 *     open their pickers (re-key and transpose, tempo, meter) beneath the row.
 *   • The notation: a bar to a row, a syllable to a beat, the words beneath, the
 *     mark faint behind it. The same note list can be read as the text grid, as
 *     Curwen, as a hymn layout or on the stave. Every syllable opens the editor.
 *   • One amber row when the model doubted some notes — the way into a review.
 *   • Round actions — transpose, lyrics, SATB, sing, export, more — each opening
 *     its panel below the row.
 *   • The player docked over the bottom; its expand button opens Rehearse.
 *
 * PRD honesty rule: the SURE figure is always visible and coloured by level, and
 * low-confidence notes are amber with a dotted underline so users double-check.
 */
export function ResultScreen({ route, navigation }: Props) {
  const {
    result,
    sourceJobId,
    savedId: initialSavedId,
    title: initialTitle,
  } = route.params;

  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { isPro } = useSubscription();

  const [title, setTitle] = useState(
    initialTitle ?? `${result.key} · ${new Date().toLocaleDateString()}`,
  );
  const [committedTitle, setCommittedTitle] = useState(initialTitle);
  const [savedId, setSavedId] = useState<string | undefined>(initialSavedId);
  const [saving, setSaving] = useState(false);
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

  const [solfaStyle, setSolfaStyle] = useState<SolfaStyle>("bars");
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

  /** The parts' solfa lines, labelled for the current key. */
  const partsView = useMemo(() => {
    if (!parts) return null;
    const out: { name: VoiceName; part: TranscriptionPart; lines: string[] }[] = [];
    for (const name of VOICES) {
      const part = parts[name];
      if (part) out.push({ name, part, lines: partLines(name, part, view.notes, key, timeSignature) });
    }
    return out.length > 0 ? out : null;
  }, [parts, view.notes, key, timeSignature]);

  const barCount = useMemo(() => barCountOf(view.notes, timeSignature), [view.notes, timeSignature]);
  const hasParts = isPro && !!partsView;

  /** The syllable each note carries, for the sheet and for Rehearse's line of words. */
  const lyricsUnder = useMemo(
    () => (hasLyrics ? lyricsUnderNotes(view.notes, lyrics) : null),
    [hasLyrics, view.notes, lyrics],
  );

  // ── Layout state for the sheet's surfaces ───────────────────────────────────
  // One panel under the action row at a time; parts heard from a choir open on
  // arrival, since they are half of what was transcribed.
  const [panel, setPanel] = useState<Panel | null>(result.parts ? "parts" : null);
  const [naming, setNaming] = useState(false);
  const [rehearsing, setRehearsing] = useState(false);

  // The rehearsal mix: the tune plus whichever parts are switched on, re-rendered when
  // any of them changes. Without parts the player keeps the melody preview above.
  useEffect(() => {
    if (!hasParts || !parts) return;
    const voices = [{ notes: voiceOn.soprano ? view.notes : [], gain: 1 }];
    for (const name of VOICES) {
      if (name === "soprano" || !voiceOn[name] || !parts[name]) continue;
      voices.push({ notes: parts[name].notes, gain: 0.8 });
    }
    try {
      setPreview(synthesizeVoicesWavBase64(voices, tempo));
    } catch {
      // preview synthesis is non-fatal
    }
  }, [hasParts, parts, voiceOn, view.notes, tempo]);

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
  const practice = usePractice(preview, view.notes, tempo, timeSignature, barCount);
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
        : result.overallConfidence,
    [draft.notes, edited, result.overallConfidence],
  );

  async function save() {
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
      if (!askingForRating) {
        showDialog({
          title: "Saved",
          message: "Added to your library.",
          icon: "checkmark-circle-outline",
        });
      }
    } catch (e) {
      showDialog({
        title: "Could not save",
        message: toApiError(e).message,
        icon: "alert-circle-outline",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  async function applyKey(next: string) {
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
      setKey(previous); // the label would otherwise disagree with the server
      showDialog({
        title: "Could not change key",
        message: toApiError(e).message,
        icon: "alert-circle-outline",
        tone: "danger",
      });
    } finally {
      setRekeying(false);
    }
  }

  /**
   * The answer to "which doh is it?". Another doh brings its own pitches — a note the singer left
   * between two scale tones is written as that key's tone — so it is the sheet as heard in that key,
   * not a correction: the baseline moves with it, as it does for a transposition.
   */
  async function chooseDoh(choice: KeyAlternative | null) {
    if (!choice) {
      setDoubt([]);
      return;
    }
    const relabelled = deriveSolfa(
      writeInKey(baseline.notes, choice), choice.key, timeSignature, result.chromaticSpelling ?? "direction");
    if (savedId) {
      setRekeying(true);
      try {
        await libraryApi.updateNotes(savedId, relabelled.notes);
        await libraryApi.updateKey(savedId, choice.key);
      } catch (e) {
        showDialog({ title: "Could not change the doh", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
        return;
      } finally {
        setRekeying(false);
      }
    }
    setBaseline({ notes: relabelled.notes, key: choice.key, solfaLines: relabelled.solfaLines });
    setDraft(pristine(relabelled.notes));
    persisted.current = pristine(relabelled.notes);
    setKey(choice.key);
    setPreview(synthesizeMelodyWavBase64(relabelled.notes, tempo));
    setDoubt([]);
    haptics.play("success");
  }

  async function handleTempoChange(nextTempo: number) {
    if (nextTempo < 20 || nextTempo > 300 || nextTempo === tempo) return;
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
      showDialog({
        title: "Could not change tempo",
        message: toApiError(e).message,
        icon: "alert-circle-outline",
        tone: "danger",
      });
    }
  }

  async function handleMeterChange(nextMeter: string) {
    if (nextMeter === timeSignature) return;
    const previous = timeSignature;
    setTimeSignature(nextMeter);
    setPickingMeter(false);
    if (!savedId) return;
    try {
      await libraryApi.updateTimeSignature(savedId, nextMeter);
    } catch (e) {
      setTimeSignature(previous);
      showDialog({
        title: "Could not change meter",
        message: toApiError(e).message,
        icon: "alert-circle-outline",
        tone: "danger",
      });
    }
  }

  // ── Tap-to-correct handlers (F-07) ─────────────────────────────────────────

  /** A free tap on any chip. Prev/Next then walk the whole list. */
  function openNote(index: number) {
    setReviewQueue(null);
    setEditing(index);
  }

  /** "Review them" — a pre-filled path through the notes the model doubted. */
  function startReview() {
    const flagged = view.notes
      .map((n, i) => (n.conf < 0.5 ? i : -1))
      .filter((i) => i >= 0);
    if (flagged.length === 0) return;
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
          "A transcription needs at least one note. Correct its pitch instead.",
        icon: "alert-circle-outline",
      });
      return;
    }

    showDialog({
      title: "Delete this note?",
      message:
        "It leaves the solfa, the stave and the playback. Onsets are absolute, so the notes around it keep their timing and a rest appears in its place.",
      icon: "trash-outline",
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
    if (target.notes === persisted.current.notes) return;

    const rollback = persisted.current;
    persisted.current = target;
    try {
      await libraryApi.updateNotes(savedId, target.notes);
    } catch (e) {
      persisted.current = rollback;
      setDraft(rollback);
      setPreview(synthesizeMelodyWavBase64(rollback.notes, result.tempo));
      showDialog({
        title: "Could not save your corrections",
        message: toApiError(e).message,
        icon: "alert-circle-outline",
        tone: "danger",
      });
    }
  }

  function closeEditor() {
    setEditing(null);
    setReviewQueue(null);
    stopAudition();
    // Synthesising walks every sample on the JS thread, so it happens once here
    // rather than on each nudge, which would jank the stepper.
    if (draft.notes !== result.notes)
      setPreview(synthesizeMelodyWavBase64(draft.notes, result.tempo));
    void commitNotes(draft);
  }

  function discardCorrections() {
    const original = pristine(baseline.notes);
    setDraft(original);
    setPreview(synthesizeMelodyWavBase64(baseline.notes, tempo));
    void commitNotes(original);
  }

  /**
   * Four-part harmony, only when asked: a hummed or sung line is one voice, and alto, tenor
   * and bass under it are an arrangement, not a transcription. A saved sheet keeps them.
   */
  async function writeParts() {
    if (harmonising || view.notes.length === 0) return;
    setHarmonising(true);
    try {
      const written = await transcriptionsApi.harmonise({ key, tempoBpm: Math.round(tempo), timeSignature, notes: view.notes });
      if (!written.parts) {
        showDialog({ title: "Nothing to harmonise yet", message: "The tune needs a few notes before parts can be written under it.", icon: "information-circle-outline" });
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
            icon: "alert-circle-outline",
            tone: "danger",
            actions: [{ label: "Try again", onPress: () => void writeParts() }],
          });
          return;
        }
      }
      setParts(written.parts as Parts);
      setPartsMusicXml(written.partsMusicXml ?? "");
      haptics.play("success");
    } catch (e) {
      showDialog({ title: "Could not write the parts", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
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
    setTransposing(true);
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
      setBaseline({ notes, key: moved.key, solfaLines: relabelled.solfaLines });
      setDraft(pristine(notes));
      persisted.current = pristine(notes);
      setKey(moved.key);
      setParts((moved.parts as Parts | null) ?? null);
      setPartsMusicXml(moved.partsMusicXml ?? "");
      setChords(moved.chords?.length ? moved.chords : null);
      setPreview(synthesizeMelodyWavBase64(notes, tempo));
      setSemitones(0);
      setPickingKey(false);
      setDoubt([]);
      haptics.play("success");
    } catch (e) {
      showDialog({ title: "Could not transpose", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
    } finally {
      setTransposing(false);
    }
  }

  /** Lyrics are saved when the field loses focus, so typing never races the server. */
  async function commitLyrics() {
    const next = lyrics.trim();
    if (!savedId || next === committedLyrics.current) return;
    const previous = committedLyrics.current;
    committedLyrics.current = next;
    try {
      await libraryApi.updateLyrics(savedId, next);
    } catch (e) {
      committedLyrics.current = previous;
      showDialog({ title: "Could not save the lyrics", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
    }
  }

  /** The public link: made once, then handed to the OS share sheet. */
  async function shareLink() {
    if (!savedId) {
      showDialog({
        title: "Save it first",
        message: "A share link points at a sheet in your library. Save this transcription, then share the link.",
        icon: "bookmark-outline",
      });
      return;
    }
    setSharing(true);
    try {
      const link = await libraryApi.share(savedId);
      setShareToken(link.token);
      await Share.share({ message: `${committedTitle || title} — Tonic Solfa on NoteFusion\n${link.url}`, url: link.url });
    } catch (e) {
      showDialog({ title: "Could not share", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
    } finally {
      setSharing(false);
    }
  }

  async function stopSharing() {
    if (!savedId) return;
    setSharing(true);
    try {
      await libraryApi.unshare(savedId);
      setShareToken(null);
    } catch (e) {
      showDialog({ title: "Could not stop sharing", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
    } finally {
      setSharing(false);
    }
  }

  async function rename() {
    if (!savedId) return;
    setRenaming(true);
    try {
      const updated = await libraryApi.rename(savedId, title.trim());
      setCommittedTitle(updated.title);
      showDialog({
        title: "Renamed",
        message: "The title has been updated.",
        icon: "checkmark-circle-outline",
      });
    } catch (e) {
      showDialog({
        title: "Could not rename",
        message: toApiError(e).message,
        icon: "alert-circle-outline",
        tone: "danger",
      });
    } finally {
      setRenaming(false);
    }
  }

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
          icon: "alert-circle-outline",
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
      icon: "star",
      actions: [{ label: "See Pro plans", icon: "star", onPress: () => navigation.navigate("Upgrade") }],
    });
    return false;
  }

  async function handleExportPdf() {
    if (!requirePro()) return;
    setExportingType("pdf");
    try {
      const svg = await scoreRef.current?.getSvg();
      if (!svg) {
        showDialog({
          title: "Open the Staff view first",
          message: "The PDF is made from the engraved stave. Switch to Staff, wait for it to draw, then export.",
          icon: "information-circle-outline",
        });
        return;
      }
      const outcome = await exportPdf(svg, {
        title: committedTitle || title,
        credit: credit ? `Lead vocal transcribed from “${credit}” with NoteFusion` : null,
        key,
        tempoBpm: tempo,
        timeSignature,
        solfaLines: activeSolfaLines,
        hymn: hasLyrics ? hymn : undefined,
        parts: partsView?.filter((p) => p.name !== "soprano").map((p) => ({ name: p.name, lines: p.lines })),
      });
      if (!outcome.ok) {
        showDialog({ title: "Could not export PDF", message: outcome.message, icon: "alert-circle-outline", tone: "danger" });
      }
    } finally {
      setExportingType(null);
    }
  }

  async function handleExportMidi() {
    if (!requirePro()) return;
    setExportingType("midi");
    try {
      const outcome = await exportMidi(result.midiBase64, title);
      if (!outcome.ok) {
        showDialog({
          title: "Could not export MIDI",
          message: outcome.message,
          icon: "alert-circle-outline",
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
          icon: "alert-circle-outline",
          tone: "danger",
        });
      }
    } finally {
      setExportingType(null);
    }
  }


  const hasScore = scoreXml.length > 0;

  const insets = useSafeAreaInsets();
  const shownTitle = committedTitle || title;
  const doh = dohLetter(key);
  const surePct = Math.round(overallConfidence * 100);
  const subtitle = [result.source ? result.source.artist || provider : null, section, key]
    .filter(Boolean)
    .join(" · ");
  /** The first doubtful note, named in the amber row so the ear knows where to go. */
  const firstLow = view.notes.find((n) => n.conf < 0.5);

  function goBack() {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Tabs", { screen: "Home" });
  }

  /** The DOH stat and the Transpose action open the same controls; only one copy shows. */
  function toggleKeyPicker() {
    setPickingKey((p) => !p);
    setPickingTempo(false);
    setPickingMeter(false);
    if (panel === "transpose") setPanel(null);
  }

  function togglePanel(next: Panel) {
    setPanel((p) => (p === next ? null : next));
    if (next === "transpose") setPickingKey(false);
  }

  function openOptions() {
    const actions: DialogAction[] = [
      {
        // Straight to the notes that need it when the model flagged some,
        // otherwise to the first note — the sheet itself is the other way in.
        label: "Edit notes",
        icon: "create-outline",
        onPress: () => (lowCount > 0 ? startReview() : openNote(0)),
      },
      {
        label: "Export MusicXML",
        icon: "download-outline",
        onPress: () => void exportScore(),
      },
    ];
    if (edited) {
      actions.push({
        label: "Discard corrections",
        icon: "refresh-outline",
        onPress: discardCorrections,
      });
    }
    if (savedId) {
      actions.push({
        label: "Delete from Library",
        style: "destructive",
        icon: "trash-outline",
        onPress: async () => {
          try {
            await libraryApi.remove(savedId);
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.navigate("Tabs", { screen: "Library" });
            }
          } catch (e) {
            showDialog({
              title: "Could not delete",
              message: toApiError(e).message,
              icon: "alert-circle-outline",
              tone: "danger",
            });
          }
        },
      });
    }
    actions.push({ label: "Cancel", style: "cancel" });

    showDialog({
      title: "Transcription options",
      icon: "ellipsis-horizontal",
      actions,
    });
  }

  /**
   * Re-key and transpose. Movable-do means re-keying is a re-labelling, not a
   * re-transcription: the notes never move, only the syllables above them.
   * Transposing is the one edit that moves them. Opened from the DOH stat or the
   * Transpose action, so it is drawn by one function.
   */
  const keyControls = (
    <View style={styles.panel}>
      <Text style={styles.panelEyebrow}>Doh</Text>
      <Text style={styles.panelHint}>
        Change the Doh — your notes stay put, only the labels move.
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipScroll}
      >
        {KEY_CHOICES.map((k) => {
          const on = sameKey(k, key);
          return (
            <Touchable
              key={k}
              style={[styles.chip, on && styles.chipOn]}
              radius={radii.pill}
              onPress={() => (on ? undefined : applyKey(k))}
              disabled={rekeying}
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Change key to ${k}`}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{k}</Text>
            </Touchable>
          );
        })}
      </ScrollView>

      {/* Transpose for my choir: the one edit that moves the notes. */}
      <View style={styles.panelDivider} />
      <Text style={styles.panelEyebrow}>Transpose for my choir</Text>
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
          <Ionicons name="remove" size={18} color={colors.text} />
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
          <Ionicons name="add" size={18} color={colors.text} />
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
              r.status === "ok" ? { color: colors.success } : { color: r.overBy > 2 ? colors.danger : colors.warning },
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
        icon="swap-vertical-outline"
        onPress={applyTranspose}
        loading={transposing}
        disabled={semitones === 0}
        style={styles.panelButton}
      />
    </View>
  );

  const notationChoices: { id: SolfaStyle | "staff"; label: string; a11y: string }[] = [
    { id: "bars", label: "Solfa", a11y: "Show tonic solfa by bar" },
    { id: "grid", label: "Grid", a11y: "Show the solfa grid" },
    { id: "curwen", label: "Curwen", a11y: "Show Curwen solfa" },
    ...(hasLyrics ? [{ id: "hymn" as const, label: "Hymn", a11y: "Show the hymn layout" }] : []),
    { id: "staff", label: "Staff", a11y: "Show staff notation" },
  ];
  const notationChoice = notationView === "staff" ? "staff" : solfaStyle;
  const nothingToShow = solfaStyle === "bars" ? view.notes.length === 0 : activeSolfaLines.length === 0;

  return (
    <Screen contentStyle={styles.screen}>
      <KeyboardAvoider>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: (preview ? DOCK_CLEARANCE : spacing.xl) + insets.bottom },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Top bar ──────────────────────────────────────────────────── */}
          <View style={styles.topBar}>
            <IconButton icon="chevron-back" label="Go back" onPress={goBack} />
            <View style={styles.topActions}>
              <IconButton
                icon="share-outline"
                label={shareToken ? "Share the link again" : "Share a link"}
                onPress={() => void shareLink()}
                busy={sharing}
              />
              <IconButton
                icon={savedId ? "bookmark" : "bookmark-outline"}
                label={savedId ? "Saved to Library. Rename" : "Save to library"}
                onPress={() => setNaming((n) => !n)}
                tint={savedId ? colors.accent : undefined}
                active={naming}
              />
            </View>
          </View>

          {/* ── Title ───────────────────────────────────────────────────── */}
          <Touchable
            onPress={() => setNaming((n) => !n)}
            ripple={false}
            scaleTo={motion.scale.row}
            haptic="none"
            accessibilityRole="button"
            accessibilityLabel={`${shownTitle}. ${savedId ? "Rename" : "Name and save"}`}
          >
            <Text style={styles.title}>{shownTitle}</Text>
          </Touchable>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          {naming ? (
            <View style={styles.panel}>
              {savedId ? (
                <View style={styles.savedLine}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                  <Text style={styles.savedText}>Saved to Library · you can find it in the Library tab.</Text>
                </View>
              ) : (
                <Text style={styles.panelHint}>Give this transcription a name so you can find it later.</Text>
              )}
              <TextField
                label="Title"
                value={title}
                onChangeText={setTitle}
                placeholder="Name this transcription…"
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
                  icon="bookmark"
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
                  <Ionicons name="musical-notes" size={16} color={colors.textMuted} />
                </View>
              )}
              <View style={styles.creditBody}>
                <Text style={styles.creditTitle} numberOfLines={1}>{result.source.title}</Text>
                <Text style={styles.creditLine} numberOfLines={1}>Lead vocal, transcribed with NoteFusion</Text>
              </View>
            </View>
          ) : null}
          {result.source?.preview && result.source.notice ? (
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
            <Stat
              value={doh}
              caption={rekeying ? "Saving" : "Doh"}
              onPress={toggleKeyPicker}
              active={pickingKey}
              accessibilityLabel={`Key ${key}, doh is ${doh}. Change key`}
            />
            <Stat
              value={String(tempo)}
              caption="BPM"
              onPress={() => {
                setPickingTempo((p) => !p);
                setPickingKey(false);
                setPickingMeter(false);
              }}
              active={pickingTempo}
              accessibilityLabel={`Tempo ${tempo} BPM. Change tempo`}
            />
            <Stat
              value={timeSignature}
              caption="Time"
              onPress={() => {
                setPickingMeter((p) => !p);
                setPickingKey(false);
                setPickingTempo(false);
              }}
              active={pickingMeter}
              accessibilityLabel={`Time signature ${timeSignature}. Change meter`}
            />
            <Stat
              value={String(surePct)}
              unit="%"
              caption="Sure"
              color={confidenceColor(overallConfidence, colors)}
              accessibilityLabel={`${surePct} percent sure`}
            />
          </View>

          {doubt.length > 0 && !edited && !parts ? (
            <View style={styles.panel}>
              <Text style={styles.panelEyebrow}>Which doh is it?</Text>
              <Text style={styles.panelHint}>
                Your tune fits more than one doh about as well. Tap the one you sang in — notes you left
                between two tones are written in its scale.
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                <Touchable
                  style={[styles.chip, styles.chipOn]}
                  radius={radii.pill}
                  onPress={() => chooseDoh(null)}
                  disabled={rekeying}
                  accessibilityLabel={`Keep doh as ${doh}`}
                >
                  <Text style={[styles.chipText, styles.chipTextOn]}>Doh is {doh}</Text>
                </Touchable>
                {doubt.map((choice) => (
                  <Touchable
                    key={choice.key}
                    style={styles.chip}
                    radius={radii.pill}
                    onPress={() => chooseDoh(choice)}
                    disabled={rekeying}
                    accessibilityLabel={`Doh is ${dohLetter(choice.key)}`}
                  >
                    <Text style={styles.chipText}>Doh is {dohLetter(choice.key)}</Text>
                  </Touchable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {pickingKey ? keyControls : null}

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

          {/* ── How to read it: solfa by bar, the text grid, Curwen, hymn, stave ── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.viewsScroll}
            contentContainerStyle={styles.views}
          >
            {notationChoices.map((v) => {
              const on = notationChoice === v.id;
              return (
                <Touchable
                  key={v.id}
                  onPress={() => {
                    if (v.id === "staff") {
                      setNotationView("staff");
                    } else {
                      setNotationView("solfa");
                      setSolfaStyle(v.id);
                    }
                  }}
                  style={[styles.viewChip, on && styles.viewChipOn]}
                  radius={radii.pill}
                  haptic="none"
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={v.a11y}
                >
                  <Text style={[styles.viewChipText, on && styles.viewChipTextOn]}>{v.label}</Text>
                </Touchable>
              );
            })}
          </ScrollView>

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
                <Text style={styles.solfaMuted}>No solfa lines produced.</Text>
              ) : solfaStyle === "bars" ? (
                <>
                  <SheetGrid
                    notes={view.notes}
                    lyrics={lyricsUnder}
                    chords={chordView}
                    timeSignature={timeSignature}
                    barCount={barCount}
                    playingNote={playingNote}
                    onSelectNote={openNote}
                  />
                  <Text style={styles.gridHint}>Tap a syllable to fix it.</Text>
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
            ) : (
              <View>
                <ScoreView
                  ref={scoreRef}
                  notes={view.notes}
                  timeSignature={result.timeSignature}
                  musicalKey={key}
                  cursorBeat={cursorBeat}
                  onSelectNote={openNote}
                />
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

          {/* One amber row when the model doubted some notes. Tapping opens the piano on
              the flagged piece: a doubtful note is a *pitch* question, and the fastest
              answer to one is pressing the key and hearing it. */}
          {lowCount > 0 && firstLow ? (
            <Touchable
              style={styles.check}
              onPress={startReview}
              scaleTo={motion.scale.row}
              radius={16}
              accessibilityLabel={`Review ${lowCount} low-confidence notes`}
            >
              <Text style={styles.checkText} numberOfLines={1}>
                <Text style={styles.checkStrong}>
                  {lowCount} note{lowCount > 1 ? "s" : ""} to check
                </Text>
                {` · ${firstLow.solfa}${firstLow.octaveMark} in bar ${barOf(firstLow, timeSignature)}`}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.warning} />
            </Touchable>
          ) : null}

          {/* ── Actions ─────────────────────────────────────────────────────── */}
          <View style={styles.actions}>
            <Action icon="swap-vertical" label="Transpose" active={panel === "transpose"} onPress={() => togglePanel("transpose")} />
            <Action icon="text-outline" label="Lyrics" active={panel === "lyrics"} onPress={() => togglePanel("lyrics")} />
            <Action icon="people-outline" label="SATB" active={panel === "parts"} onPress={() => togglePanel("parts")} />
            <Action icon="mic-outline" label="Sing" active={panel === "sing"} onPress={() => togglePanel("sing")} />
            <Action icon="document-outline" label="Export" active={panel === "export"} onPress={() => togglePanel("export")} />
            <Action icon="ellipsis-horizontal" label="More" onPress={openOptions} accessibilityLabel="Transcription options" />
          </View>

          {panel === "transpose" ? keyControls : null}

          {/* ── Lyrics: the words under the solfa ──────────────────────────── */}
          {panel === "lyrics" ? (
            <View style={styles.panel}>
              <TextField
                label="Lyrics"
                value={lyrics}
                onChangeText={setLyrics}
                onBlur={() => void commitLyrics()}
                placeholder="A-ma-zing grace, how sweet the sound…"
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
                <Text style={styles.panelTitle}>
                  {result.partsSource === "heard" ? "The four parts, as sung" : "Four-part harmony"}
                </Text>
                {!isPro ? <ProTag /> : null}
              </View>
              {isPro && partsView ? (
                partsView.map(({ name, lines }) => (
                  <View key={name} style={styles.voice}>
                    <Text style={styles.voiceName}>{name.charAt(0).toUpperCase() + name.slice(1)}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <Text style={styles.voiceLines}>{lines.slice(1).join("\n")}</Text>
                    </ScrollView>
                  </View>
                ))
              ) : isPro ? (
                <>
                  <Text style={styles.panelHint}>
                    The sheet shows the voice we heard. When you want a choir arrangement, alto, tenor and bass are written under it the way a hymn arranger would.
                  </Text>
                  <Button
                    label="Write alto, tenor and bass"
                    variant="secondary"
                    icon="people-outline"
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
                onRequirePro={() => void requirePro()}
              />
            ) : (
              <Text style={styles.panelHint}>There are no notes to sing yet.</Text>
            )
          ) : null}

          {/* ── Export & Share ─────────────────────────────────────────────────── */}
          {panel === "export" ? (
            <View style={styles.panel}>
              <Text style={styles.panelHint}>
                {isPro
                  ? "Share the solfa to your choir group, or download the sheet as PDF, MusicXML or MIDI."
                  : "Sharing the solfa is free. PDF, MusicXML and MIDI downloads come with Pro."}
              </Text>
              <ExportRow
                icon="link-outline"
                label={shareToken ? "Share the link again" : "Share a link"}
                onPress={() => void shareLink()}
                busy={sharing}
              />
              {shareToken ? (
                <View style={styles.sharedRow}>
                  <Ionicons name="globe-outline" size={14} color={colors.success} />
                  <Text style={styles.sharedText}>Anyone with the link can open this sheet, with playback.</Text>
                  <Touchable onPress={stopSharing} disabled={sharing} accessibilityLabel="Stop sharing">
                    <Text style={styles.sharedStop}>Stop</Text>
                  </Touchable>
                </View>
              ) : null}
              <ExportRow
                icon="chatbubbles-outline"
                label="Share Tonic Solfa text"
                onPress={() => void handleExportSolfa()}
                busy={exportingType === "solfa"}
              />
              <ExportRow
                icon="document-outline"
                label="Download PDF"
                pro={!isPro}
                onPress={() => void handleExportPdf()}
                busy={exportingType === "pdf"}
                disabled={!hasScore}
              />
              <ExportRow
                icon="musical-notes-outline"
                label="MIDI"
                pro={!isPro}
                onPress={() => void handleExportMidi()}
                busy={exportingType === "midi"}
                disabled={isPro && !result.midiBase64}
              />
              <ExportRow
                icon="document-text-outline"
                label="MusicXML"
                pro={!isPro}
                onPress={() => void exportScore()}
                busy={exportingType === "musicxml"}
                disabled={!hasScore}
                last
              />
            </View>
          ) : null}

          {/* ── Chords: the progression heard, symbol over its solfa ───────── */}
          {chordView ? (
            <View style={styles.chordsBlock}>
              <Text style={styles.eyebrow}>Chords</Text>
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

      {/* ── Playback: hear the tune; Rehearse to loop, slow down and mute parts ─ */}
      {preview ? <PlayerDock practice={practice} onRehearse={() => setRehearsing(true)} /> : null}

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
      />
    </Screen>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

/** The board's 40px round icon button: surface fill, hairline border. */
function IconButton({
  icon,
  label,
  onPress,
  busy,
  tint,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  busy?: boolean;
  tint?: string;
  active?: boolean;
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
      {busy ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name={icon} size={19} color={tint ?? colors.text} />}
    </Touchable>
  );
}

/** One figure in the stats row: big value, tiny uppercase caption. */
function Stat({
  value,
  unit,
  caption,
  color,
  onPress,
  active,
  accessibilityLabel,
}: {
  value: string;
  unit?: string;
  caption: string;
  color?: string;
  onPress?: () => void;
  active?: boolean;
  accessibilityLabel: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const body = (
    <>
      <Text style={[styles.statValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </Text>
      <Text style={[styles.statCaption, active && styles.statCaptionActive]}>{caption}</Text>
    </>
  );
  // Only the stats that change something get a touch target, so SURE doesn't
  // advertise an affordance it doesn't have.
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

/** A round action with its name beneath. */
function Action({
  icon,
  label,
  onPress,
  active,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
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
        <Ionicons name={icon} size={20} color={active ? colors.accent : colors.text} />
      </View>
      <Text style={[styles.actionLabel, active && styles.actionLabelOn]} numberOfLines={1}>
        {label}
      </Text>
    </Touchable>
  );
}

function ProTag() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.proTag}>
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
  icon: keyof typeof Ionicons.glyphMap;
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
      <Ionicons name={pro ? "lock-closed-outline" : icon} size={18} color={colors.accent} />
      <Text style={styles.exportLabel}>{label}</Text>
      {busy ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : pro ? (
        <ProTag />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
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
    subtitle: { fontFamily: fonts.regular, fontSize: 13.5, color: c.textMuted, marginTop: 6 },

    credit: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: 14 },
    creditThumb: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.surfaceAlt },
    creditThumbEmpty: { alignItems: "center", justifyContent: "center" },
    creditBody: { flex: 1, minWidth: 0 },
    creditTitle: { fontFamily: fonts.medium, fontSize: 13.5, color: c.text },
    creditLine: { fontFamily: fonts.regular, fontSize: 12, color: c.textFaint, marginTop: 2 },
    notice: {
      fontFamily: fonts.regular,
      fontSize: 12.5,
      lineHeight: 18,
      color: c.accentAlt,
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
    statUnit: { fontSize: 16, letterSpacing: 0 },
    statCaption: {
      fontFamily: fonts.medium,
      fontSize: 10.5,
      letterSpacing: 1.5,
      textTransform: "uppercase",
      color: c.textMuted,
      marginTop: 6,
    },
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
    panelHint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: c.textMuted },
    panelDivider: { height: 1, backgroundColor: c.border, marginVertical: spacing.sm },
    panelButton: { marginTop: spacing.xs },
    eyebrow: {
      fontFamily: fonts.medium,
      fontSize: 12,
      letterSpacing: 1.7,
      textTransform: "uppercase",
      color: c.textMuted,
      marginBottom: spacing.xs,
    },
    savedLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    savedText: { fontFamily: fonts.medium, fontSize: 13, color: c.text, flex: 1 },

    chipScroll: { gap: spacing.xs, paddingRight: spacing.md },
    chip: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radii.pill,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    /** `ink`, not `accent`: a fill under a white label, so it stays deep in both modes. */
    chipOn: { backgroundColor: c.ink, borderColor: c.ink },
    chipText: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted },
    chipTextOn: { fontFamily: fonts.semibold, color: c.onInk },

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
    meterRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
    meterChip: { flexGrow: 1, alignItems: "center" },

    // ── Notation ──────────────────────────────────────────────────────────────
    viewsScroll: { marginTop: 14, marginHorizontal: -22 },
    views: { paddingHorizontal: 22, gap: 6 },
    viewChip: {
      paddingVertical: 6,
      paddingHorizontal: 13,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
    },
    viewChipOn: { backgroundColor: c.surfaceAlt, borderColor: c.textFaint },
    viewChipText: { fontFamily: fonts.medium, fontSize: 12.5, color: c.textMuted },
    viewChipTextOn: { color: c.text },

    notation: { marginTop: 10, minHeight: 120, position: "relative" },
    watermark: { position: "absolute", right: -30, top: 30, opacity: 0.05 },
    gridHint: { fontFamily: fonts.regular, fontSize: 12, color: c.textFaint, marginTop: spacing.sm },

    solfaLineWrap: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.md },
    /** Optional line-number prefix for multi-line results. */
    solfaLineNum: {
      fontFamily: typography.mono.fontFamily,
      color: c.textFaint,
      fontSize: 10,
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
    solfaMuted: { ...typography.body, color: c.textFaint, fontStyle: "italic" },
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
      backgroundColor: c.premiumSoft,
      borderWidth: 1,
      borderColor: c.premiumBorder,
    },
    checkText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: c.textMuted },
    checkStrong: { fontFamily: fonts.semibold, color: c.warning },

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
    actionCircleOn: { backgroundColor: c.accentSoft, borderColor: c.accentGlow },
    actionLabel: { fontFamily: fonts.regular, fontSize: 11.5, color: c.textMuted },
    actionLabelOn: { color: c.accent },

    // ── Parts ─────────────────────────────────────────────────────────────────
    voice: { paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
    voiceName: { ...typography.caption, color: c.textMuted, marginBottom: 4 },
    voiceLines: { fontFamily: typography.mono.fontFamily, fontSize: 14, color: c.text, lineHeight: 22 },
    teaser: { backgroundColor: c.accentSoft, borderRadius: radii.md, padding: spacing.md },
    teaserText: { fontFamily: fonts.regular, fontSize: 13, color: c.accentAlt, lineHeight: 19 },
    proTag: {
      backgroundColor: c.premiumSoft,
      borderRadius: radii.pill,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    proTagText: { ...typography.caption, color: c.premium, fontFamily: fonts.semibold, fontSize: 10 },

    // ── Export ────────────────────────────────────────────────────────────────
    exportRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 13 },
    exportRowRule: { borderBottomWidth: 1, borderBottomColor: c.border },
    exportLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 14.5, color: c.text },
    disabled: { opacity: 0.4 },
    sharedRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      backgroundColor: c.surfaceAlt,
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: spacing.md,
    },
    sharedText: { ...typography.caption, color: c.textMuted, flex: 1, lineHeight: 16 },
    sharedStop: { ...typography.caption, color: c.danger, fontFamily: fonts.semibold, paddingHorizontal: 4 },

    // ── Chords ────────────────────────────────────────────────────────────────
    chordsBlock: { marginTop: 22, gap: spacing.xs },
    chordChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
    chordChip: {
      alignItems: "center",
      minWidth: 44,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: 12,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    chordChipSymbol: { fontFamily: fonts.semibold, fontSize: 14, color: c.text },
    chordChipSolfa: { fontFamily: typography.mono.fontFamily, color: c.accent, fontSize: 13, marginTop: 1 },
  });
