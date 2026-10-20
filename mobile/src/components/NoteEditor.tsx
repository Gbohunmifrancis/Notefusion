import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "./Icon";
import { Button } from "./Button";
import { auditionNote } from "../lib/audition";
import {
  confidenceColor,
  fonts,
  radii,
  spacing,
  typography,
  type Palette,
} from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { NoteEvent } from "../api/types";
import { spokenPitch } from "../lib/choir";

interface Props {
  /** Index into `notes` of the note being edited. `null` keeps the sheet closed. */
  index: number | null;
  /** The note list as displayed — already carrying derived solfa labels. */
  notes: readonly NoteEvent[];
  tempoBpm: number;
  /** True when this note differs from the original transcription (enables Revert). */
  edited: boolean;
  /**
   * Indices Prev/Next should step through — the flagged notes during a guided
   * review. `null` walks the whole list, which is what a free tap gets.
   */
  reviewQueue: readonly number[] | null;
  onNavigate: (index: number) => void;
  /** Signed semitone offset; the parent clamps and re-derives. */
  onTranspose: (index: number, semitones: number) => void;
  onRevert: (index: number) => void;
  onDelete: (index: number) => void;
  onClose: () => void;
}

/**
 * Tap-to-correct sheet (F-07) — one note at a time.
 *
 * Pitch only: ±a semitone for a mis-heard note, ±an octave for the octave errors
 * pitch detection makes most often, and delete for a spurious detection. Duration
 * and insertion are deliberately absent — they need a timeline, not a stepper.
 *
 * It edits nothing itself. Every control reports upward and the parent owns the
 * note list, so there is one place that clamps MIDI range, marks a corrected note
 * as the user's own, and re-derives solfa for the whole list.
 *
 * `Prev`/`Next` follow the flagged notes when the user came in through
 * "Review them", and the whole list when they tapped a chip directly — the same
 * sheet serves both, since a review is just a pre-filled path through it.
 */
