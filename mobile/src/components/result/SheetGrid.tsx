import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fonts, typography, type Palette } from "../../design/theme";
import { useThemedStyles } from "../../lib/theme";
import type { NoteEvent } from "../../api/types";
import { beatsPerBarOf } from "./usePractice";

/** Below this a note is the model's guess rather than its answer — same line as the review. */
export const LOW_CONF = 0.5;

/**
 * The beat a column stands for. Simple time counts the denominator's note; compound
 * time (6/8, 9/8, 12/8) counts the dotted crotchet, which is where a choir feels the
 * beat — six quaver columns would read as six beats.
 */
function cellBeatsOf(timeSignature: string): number {
  const [num, den] = timeSignature.split("/").map(Number);
  if (!num || !den) return 1;
  if (den === 8 && num % 3 === 0 && num > 3) return 1.5;
  return 4 / den;
}

interface Cell {
  /** Indices into the note list of the notes that start in this column. */
  starts: number[];
  /** True when an earlier note is still sounding as the column begins: the "–" of solfa. */
  held: boolean;
  chord: string | null;
}

/** Bars of columns, each column the notes that start on its beat. Onsets are absolute, so this is exact. */
function layout(
  notes: readonly NoteEvent[],
  chords: readonly { startBeat: number; symbol: string }[] | null,
  timeSignature: string,
  barCount: number,
): Cell[][] {
  const barBeats = beatsPerBarOf(timeSignature);
  const cellBeats = cellBeatsOf(timeSignature);
  const perBar = Math.max(1, Math.round(barBeats / cellBeats));
  const total = barCount * perBar;
  const cells: Cell[] = Array.from({ length: total }, () => ({ starts: [], held: false, chord: null }));
  const cellOf = (beat: number) => {
    const bar = Math.floor(beat / barBeats + 1e-6);
    const col = Math.min(perBar - 1, Math.floor((beat - bar * barBeats) / cellBeats + 1e-6));
    return bar * perBar + col;
  };
  const order = notes.map((_, i) => i).sort((a, b) => notes[a]!.startBeat - notes[b]!.startBeat);
  for (const i of order) {
    const k = cellOf(notes[i]!.startBeat);
    if (k >= 0 && k < total) cells[k]!.starts.push(i);
  }
  for (let k = 0; k < total; k++) {
    if (cells[k]!.starts.length > 0) continue;
    const bar = Math.floor(k / perBar);
    const at = bar * barBeats + (k - bar * perBar) * cellBeats;
    cells[k]!.held = notes.some((n) => n.startBeat < at && n.startBeat + n.durBeats > at + 1e-6);
  }
  for (const ch of chords ?? []) {
    const k = cellOf(ch.startBeat);
    if (k >= 0 && k < total && cells[k]!.chord === null) cells[k]!.chord = ch.symbol;
  }
  const bars: Cell[][] = [];
  for (let b = 0; b < barCount; b++) bars.push(cells.slice(b * perBar, (b + 1) * perBar));
  return bars;
}

/** The bar a note sits in, counted from 1 the way a choir leader counts. */
export function barOf(note: NoteEvent, timeSignature: string): number {
  return Math.floor(note.startBeat / beatsPerBarOf(timeSignature) + 1e-6) + 1;
}

/**
 * The sheet itself: a bar to a row, a column to a beat, each syllable large in mono
 * with the lyric syllable it carries beneath. A doubtful note is amber with a dotted
 * underline, the note sounding is lit, and every syllable is a way into the editor.
 */
export function SheetGrid({
  notes,
  lyrics,
  chords,
  timeSignature,
  barCount,
  playingNote,
  onSelectNote,
}: {
  notes: readonly NoteEvent[];
  /** The syllable each note sings, by note index; null when the sheet has no words. */
  lyrics: readonly (string | null)[] | null;
  chords: readonly { startBeat: number; symbol: string }[] | null;
  timeSignature: string;
  barCount: number;
  playingNote: number;
  onSelectNote: (index: number) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const bars = useMemo(
    () => layout(notes, chords, timeSignature, barCount),
    [notes, chords, timeSignature, barCount],
  );

  return (
    <View>
      {bars.map((cells, b) => {
        const hasChord = cells.some((c) => c.chord);
        return (
          <View key={b} style={styles.barRow}>
            <Text style={styles.barNumber}>{b + 1}</Text>
            <View style={styles.bar}>
              {cells.map((cell, k) => (
                <View key={k} style={styles.cell}>
                  {hasChord ? (
                    <Text style={styles.chord} numberOfLines={1}>
                      {cell.chord ?? " "}
                    </Text>
                  ) : null}
                  {cell.starts.length > 0 ? (
                    <View style={styles.cellNotes}>
                      {cell.starts.map((i) => {
                        const n = notes[i]!;
                        const low = n.conf < LOW_CONF;
                        const now = i === playingNote;
                        return (
                          <Pressable
                            key={i}
                            onPress={() => onSelectNote(i)}
                            hitSlop={4}
                            style={({ pressed }) => [styles.note, now && styles.noteNow, pressed && styles.notePressed]}
                            accessibilityRole="button"
                            accessibilityLabel={`Note ${i + 1}, ${n.solfa}, MIDI ${n.pitchMidi}. Tap to correct.`}
                          >
                            <Text style={[styles.syllable, low && styles.syllableLow, now && styles.syllableNow]}>
                              {n.solfa}
                              {n.octaveMark}
                            </Text>
                            {/* A dotted underline drawn as dots: RN's dotted border and
                                underline styles are not honoured on every platform. */}
                            <View style={styles.dots}>
                              {low ? [0, 1, 2, 3].map((d) => <View key={d} style={styles.dot} />) : null}
                            </View>
                            {lyrics ? (
                              <Text style={styles.lyric} numberOfLines={1}>
                                {lyrics[i] === "_" ? "—" : (lyrics[i] ?? "")}
                              </Text>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={[styles.syllable, styles.hold]}>{cell.held ? "–" : " "}</Text>
                  )}
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    barRow: { flexDirection: "row", alignItems: "stretch" },
    barNumber: {
      fontFamily: typography.mono.fontFamily,
      fontSize: 10,
      color: c.textFaint,
      width: 20,
      paddingTop: 12,
    },
    /** The barline is the row's left edge, as on the board. */
    bar: {
      flex: 1,
      flexDirection: "row",
      borderLeftWidth: 1,
      borderLeftColor: c.border,
      paddingLeft: 12,
      paddingVertical: 8,
    },
    cell: { flex: 1, minWidth: 0 },
    cellNotes: { flexDirection: "row", flexWrap: "wrap", columnGap: 6 },
    chord: { fontFamily: fonts.semibold, fontSize: 11, color: c.accent, marginBottom: 2 },
    note: {
      alignItems: "flex-start",
      borderRadius: 9,
      paddingHorizontal: 4,
      marginHorizontal: -4,
      paddingVertical: 2,
    },
    noteNow: { backgroundColor: c.accentSoft },
    notePressed: { opacity: 0.6 },
    syllable: {
      fontFamily: typography.mono.fontFamily,
      fontSize: 20,
      lineHeight: 26,
      color: c.text,
    },
    syllableLow: { color: c.warning },
    syllableNow: { color: c.accent },
    hold: { color: c.textFaint, paddingVertical: 2 },
    dots: { flexDirection: "row", gap: 2, height: 3, marginTop: 1 },
    dot: { width: 2, height: 2, borderRadius: 1, backgroundColor: c.warning },
    lyric: { fontFamily: fonts.regular, fontSize: 12, color: c.textMuted, marginTop: 2, minHeight: 16 },
  });
