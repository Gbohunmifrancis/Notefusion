import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Touchable } from "../components/Touchable";
import { TextField } from "../components/TextField";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { NotePlayer } from "../components/NotePlayer";
import { NoteEditor } from "../components/NoteEditor";
import { SingAlong } from "../components/SingAlong";
import ScoreView, { type ScoreViewHandle } from "../components/ScoreView";
import { libraryApi, transcriptionsApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import type { NoteEvent, TranscriptionPart, TranscriptionResult } from "../api/types";
import { showDialog, type DialogAction } from "../lib/dialog";
import { useSubscription } from "../lib/subscription";
import {
  ascendingFlags,
  deriveSolfa,
  dohHeader,
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
import { hymnRows, pitchName, rangeReport, shiftKeyName, VOICES, type VoiceName } from "../lib/choir";
import { stopAudition } from "../lib/audition";
import { exportMidi, exportMusicXml, exportPdf, exportSolfa } from "../lib/export";
import {
  confidenceColor,
  fonts,
  gradients,
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

/**
 * ResultScreen — light blue transcription result.
 *
 * Layout (top → bottom):
 *   • Back arrow + "Transcription Complete" title row.
 *   • Summary glass card: Key, Tempo, Meter chips + ConfidenceBadge + warn row.
 *   • Hero Solfa white card:
 *       – Gradient header bar ("TONIC SOLFA" label).
 *       – Large monospace solfa lines in Ink Navy.
 *       – Confidence pill badge (green / amber / red) inside the card.
 *   • Horizontal notes grid: each chip shows the solfa symbol, MIDI number,
 *     and a coloured confidence bar at the bottom. Tapping one opens the
 *     tap-to-correct sheet (F-07).
 *   • Export row: hands the engraved MusicXML to the OS share sheet.
 *   • Save block: TextField + gradient "Save to Library" button.
 *   • Saved state: blue-glowing checkmark row.
 *
 * PRD honesty rule: overall-confidence banner is always visible; low-confidence
 * notes are outlined in red so users know to double-check — and the banner is
 * the way into a guided review of exactly those notes.
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
  const credit = result.source
    ? `${result.source.title}${result.source.artist ? ` — ${result.source.artist}` : ""} (${
        { youtube: "YouTube", spotify: "Spotify", apple_music: "Apple Music" }[result.source.provider] ?? result.source.provider
      })`
    : null;

  // ── Key override (F-03) ────────────────────────────────────────────────────
  // Solfa is movable-do, so a key change re-labels the existing notes — it
  // never re-transcribes. The syllables update locally the instant the user
  // taps, and the choice is persisted only for transcriptions already saved.
  const [key, setKey] = useState(result.key);
  const [pickingKey, setPickingKey] = useState(false);
  const [rekeying, setRekeying] = useState(false);

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

  /** Note the player is sounding, −1 when stopped. Drives the stave's cursor. */
  const [playingNote, setPlayingNote] = useState(-1);

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

  const [solfaStyle, setSolfaStyle] = useState<"grid" | "curwen" | "hymn">("grid");
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

  const lowCount = useMemo(
    () => view.notes.filter((n) => n.conf < 0.5).length,
    [view.notes],
  );

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
      showDialog({
        title: "Saved",
        message: "Added to your library.",
        icon: "checkmark-circle-outline",
      });
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
          }))
        : await transcriptionsApi.transpose({
            key,
            semitones,
            notes: view.notes,
            musicXml: scoreXml || result.musicXml,
            parts,
            partsMusicXml: partsMusicXml || null,
          });
      const relabelled = deriveSolfa(moved.notes, moved.key, timeSignature, result.chromaticSpelling ?? "direction");
      const notes = relabelled.notes;
      setBaseline({ notes, key: moved.key, solfaLines: relabelled.solfaLines });
      setDraft(pristine(notes));
      persisted.current = pristine(notes);
      setKey(moved.key);
      setParts((moved.parts as Parts | null) ?? null);
      setPartsMusicXml(moved.partsMusicXml ?? "");
      setPreview(synthesizeMelodyWavBase64(notes, tempo));
      setSemitones(0);
      setPickingKey(false);
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

  const confColor = confidenceColor(result.overallConfidence, colors);
  const confPct = Math.round(result.overallConfidence * 100);

  return (
    <Screen scroll>
      {/* ── Header row ───────────────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <Touchable
          onPress={() =>
            navigation.canGoBack()
              ? navigation.goBack()
              : navigation.navigate("Tabs", { screen: "Home" })
          }
          style={styles.backBtn}
          hitSlop={8}
          ripple="borderless"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Touchable>

        <View style={styles.titleGroup}>
          <Text style={styles.pageTitle}>{result.source ? "Song" : "Preview"}</Text>
          {/* Small gold mark — the same premium accent as the avatar ring and the
              Home chip, sized down to a header ornament. */}
          {isPro && (
            <View style={styles.proMark}>
              <Ionicons name="star" size={10} color={colors.premiumDeep} />
            </View>
          )}
        </View>

        <Touchable
          onPress={() => {
            const actions: DialogAction[] = [
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
          }}
          style={styles.optionsBtn}
          hitSlop={8}
          ripple="borderless"
          accessibilityLabel="Transcription options"
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
        </Touchable>
      </View>

      {/* ── Song credit: a linked song is acknowledged by title and artist ─── */}
      {result.source ? (
        <Card style={styles.creditCard}>
          {result.source.thumbnailUrl ? (
            <Image source={{ uri: result.source.thumbnailUrl }} style={styles.creditThumb} />
          ) : (
            <View style={[styles.creditThumb, { alignItems: "center", justifyContent: "center" }]}>
              <Ionicons name="musical-notes" size={22} color={colors.textMuted} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.creditTitle} numberOfLines={2}>{result.source.title}</Text>
            {result.source.artist ? <Text style={styles.creditArtist} numberOfLines={1}>{result.source.artist}</Text> : null}
            <Text style={styles.creditLine}>Lead vocal, transcribed with NoteFusion</Text>
          </View>
        </Card>
      ) : null}
      {result.source?.preview && result.source.notice ? (
        <Text style={styles.truncatedNote}>{result.source.notice}</Text>
      ) : result.truncated ? (
        <Text style={styles.truncatedNote}>
          {isPro
            ? "The first six minutes of the song were transcribed."
            : "Free preview: the first minute. Upgrade to Pro for the whole song and the PDF."}
        </Text>
      ) : null}

      {/* ── Summary card ─────────────────────────────────────────────────── */}
      <Card style={styles.summaryCard}>
        {/* Three stat chips */}
        <View style={styles.summaryRow}>
          <SummaryStat
            icon="key-outline"
            label={rekeying ? "Saving…" : "Key · tap"}
            value={key}
            accent={colors.purple}
            onPress={() => {
              setPickingKey((p) => !p);
              setPickingTempo(false);
              setPickingMeter(false);
            }}
          />
          <View style={styles.summaryDivider} />
          <SummaryStat
            icon="speedometer-outline"
            label="Tempo · tap"
            value={`${tempo} BPM`}
            accent={colors.gold}
            onPress={() => {
              setPickingTempo((p) => !p);
              setPickingKey(false);
              setPickingMeter(false);
            }}
          />
          <View style={styles.summaryDivider} />
          <SummaryStat
            icon="grid-outline"
            label="Meter · tap"
            value={timeSignature}
            accent={colors.success}
            onPress={() => {
              setPickingMeter((p) => !p);
              setPickingKey(false);
              setPickingTempo(false);
            }}
          />
        </View>

        {/* ── Key picker (F-03) ────────────────────────────────────────────
            Movable-do means this is a re-labelling, not a re-transcription:
            the notes never move, only the syllables above them. */}
        {pickingKey && (
          <View style={styles.keyPicker}>
            <Text style={styles.keyPickerHint}>
              Change the Doh — your notes stay put, only the labels move.
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.keyPickerScroll}
            >
              {KEY_CHOICES.map((k) =>
                sameKey(k, key) ? (
                  <LinearGradient
                    key={k}
                    colors={gradients.brand}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.keyChip, styles.keyChipActive]}
                  >
                    <Text style={styles.keyChipTextActive}>{k}</Text>
                  </LinearGradient>
                ) : (
                  <Touchable
                    key={k}
                    style={styles.keyChip}
                    radius={radii.pill}
                    onPress={() => applyKey(k)}
                    disabled={rekeying}
                    accessibilityLabel={`Change key to ${k}`}
                  >
                    <Text style={styles.keyChipText}>{k}</Text>
                  </Touchable>
                ),
              )}
            </ScrollView>

            {/* Transpose for my choir: the one edit that moves the notes. */}
            <View style={styles.transposeBlock}>
              <Text style={styles.transposeTitle}>Transpose for my choir</Text>
              <Text style={styles.keyPickerHint}>
                Moves every note so the parts sit in your singers' range. The solfa reads exactly as before — only Doh moves.
              </Text>
              <View style={styles.transposeRow}>
                <Touchable
                  style={styles.transposeStep}
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
                  style={styles.transposeStep}
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
                style={styles.transposeApply}
              />
            </View>
          </View>
        )}

        {/* ── Tempo picker (F-07) ────────────────────────────────────────── */}
        {pickingTempo && (
          <View style={styles.tempoPicker}>
            <Text style={styles.pickerHint}>
              Adjust playback tempo (20–300 BPM). Notes and beats realign in real time.
            </Text>
            <View style={styles.tempoStepperRow}>
              <Touchable
                onPress={() => handleTempoChange(Math.max(20, tempo - 5))}
                style={styles.tempoStepBtn}
                accessibilityLabel="Decrease tempo by 5 BPM"
              >
                <Text style={styles.tempoStepText}>-5</Text>
              </Touchable>
              <Touchable
                onPress={() => handleTempoChange(Math.max(20, tempo - 1))}
                style={styles.tempoStepBtn}
                accessibilityLabel="Decrease tempo by 1 BPM"
              >
                <Text style={styles.tempoStepText}>-1</Text>
              </Touchable>
              <View style={styles.tempoDisplayBadge}>
                <Text style={styles.tempoDisplayText}>{tempo} BPM</Text>
              </View>
              <Touchable
                onPress={() => handleTempoChange(Math.min(300, tempo + 1))}
                style={styles.tempoStepBtn}
                accessibilityLabel="Increase tempo by 1 BPM"
              >
                <Text style={styles.tempoStepText}>+1</Text>
              </Touchable>
              <Touchable
                onPress={() => handleTempoChange(Math.min(300, tempo + 5))}
                style={styles.tempoStepBtn}
                accessibilityLabel="Increase tempo by 5 BPM"
              >
                <Text style={styles.tempoStepText}>+5</Text>
              </Touchable>
            </View>
          </View>
        )}

        {/* ── Meter picker ────────────────────────────────────────────────── */}
        {pickingMeter && (
          <View style={styles.meterPicker}>
            <Text style={styles.pickerHint}>
              Select time signature. Re-groups bars for Curwen solfa and staff notation.
            </Text>
            <View style={styles.meterPillsRow}>
              {(["4/4", "3/4", "2/4", "6/8", "12/8"] as const).map((m) => (
                <Touchable
                  key={m}
                  onPress={() => handleMeterChange(m)}
                  style={[
                    styles.meterPill,
                    timeSignature === m && styles.meterPillActive,
                  ]}
                  accessibilityLabel={`Set meter to ${m}`}
                >
                  <Text
                    style={[
                      styles.meterPillText,
                      timeSignature === m && styles.meterPillTextActive,
                    ]}
                  >
                    {m}
                  </Text>
                </Touchable>
              ))}
            </View>
          </View>
        )}

        {/* Full confidence badge */}
        <View style={styles.confRow}>
          <ConfidenceBadge value={overallConfidence} />
        </View>

        {/* Low-confidence warning — now with somewhere to go. Tapping opens the piano
            on the flagged piece: a doubtful note is a *pitch* question, and the
            fastest answer to one is pressing the key and hearing it. The stepper is
            still there for a note that is only a semitone out — the notes grid opens
            it — so nothing is lost by making this the wider door. */}
        {lowCount > 0 && (
          <Touchable
            style={styles.warnRow}
            onPress={startReview}
            // A full-bleed row inside the card: a deeper press would pull it away
            // from both card edges at once.
            scaleTo={motion.scale.row}
            accessibilityLabel={`Review ${lowCount} low-confidence notes`}
          >
            <View style={styles.warnDot} />
            <Text style={styles.warnText}>
              {lowCount} note{lowCount > 1 ? "s" : ""} below 50% confidence —{" "}
              <Text style={styles.warnLink}>
                review {lowCount > 1 ? "them" : "it"} →
              </Text>
            </Text>
          </Touchable>
        )}
      </Card>

      {/* ── Hero notation card ───────────────────────────────────────────── */}
      <View style={styles.solfaCardWrap}>
        {/* Gradient header strip */}
        <LinearGradient
          colors={gradients.brand}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.solfaHeader}
        >
          <Ionicons name="musical-notes" size={14} color="#FFFFFF" />
          <Text style={styles.solfaHeaderLabel}>
            {notationView === "solfa" ? "TONIC SOLFA" : "STAFF NOTATION"}
          </Text>

          {/* Solfa / Staff segmented toggle */}
          <View style={styles.viewToggle}>
            {(["solfa", "staff"] as const).map((v) => (
              <Touchable
                key={v}
                onPress={() => setNotationView(v)}
                style={[
                  styles.viewToggleBtn,
                  notationView === v && styles.viewToggleBtnActive,
                ]}
                // Sits on the brand gradient, where a blue ripple is invisible —
                // and the selected half already paints its own white wash.
                ripple={false}
                accessibilityState={{ selected: notationView === v }}
                accessibilityLabel={v === "solfa" ? "Show tonic solfa" : "Show staff notation"}
              >
                <Ionicons
                  name={v === "solfa" ? "text" : "musical-note"}
                  size={12}
                  color="#FFFFFF"
                />
                <Text style={styles.viewToggleText}>
                  {v === "solfa" ? "Solfa" : "Staff"}
                </Text>
              </Touchable>
            ))}
          </View>
        </LinearGradient>

        {/* Body — solfa lines or the engraved stave, from the same note data */}
        <View style={styles.solfaBody}>
          {notationView === "solfa" ? (
            activeSolfaLines.length === 0 ? (
              <Text style={styles.solfaMuted}>No solfa lines produced.</Text>
            ) : (
              <>
                <View style={styles.solfaStyleBar}>
                  <Text style={styles.solfaStyleLabel}>Layout</Text>
                  <View style={styles.solfaStylePills}>
                    <Touchable
                      onPress={() => setSolfaStyle("grid")}
                      style={[
                        styles.solfaStylePill,
                        solfaStyle === "grid" && styles.solfaStylePillActive,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: solfaStyle === "grid" }}
                    >
                      <Text
                        style={[
                          styles.solfaStylePillText,
                          solfaStyle === "grid" && styles.solfaStylePillTextActive,
                        ]}
                      >
                        Grid
                      </Text>
                    </Touchable>
                    <Touchable
                      onPress={() => setSolfaStyle("curwen")}
                      style={[
                        styles.solfaStylePill,
                        solfaStyle === "curwen" && styles.solfaStylePillActive,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: solfaStyle === "curwen" }}
                    >
                      <Text
                        style={[
                          styles.solfaStylePillText,
                          solfaStyle === "curwen" && styles.solfaStylePillTextActive,
                        ]}
                      >
                        Curwen
                      </Text>
                    </Touchable>
                    {hasLyrics ? (
                      <Touchable
                        onPress={() => setSolfaStyle("hymn")}
                        style={[styles.solfaStylePill, solfaStyle === "hymn" && styles.solfaStylePillActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: solfaStyle === "hymn" }}
                      >
                        <Text style={[styles.solfaStylePillText, solfaStyle === "hymn" && styles.solfaStylePillTextActive]}>
                          Hymn
                        </Text>
                      </Touchable>
                    ) : null}
                  </View>
                </View>

                {solfaStyle === "hymn" ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View>
                      <Text style={[styles.solfaLine, styles.solfaLineFirst]}>{activeSolfaLines[0]}</Text>
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
                ) : null}

                {(solfaStyle === "hymn" ? [] : activeSolfaLines).map((line, i) => (
                  <View key={i} style={styles.solfaLineWrap}>
                    {/* Line number chip */}
                    {activeSolfaLines.length > 1 && (
                      <Text style={styles.solfaLineNum}>{i + 1}</Text>
                    )}
                    <Text
                      style={[styles.solfaLine, i === 0 && styles.solfaLineFirst]}
                    >
                      {line}
                    </Text>
                  </View>
                ))}

                {/* Decorative watermark */}
                <Text style={styles.solfaWatermark}>♪</Text>
              </>
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
      </View>

      {/* ── Lyrics: the words under the solfa ──────────────────────────── */}
      <View style={styles.lyricsBlock}>
        <TextField
          label="Lyrics"
          value={lyrics}
          onChangeText={setLyrics}
          onBlur={() => void commitLyrics()}
          placeholder="A-ma-zing grace, how sweet the sound…"
          multiline
          numberOfLines={3}
        />
        <Text style={styles.lyricsHint}>
          Split syllables with hyphens (a-ma-zing); each syllable goes under the next note. Use grace_ to hold a syllable over two notes.
        </Text>
      </View>

      {/* ── Playback: hear the tune, or rehearse a part against the others ─ */}
      {preview ? (
        <NotePlayer
          audioPreviewBase64={preview}
          notes={view.notes}
          tempoBpm={tempo}
          timeSignature={timeSignature}
          title={hasParts ? "Rehearse" : "Play back"}
          onCurrentNoteChange={setPlayingNote}
          voices={hasParts ? VOICES.filter((v) => v === "soprano" || parts?.[v]).map((v) => ({ name: v, on: voiceOn[v] })) : undefined}
          onToggleVoice={(v) => setVoiceOn((s) => ({ ...s, [v]: !s[v] }))}
          barCount={barCount}
          style={styles.playerCard}
        />
      ) : null}


      {/* ── Notes grid ───────────────────────────────────────────────────── */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>
          Notes <Text style={styles.sectionCount}>({view.notes.length})</Text>
        </Text>
        <Text style={styles.sectionHint}>Tap a note to fix it</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.notesScroll}
        contentContainerStyle={styles.notesContent}
      >
        {view.notes.map((n, i) => {
          const cc = confidenceColor(n.conf, colors);
          return (
            <Touchable
              key={i}
              onPress={() => openNote(i)}
              accessibilityLabel={`Note ${i + 1}, ${n.solfa}, MIDI ${n.pitchMidi}. Tap to correct.`}
              // No `radius` needed: `noteChip` already carries borderRadius plus
              // overflow:hidden, so the ripple clips to the chip on its own.
              style={[
                styles.noteChip,
                {
                  borderColor: `${cc}55`,
                  // Low confidence gets a more visible warning border
                  borderWidth: n.conf < 0.5 ? 1.5 : 1,
                },
              ]}
            >
              {/* Solfa syllable */}
              <Text style={styles.noteSolfa}>
                {n.solfa}
                {n.octaveMark}
              </Text>

              {/* MIDI number */}
              <Text style={styles.noteMidi}>{n.pitchMidi}</Text>

              {/* Confidence colour bar at the bottom */}
              <View
                style={[
                  styles.noteConfBar,
                  {
                    backgroundColor: cc,
                    shadowColor: cc,
                  },
                ]}
              />
            </Touchable>
          );
        })}
      </ScrollView>

      {/* ── Voices: SATB under the tune ──────────────────────────────────── */}
      <View style={styles.voicesBlock}>
        <View style={styles.exportHeaderRow}>
          <Ionicons name="people-outline" size={16} color={colors.textMuted} />
          <Text style={styles.exportTitle}>{result.partsSource === "heard" ? "The four parts, as sung" : "Four-part harmony"}</Text>
          {!isPro ? (
            <View style={styles.proTag}>
              <Text style={styles.proTagText}>PRO</Text>
            </View>
          ) : null}
        </View>
        {isPro && partsView ? (
          partsView.map(({ name, lines }) => (
            <View key={name} style={styles.voice}>
              <Text style={styles.voiceName}>{name.charAt(0).toUpperCase() + name.slice(1)}</Text>
              <Text style={styles.voiceLines}>{lines.slice(1).join("\n")}</Text>
            </View>
          ))
        ) : isPro ? (
          <View style={styles.voicesTeaser}>
            <Text style={styles.voicesTeaserText}>
              The sheet shows the voice we heard. When you want a choir arrangement, alto, tenor and bass are written under it the way a hymn arranger would.
            </Text>
            <Button
              label="Write alto, tenor and bass"
              variant="secondary"
              icon="people-outline"
              loading={harmonising}
              onPress={() => void writeParts()}
              style={styles.voicesButton}
            />
          </View>
        ) : (
          <Touchable onPress={() => navigation.navigate("Upgrade")} style={styles.voicesTeaser} accessibilityLabel="Unlock four-part harmony">
            <Text style={styles.voicesTeaserText}>
              Alto, tenor and bass parts, written under this tune the way a hymn arranger would — ready for your choir. Unlock with Pro →
            </Text>
          </Touchable>
        )}
      </View>

      {/* ── Sing it: a take, marked note by note ────────────────────────── */}
      {view.notes.length > 0 ? (
        <SingAlong
          melody={view.notes}
          parts={isPro ? parts : null}
          tempoBpm={tempo}
          timeSignature={timeSignature}
          isPro={isPro}
          onRequirePro={() => void requirePro()}
        />
      ) : null}

      {/* ── Export & Share ─────────────────────────────────────────────────── */}
      <View style={styles.exportBlock}>
        <View style={styles.exportHeaderRow}>
          <Ionicons
            name="share-social-outline"
            size={16}
            color={colors.textMuted}
          />
          <Text style={styles.exportTitle}>Export & Share</Text>
        </View>
        <Text style={styles.exportHint}>
          {isPro
            ? "Share the solfa to your choir group, or download the sheet as PDF, MusicXML or MIDI."
            : "Sharing the solfa is free. PDF, MusicXML and MIDI downloads come with Pro."}
        </Text>

        <View style={styles.exportButtonsRow}>
          <Button
            label={shareToken ? "Share the link again" : "Share a link"}
            variant="primary"
            icon="link-outline"
            onPress={shareLink}
            loading={sharing}
            style={styles.exportButtonPrimary}
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
          <Button
            label="Share Tonic Solfa text"
            variant="secondary"
            icon="chatbubbles-outline"
            onPress={handleExportSolfa}
            loading={exportingType === "solfa"}
            style={styles.exportButtonPrimary}
          />
          <Button
            label={isPro ? "Download PDF" : "Download PDF · Pro"}
            variant="secondary"
            icon={isPro ? "document-outline" : "lock-closed-outline"}
            onPress={handleExportPdf}
            loading={exportingType === "pdf"}
            disabled={!hasScore}
            style={styles.exportButtonPrimary}
          />
          <View style={styles.exportSecondaryRow}>
            <Button
              label={isPro ? "MIDI" : "MIDI · Pro"}
              variant="secondary"
              icon={isPro ? "musical-notes-outline" : "lock-closed-outline"}
              onPress={handleExportMidi}
              loading={exportingType === "midi"}
              disabled={isPro && !result.midiBase64}
              style={styles.exportButtonHalf}
            />
            <Button
              label={isPro ? "MusicXML" : "MusicXML · Pro"}
              variant="secondary"
              icon={isPro ? "document-text-outline" : "lock-closed-outline"}
              onPress={exportScore}
              loading={exportingType === "musicxml"}
              disabled={!hasScore}
              style={styles.exportButtonHalf}
            />
          </View>
        </View>
      </View>

      {/* ── Save block ───────────────────────────────────────────────────── */}
      {!savedId ? (
        <View style={styles.saveBlock}>
          {/* Divider */}
          <View style={styles.divider} />

          <Text style={styles.saveLabel}>Save to Library</Text>
          <Text style={styles.saveHint}>
            Give this transcription a name so you can find it later.
          </Text>

          <TextField
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Name this transcription…"
          />

          {/* Gradient primary save button */}
          <Button
            label="Save to Library"
            icon="bookmark"
            onPress={save}
            loading={saving}
            disabled={!title.trim()}
          />
        </View>
      ) : (
        /* ── Saved state ─────────────────────────────────────────────────── */
        <View style={styles.saveBlock}>
          <View style={styles.savedRow}>
            <LinearGradient
              colors={gradients.gold}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.savedIconCircle}
            >
              <Ionicons name="checkmark" size={18} color="#FFFFFF" />
            </LinearGradient>
            <View style={styles.savedTextBlock}>
              <Text style={styles.savedTitle}>Saved to Library</Text>
              <Text style={styles.savedSub}>
                You can find it in the Library tab.
              </Text>
            </View>
          </View>

          {/* Rename */}
          <TextField
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Name this transcription…"
          />
          <Button
            label="Rename"
            variant="secondary"
            onPress={rename}
            loading={renaming}
            disabled={!title.trim() || title.trim() === committedTitle}
          />
        </View>
      )}

      {/* ── 3-Button Action Row (Image 2 Screen 3) ────────────────────── */}
      <View style={styles.actionRow}>
        <Touchable
          style={styles.actionBtnOutline}
          radius={radii.pill}
          onPress={() => setPickingKey((p) => !p)}
          accessibilityLabel="Re-key"
        >
          <Text style={styles.actionBtnOutlineText}>Re-key</Text>
        </Touchable>

        {/* Straight to the notes that need it when the model flagged some,
            otherwise to the first note — the strip itself is the other way in. */}
        <Touchable
          style={styles.actionBtnOutline}
          radius={radii.pill}
          onPress={() => (lowCount > 0 ? startReview() : openNote(0))}
          accessibilityLabel="Edit notes"
        >
          <Text style={styles.actionBtnOutlineText}>Edit</Text>
        </Touchable>

        <Touchable
          style={styles.actionBtnSolid}
          radius={radii.pill}
          onPress={save}
          disabled={saving}
          // The deliberate one of the three. The success pattern fires from
          // `save()` when the server confirms, not from this press.
          haptic="medium"
          accessibilityLabel="Save to library"
        >
          <Text style={styles.actionBtnSolidText}>{saving ? "Saving…" : "Save"}</Text>
        </Touchable>
      </View>

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

// ─── SummaryStat sub-component ────────────────────────────────────────────────

function SummaryStat({
  icon,
  label,
  value,
  accent,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  accent: string;
  onPress?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  const body = (
    <>
      {/* Tinted icon circle */}
      <View style={[styles.statIconCircle, { backgroundColor: `${accent}18` }]}>
        <Ionicons name={icon} size={14} color={accent} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );

  // Only the interactive stat (Key) gets a touch target, so the other two
  // don't advertise an affordance they don't have.
  return onPress ? (
    <Touchable
      style={styles.statItem}
      onPress={onPress}
      accessibilityLabel={`${label}: ${value}`}
    >
      {body}
    </Touchable>
  ) : (
    <View style={styles.statItem}>{body}</View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  // ── Header ────────────────────────────────────────────────────────────────

  creditCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  creditThumb: { width: 56, height: 56, borderRadius: radii.md, backgroundColor: c.border },
  creditTitle: { ...typography.label, color: c.text },
  creditArtist: { ...typography.caption, color: c.textMuted, marginTop: 2 },
  creditLine: { ...typography.caption, color: c.textFaint, marginTop: 4 },
  truncatedNote: {
    ...typography.caption,
    color: c.accent,
    backgroundColor: c.accentSoft,
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
  },
  transposeBlock: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: c.borderLight },
  transposeTitle: { ...typography.label, color: c.text, marginBottom: 4 },
  transposeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm },
  transposeStep: {
    width: 40, height: 40, borderRadius: radii.pill, alignItems: "center", justifyContent: "center",
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
  },
  transposeReadout: { flex: 1, alignItems: "center" },
  transposeValue: { ...typography.title, color: c.text },
  transposeUnit: { ...typography.caption, color: c.textMuted, marginTop: 2 },
  rangeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 },
  rangeVoice: { ...typography.caption, color: c.textMuted, width: 64, textTransform: "capitalize" },
  rangeSpan: { ...typography.mono, color: c.text, fontSize: 13, width: 84 },
  rangeStatus: { ...typography.caption, flex: 1, fontFamily: fonts.semibold },
  transposeApply: { marginTop: spacing.sm },
  lyricsBlock: { marginBottom: spacing.lg },
  lyricsHint: { ...typography.caption, color: c.textFaint, lineHeight: 17, marginTop: 4 },
  hymnRow: { flexDirection: "row", marginBottom: spacing.sm },
  hymnBar: { flexDirection: "row", borderLeftWidth: 1.5, borderLeftColor: c.text, paddingHorizontal: 4 },
  hymnCell: { minWidth: 34, alignItems: "center", marginRight: 2 },
  hymnSolfa: { ...typography.mono, color: c.text, fontSize: 15, fontWeight: "700" },
  hymnLyric: { ...typography.caption, color: c.textMuted, fontSize: 10, minHeight: 14 },
  sharedRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs,
    backgroundColor: c.surfaceAlt, borderRadius: radii.sm, paddingVertical: 6, paddingHorizontal: spacing.sm,
  },
  sharedText: { ...typography.caption, color: c.textMuted, flex: 1, lineHeight: 16 },
  sharedStop: { ...typography.caption, color: c.danger, fontFamily: fonts.semibold, paddingHorizontal: 4 },
  voicesBlock: { marginTop: spacing.lg },
  voice: { marginTop: spacing.sm, backgroundColor: c.surfaceAlt, borderRadius: radii.md, padding: spacing.md },
  voiceName: { ...typography.label, color: c.textMuted, marginBottom: 4 },
  voiceLines: { ...typography.mono, color: c.text, lineHeight: 22 },
  voicesTeaser: { marginTop: spacing.sm, backgroundColor: c.accentSoft, borderRadius: radii.md, padding: spacing.md },
  voicesTeaserText: { ...typography.caption, color: c.accent, lineHeight: 18 },
  voicesButton: { marginTop: spacing.sm, alignSelf: "flex-start" },
  proTag: { marginLeft: "auto", backgroundColor: c.premiumSoft, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2 },
  proTagText: { ...typography.caption, color: c.premiumDeep, fontFamily: fonts.semibold, fontSize: 10 },
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },

  titleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },

  pageTitle: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: c.text,
  },

  proMark: {
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.premiumSoft,
    borderWidth: 1,
    borderColor: c.premiumBorder,
  },

  optionsBtn: {
    padding: spacing.xs,
  },

  backBtn: {
    padding: spacing.xs,
  },

  actionRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },

  actionBtnOutline: {
    flex: 1,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: c.surface,
    borderWidth: 1.5,
    borderColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
  },

  actionBtnOutlineText: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: c.accent,
  },

  /** `ink`, not `accent`: a fill under white text, so it stays dark in both modes. */
  actionBtnSolid: {
    flex: 1,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: c.ink,
    alignItems: "center",
    justifyContent: "center",
  },

  actionBtnSolidText: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: c.onInk,
  },

  /** Glass circle back button. */
  backCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },

  titleBlock: {
    flex: 1,
    marginHorizontal: spacing.md,
  },

  titleLabel: {
    ...typography.caption,
    color: c.textFaint,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontSize: 10,
  },

  titleMain: {
    ...typography.title,
    color: c.text,
    fontSize: 22,
    letterSpacing: -0.4,
    marginTop: 1,
  },

  /** Compact confidence pill — top-right corner of the header. */
  confPill: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
  },

  confDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 5,
    // Glow via shadow (set inline)
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 5,
    elevation: 3,
  },

  confPillText: {
    ...typography.caption,
    fontSize: 12,
    fontFamily: fonts.bold,
  },

  // ── Summary card ──────────────────────────────────────────────────────────

  summaryCard: {
    marginBottom: spacing.xl,
  },

  playerCard: {
    marginBottom: spacing.xl,
  },

  gameButton: {
    marginBottom: spacing.xl,
  },

  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },

  /** Vertical divider between stat chips. */
  summaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: c.border,
  },

  statItem: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },

  statIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },

  statValue: {
    ...typography.label,
    color: c.text,
    fontSize: 14,
    fontFamily: fonts.bold,
    textAlign: "center",
  },

  statLabel: {
    ...typography.caption,
    color: c.textFaint,
    fontSize: 10,
    textAlign: "center",
  },

  confRow: {
    paddingTop: spacing.md,
    alignItems: "center",
  },

  // ── Key picker (F-03 re-key) ───────────────────────────────────────────────

  keyPicker: {
    paddingTop: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    paddingBottom: spacing.md,
  },

  keyPickerHint: {
    ...typography.caption,
    color: c.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },

  keyPickerScroll: {
    gap: spacing.xs,
    paddingRight: spacing.md,
  },

  keyChip: {
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
  },

  keyChipActive: {
    overflow: "hidden",
    borderWidth: 0,
    shadowColor: c.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },

  keyChipText: {
    ...typography.caption,
    color: c.textMuted,
    fontSize: 12,
  },

  keyChipTextActive: {
    ...typography.caption,
    color: "#FFFFFF", // sits on the brand gradient
    fontSize: 12,
    fontFamily: fonts.bold,
  },

  tempoPicker: {
    backgroundColor: c.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: c.border,
  },

  tempoStepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
  },

  tempoStepBtn: {
    backgroundColor: c.accentSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    minWidth: 44,
    alignItems: "center",
  },

  tempoStepText: {
    ...typography.caption,
    fontFamily: fonts.bold,
    color: c.text,
    fontSize: 13,
  },

  tempoDisplayBadge: {
    flex: 1,
    backgroundColor: c.borderLight,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    alignItems: "center",
  },

  tempoDisplayText: {
    ...typography.body,
    fontFamily: fonts.bold,
    color: c.text,
    fontSize: 14,
  },

  meterPicker: {
    backgroundColor: c.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: c.border,
  },

  meterPillsRow: {
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "space-between",
  },

  meterPill: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: c.accentSoft,
    alignItems: "center",
  },

  meterPillActive: {
    backgroundColor: c.purple,
  },

  meterPillText: {
    ...typography.caption,
    fontFamily: fonts.medium,
    color: c.text,
    fontSize: 13,
  },

  meterPillTextActive: {
    color: "#FFFFFF",
    fontFamily: fonts.bold,
  },

  pickerHint: {
    ...typography.caption,
    color: c.textMuted,
    fontSize: 12,
    marginBottom: spacing.sm,
  },

  /** Warning row — shown when some notes are < 50 % confidence. */
  warnRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.accentGlow,
  },

  warnDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.warning,
    marginRight: spacing.sm,
    marginTop: 3,
    shadowColor: c.warning,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 3,
  },

  warnText: {
    ...typography.caption,
    color: c.warning,
    flex: 1,
    lineHeight: 18,
    fontSize: 12,
  },

  /** The tappable half of the warn row — same amber, weighted so it reads as an action. */
  warnLink: {
    fontFamily: fonts.bold,
    textDecorationLine: "underline",
  },

  // ── Solfa hero card ────────────────────────────────────────────────────────

  solfaCardWrap: {
    borderRadius: radii.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: spacing.xl,
    // Blue glow
    shadowColor: c.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 8,
  },

  /** Gradient strip at the top of the solfa card. */
  solfaHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    gap: spacing.xs,
  },

  // The header strip and its badge sit on the brand gradient — white in both modes.
  solfaHeaderLabel: {
    ...typography.caption,
    color: "#FFFFFF",
    fontSize: 11,
    fontFamily: fonts.bold,
    letterSpacing: 1.5,
    flex: 1,
    marginLeft: 2,
  },

  /** Solfa / Staff segmented toggle inside the gradient header. */
  viewToggle: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: radii.pill,
    padding: 2,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
  },

  viewToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
  },

  viewToggleBtnActive: {
    backgroundColor: "rgba(255,255,255,0.28)",
  },

  viewToggleText: {
    ...typography.caption,
    color: "#FFFFFF",
    fontSize: 11,
    fontFamily: fonts.bold,
  },

  /** Glass card body — the main solfa display area. */
  solfaBody: {
    backgroundColor: c.accentSoft,
    padding: spacing.xl,
    minHeight: 120,
    position: "relative",
    overflow: "hidden",
  },

  solfaStyleBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: c.borderLight,
  },

  solfaStyleLabel: {
    ...typography.caption,
    color: c.textMuted,
    fontFamily: fonts.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  solfaStylePills: {
    flexDirection: "row",
    backgroundColor: c.borderLight,
    borderRadius: radii.pill,
    padding: 2,
    gap: 2,
  },

  solfaStylePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },

  solfaStylePillActive: {
    backgroundColor: c.surface,
  },

  solfaStylePillText: {
    ...typography.caption,
    fontSize: 11,
    fontFamily: fonts.medium,
    color: c.textMuted,
  },

  solfaStylePillTextActive: {
    fontFamily: fonts.bold,
    color: c.text,
  },

  solfaLineWrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },

  /** Optional line-number prefix for multi-line results. */
  solfaLineNum: {
    ...typography.caption,
    color: c.textFaint,
    fontSize: 11,
    marginRight: spacing.sm,
    marginTop: 3,
    width: 14,
    textAlign: "right",
  },

  solfaLine: {
    ...typography.mono,
    color: c.textMuted,
    fontSize: 16,
    lineHeight: 26,
    flex: 1,
    letterSpacing: 1,
  },

  /** First line gets full Ink Navy — it's the primary solfa sequence.
   *
   *  Keeps `fontWeight` rather than a Poppins family: this overlays `solfaLine`,
   *  which is monospaced so the syllables stay in columns. A proportional face
   *  here would break that alignment, and monospace has no Poppins equivalent —
   *  so the weight is still the only way to bold it, and still honoured. */
  solfaLineFirst: {
    color: c.text,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 2,
    lineHeight: 30,
    // Subtle brand text-shadow glow
    textShadowColor: c.accentGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },

  solfaMuted: {
    ...typography.body,
    color: c.textFaint,
    fontStyle: "italic",
  },

  /** Decorative ghost note — bottom-right watermark inside the card.
   *
   *  Left on the system font: the glyph is ♪, which Poppins doesn't carry, so
   *  naming a family would only force a silent fallback. No family means the
   *  weight below is honoured. */
  solfaWatermark: {
    position: "absolute",
    right: spacing.xl,
    bottom: -8,
    fontSize: 80,
    color: c.accentSoft,
    fontWeight: "700",
    lineHeight: 90,
  },

  // ── Section header ─────────────────────────────────────────────────────────

  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },

  sectionTitle: {
    ...typography.heading,
    color: c.text,
    fontSize: 16,
    fontFamily: fonts.bold,
  },

  /** Quiet affordance for the chips below — they don't look tappable on their own. */
  sectionHint: {
    ...typography.caption,
    color: c.textFaint,
    fontSize: 11,
  },

  /** The "(12)" nested inside sectionTitle. It inherits the parent's family, so
   *  lightening it takes an explicit regular face — a weight alone was dropped. */
  sectionCount: {
    color: c.textFaint,
    fontFamily: fonts.regular,
    fontSize: 14,
  },

  // ── Notes grid ─────────────────────────────────────────────────────────────

  notesScroll: {
    marginHorizontal: -spacing.xl,
    marginBottom: spacing.xl,
  },

  notesContent: {
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },

  /** Individual note chip — coloured border signals confidence level. */
  noteChip: {
    width: 60,
    borderRadius: radii.md,
    backgroundColor: c.surface,
    alignItems: "center",
    paddingTop: spacing.sm,
    paddingBottom: 0,
    overflow: "hidden",
  },

  noteSolfa: {
    ...typography.label,
    color: c.text,
    fontSize: 15,
    fontFamily: fonts.bold,
  },

  noteMidi: {
    ...typography.caption,
    color: c.textFaint,
    marginVertical: spacing.xs,
    fontSize: 10,
  },

  /** Coloured bar at the very bottom of the chip — glows to match confidence. */
  noteConfBar: {
    height: 3,
    width: "100%",
    // Shadow set inline via shadowColor
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 4,
    elevation: 2,
  },

  // ── Export block ───────────────────────────────────────────────────────────

  exportBlock: {
    marginBottom: spacing.xl,
    gap: spacing.xs,
  },

  exportHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },

  exportTitle: {
    ...typography.heading,
    color: c.text,
    fontSize: 16,
    fontFamily: fonts.bold,
  },

  exportHint: {
    ...typography.body,
    color: c.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },

  exportButtonsRow: {
    gap: spacing.sm,
  },

  exportButtonPrimary: {
    width: "100%",
  },

  exportSecondaryRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },

  exportButtonHalf: {
    flex: 1,
  },

  // ── Save block ─────────────────────────────────────────────────────────────

  saveBlock: {
    marginTop: spacing.xs,
    paddingBottom: spacing.xxl,
  },

  divider: {
    height: 1,
    backgroundColor: c.border,
    marginBottom: spacing.xl,
  },

  saveLabel: {
    ...typography.heading,
    color: c.text,
    fontSize: 18,
    fontFamily: fonts.bold,
    marginBottom: spacing.xs,
  },

  saveHint: {
    ...typography.body,
    color: c.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },

  // ── Saved state ────────────────────────────────────────────────────────────

  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xl,
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentGlow,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },

  savedIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
    // Light-blue glow
    shadowColor: c.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 6,
  },

  savedTextBlock: {
    flex: 1,
  },

  savedTitle: {
    ...typography.label,
    color: c.text,
    fontSize: 15,
    fontFamily: fonts.bold,
  },

  savedSub: {
    ...typography.caption,
    color: c.textMuted,
    marginTop: 2,
    fontSize: 12,
  },
});