export function NoteEditor({
  index,
  notes,
  tempoBpm,
  edited,
  reviewQueue,
  onNavigate,
  onTranspose,
  onRevert,
  onDelete,
  onClose,
}: Props) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);

  const note = index === null ? undefined : notes[index];

  // Prev/Next follow the review path when there is one. A note that has fallen
  // off it (deleted, say) yields step -1, which simply disables both arrows
  // rather than needing a special case.
  const path = reviewQueue ?? notes.map((_, i) => i);
  const step = index === null ? -1 : path.indexOf(index);
  const prev = step > 0 ? path[step - 1] : undefined;
  const next = step >= 0 && step < path.length - 1 ? path[step + 1] : undefined;

  const conf = note ? Math.round(note.conf * 100) : 0;
  const confColor = note ? confidenceColor(note.conf, c) : c.border;

  return (
    <Modal
      visible={note !== undefined}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        {/* Swallows taps on the sheet so they don't reach the dismissing backdrop. */}
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.handle} />

          {note && index !== null && (
            <>
              {/* ── Where am I ────────────────────────────────────────────── */}
              <View style={styles.headerRow}>
                <Text style={styles.position}>
                  Note {index + 1} of {notes.length}
                </Text>
                {reviewQueue && step >= 0 && (
                  <Text style={styles.queuePosition}>
                    {step + 1} of {reviewQueue.length} flagged
                  </Text>
                )}
              </View>

              {/* ── The note itself ──────────────────────────────────────── */}
              <View style={styles.noteBlock}>
                <Text style={styles.solfa}>
                  {note.solfa}
                  {note.octaveMark}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={styles.meta} accessibilityLabel={spokenPitch(note.pitchMidi)}>MIDI {note.pitchMidi}</Text>
                  <View style={styles.metaDot} />
                  <Text style={[styles.meta, { color: confColor }]}>{conf}%</Text>
                </View>
              </View>

              {/* ── Pitch steppers ───────────────────────────────────────── */}
              <View style={styles.stepperRow}>
                <Stepper
                  icon="minus"
                  label="Semitone"
                  onPress={() => onTranspose(index, -1)}
                  disabled={note.pitchMidi <= 0}
                />
                <Stepper
                  icon="add"
                  label="Semitone"
                  onPress={() => onTranspose(index, 1)}
                  disabled={note.pitchMidi >= 127}
                />
              </View>
              <View style={styles.stepperRow}>
                <Stepper
                  icon="down"
                  label="Octave"
                  onPress={() => onTranspose(index, -12)}
                  disabled={note.pitchMidi < 12}
                />
                <Stepper
                  icon="up"
                  label="Octave"
                  onPress={() => onTranspose(index, 12)}
                  disabled={note.pitchMidi > 115}
                />
              </View>

              {/* ── Audition / undo / remove ─────────────────────────────── */}
              <View style={styles.actionRow}>
                <Button
                  label="Hear it"
                  variant="secondary"
                  size="sm"
                  icon="play"
                  onPress={() => void auditionNote(note, tempoBpm)}
                  style={styles.action}
                />
                <Button
                  label="Revert"
                  variant="text"
                  size="sm"
                  icon="retry"
                  onPress={() => onRevert(index)}
                  disabled={!edited}
                  style={styles.action}
                />
                <Button
                  label="Delete"
                  variant="destructive"
                  size="sm"
                  icon="delete"
                  onPress={() => onDelete(index)}
                  style={styles.action}
                />
              </View>

              {/* ── Walk the list ────────────────────────────────────────── */}
              <View style={styles.navRow}>
                <Nav
                  icon="back"
                  label="Prev"
                  onPress={() => prev !== undefined && onNavigate(prev)}
                  disabled={prev === undefined}
                />
                <Pressable
                  onPress={onClose}
                  style={styles.doneBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
                <Nav
                  icon="chevron"
                  label="Next"
                  onPress={() => next !== undefined && onNavigate(next)}
                  disabled={next === undefined}
                  trailing
                />
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** A big half-width pitch control — thumb-sized, because this is used one-handed. */
function Stepper({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.stepper,
        pressed && styles.stepperPressed,
        disabled && styles.stepperDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${icon === "add" || icon === "up" ? "Up" : "Down"} one ${label.toLowerCase()}`}
    >
      <Icon name={icon} size={18} color={disabled ? c.textFaint : c.text} />
      <Text style={[styles.stepperLabel, disabled && { color: c.textFaint }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Nav({
  icon,
  label,
  onPress,
  disabled,
  trailing,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  trailing?: boolean;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const color = disabled ? c.textFaint : c.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={styles.nav}
      hitSlop={8}
      accessibilityRole="button"
    >
      {!trailing && <Icon name={icon} size={16} color={color} />}
      <Text style={[styles.navLabel, { color }]}>{label}</Text>
      {trailing && <Icon name={icon} size={16} color={color} />}
    </Pressable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: c.scrim, // same wash as AppDialog
      justifyContent: "flex-end",
    },

    sheet: {
      backgroundColor: c.bgElevated,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      borderTopWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxl,
    },

    handle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      marginBottom: spacing.lg,
    },

    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },

    position: {
      ...typography.caption,
      color: c.textMuted,
      fontSize: 12,
      fontFamily: fonts.medium,
    },

    queuePosition: {
      ...typography.caption,
      color: c.warning,
      fontSize: 12,
      fontFamily: fonts.medium,
    },

    // ── The note under edit ──────────────────────────────────────────────────

    noteBlock: {
      alignItems: "center",
      paddingVertical: spacing.lg,
    },

    /** Monospace to match the solfa hero card, where these syllables also live.
     *  `fontWeight` is honoured here for the same reason it is there: the family
     *  is monospaced, not Poppins, so nothing overrides it. */
    solfa: {
      ...typography.mono,
      color: c.text,
      fontSize: 44,
      lineHeight: 54,
      fontWeight: "700",
      letterSpacing: 2,
    },

    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.xs,
    },

    meta: {
      ...typography.caption,
      color: c.textMuted,
      fontSize: 12,
      fontFamily: fonts.medium,
    },

    metaDot: {
      width: 3,
      height: 3,
      borderRadius: 2,
      backgroundColor: c.border,
    },

    // ── Pitch steppers ───────────────────────────────────────────────────────

    stepperRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },

    stepper: {
      flex: 1,
      height: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      borderRadius: radii.md,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },

    stepperPressed: {
      backgroundColor: c.accentSoft,
      borderColor: c.accentGlow,
    },

    stepperDisabled: {
      opacity: 0.5,
    },

    stepperLabel: {
      ...typography.label,
      color: c.text,
      fontSize: 13,
      fontFamily: fonts.semibold,
    },

    // ── Action row ───────────────────────────────────────────────────────────

    actionRow: {
      flexDirection: "row",
      gap: spacing.xs,
      marginTop: spacing.md,
    },

    action: {
      flex: 1,
    },

    // ── Prev / Done / Next ───────────────────────────────────────────────────

    navRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: spacing.lg,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },

    nav: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingVertical: spacing.xs,
      minWidth: 64,
    },

    navLabel: {
      ...typography.label,
      fontSize: 14,
      fontFamily: fonts.semibold,
    },

    doneBtn: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.pill,
      backgroundColor: c.accentSoft,
    },

    doneText: {
      ...typography.label,
      color: c.accent,
      fontSize: 14,
      fontFamily: fonts.bold,
    },
  });
