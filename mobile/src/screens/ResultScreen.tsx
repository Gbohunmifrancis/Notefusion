import React, { useMemo, useRef, useState } from "react";
import {
  ScrollView,
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
import ScoreView from "../components/ScoreView";
import { libraryApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import type { NoteEvent } from "../api/types";
import { showDialog, type DialogAction } from "../lib/dialog";
import { useSubscription } from "../lib/subscription";
import { deriveSolfa, KEY_CHOICES, sameKey } from "../lib/solfa";
import { buildMusicXml, resolveKeySignature } from "../lib/musicxml";
import { synthesizeMelodyWavBase64 } from "../lib/synth";
import { stopAudition } from "../lib/audition";
import { exportMusicXml } from "../lib/export";
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
  const [exporting, setExporting] = useState(false);

  // ── Key override (F-03) ────────────────────────────────────────────────────
  // Solfa is movable-do, so a key change re-labels the existing notes — it
  // never re-transcribes. The syllables update locally the instant the user
  // taps, and the choice is persisted only for transcriptions already saved.
  const [key, setKey] = useState(result.key);
  const [pickingKey, setPickingKey] = useState(false);
  const [rekeying, setRekeying] = useState(false);

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
  /** Synthesised melody for the player; re-made when the notes change. */
  const [preview, setPreview] = useState(result.audioPreviewBase64);

  // Counts deletions as well as pitch changes: both are corrections the exported
  // score doesn't know about, and both are what "Discard" would undo. Zero means
  // the list is byte-for-byte the model's, even if the user has been busy.
  const correctedCount = useMemo(
    () =>
      draft.notes.filter((n, i) => n !== result.notes[draft.origins[i]]).length +
      (result.notes.length - draft.notes.length),
    [draft, result.notes],
  );
  const edited = correctedCount > 0;

  // The server already labelled the original key, so trust its output until
  // the user actually overrides — that keeps the fresh-transcription path
  // byte-identical to what the worker produced.
  const view = useMemo(
    () =>
      key === result.key && !edited
        ? { notes: result.notes, solfaLines: result.solfaLines }
        : deriveSolfa(draft.notes, key, result.timeSignature),
    [
      draft.notes,
      edited,
      key,
      result.key,
      result.notes,
      result.solfaLines,
      result.timeSignature,
    ],
  );

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
        result.timeSignature,
        { title: committedTitle || title, lyrics: true },
      ) ?? "",
    [view.notes, key, result.timeSignature, committedTitle, title],
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
        tempoBpm: result.tempo,
        timeSignature: result.timeSignature,
        musicXml: result.musicXml,
        notes: view.notes,
        overallConfidence,
        sourceJobId,
      });
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
        i === index ? result.notes[d.origins[i]] : n,
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
    const original = pristine(result.notes);
    setDraft(original);
    setPreview(result.audioPreviewBase64);
    void commitNotes(original);
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
  async function exportScore() {
    setExporting(true);
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
      setExporting(false);
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
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={8}
          ripple="borderless"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Touchable>

        <View style={styles.titleGroup}>
          <Text style={styles.pageTitle}>Preview</Text>
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
                onPress: () =>
                  exportMusicXml(scoreXml, committedTitle || title),
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
                    navigation.goBack();
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

      {/* ── Summary card ─────────────────────────────────────────────────── */}
      <Card style={styles.summaryCard}>
        {/* Three stat chips */}
        <View style={styles.summaryRow}>
          <SummaryStat
            icon="key-outline"
            label={rekeying ? "Saving…" : "Key · tap to change"}
            value={key}
            accent={colors.purple}
            onPress={() => setPickingKey((p) => !p)}
          />
          <View style={styles.summaryDivider} />
          <SummaryStat
            icon="speedometer-outline"
            label="Tempo"
            value={`${result.tempo} BPM`}
            accent={colors.gold}
          />
          <View style={styles.summaryDivider} />
          <SummaryStat
            icon="grid-outline"
            label="Meter"
            value={result.timeSignature}
            accent={colors.success}
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
          </View>
        )}

        {/* Full confidence badge */}
        <View style={styles.confRow}>
          <ConfidenceBadge value={overallConfidence} />
        </View>

        {/* Low-confidence warning — now with somewhere to go. Tapping walks just
            the flagged notes, which is otherwise a hunt through a long strip. */}
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
              <Text style={styles.warnLink}>review {lowCount > 1 ? "them" : "it"} →</Text>
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
            view.solfaLines.length === 0 ? (
              <Text style={styles.solfaMuted}>No solfa lines produced.</Text>
            ) : (
              <>
                {view.solfaLines.map((line, i) => (
                  <View key={i} style={styles.solfaLineWrap}>
                    {/* Line number chip */}
                    {view.solfaLines.length > 1 && (
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
            <ScoreView
              notes={view.notes}
              timeSignature={result.timeSignature}
              musicalKey={key}
              cursorBeat={cursorBeat}
              onSelectNote={openNote}
            />
          )}
        </View>
      </View>

      {/* ── Playback: hear the transcribed melody ───────────────────────── */}
      {preview ? (
        <NotePlayer
          audioPreviewBase64={preview}
          notes={view.notes}
          tempoBpm={result.tempo}
          timeSignature={result.timeSignature}
          title="Play back"
          onCurrentNoteChange={setPlayingNote}
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

      {/* ── Export ───────────────────────────────────────────────────────── */}
      {/* Offered whether or not the transcription is saved — the score is
          engraved from the notes on screen, and saving is a separate choice. */}
      <View style={styles.exportBlock}>
        <View style={styles.exportHeaderRow}>
          <Ionicons
            name="document-text-outline"
            size={16}
            color={colors.textMuted}
          />
          <Text style={styles.exportTitle}>Sheet music</Text>
        </View>
        <Text style={styles.exportHint}>
          {hasScore
            ? "Export as MusicXML to open in Sibelius, MuseScore, or Finale."
            : "No score is attached to this transcription."}
        </Text>

        <Button
          label="Export MusicXML"
          variant="secondary"
          icon="share-outline"
          onPress={exportScore}
          loading={exporting}
          disabled={!hasScore}
        />
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
          draft.notes[editing] !== result.notes[draft.origins[editing]]
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
