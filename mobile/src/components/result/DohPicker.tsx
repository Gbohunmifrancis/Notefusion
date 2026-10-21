import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Sheet, SheetMessage, SheetTitle } from "../Sheet";
import { Touchable } from "../Touchable";
import { Segmented } from "./Segmented";
import { fonts, radii, typography, type Palette } from "../../design/theme";
import { useThemedStyles } from "../../lib/theme";
import { dohCells, parseKey, type KeyMode } from "../../lib/solfa";

/**
 * "Which doh?" (board n-ux-low Q1a): the twelve dohs at once, a 4 × 3 grid under Major | Minor, the sheet's own key
 * marked. One tap re-labels and closes: a key change is a re-label, never a re-transcription. Minor is la-based, so each
 * cell names the minor key whose doh it is ("E minor" under doh G). Opened from the DOH figure.
 */
export function DohPicker({
  visible,
  currentKey,
  disabled,
  onChoose,
  onClose,
}: {
  visible: boolean;
  /** The sheet's key: it opens on its mode, with its doh marked. */
  currentKey: string;
  /** A re-key still being saved. */
  disabled?: boolean;
  /** A key other than the sheet's (`lib/solfa` KEY_CHOICES spelling). */
  onChoose: (key: string) => void;
  onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const [mode, setMode] = useState<KeyMode>(() => parseKey(currentKey)?.mode ?? "major");
  // Each opening starts on the sheet's own mode.
  useEffect(() => {
    if (visible) setMode(parseKey(currentKey)?.mode ?? "major");
  }, [visible, currentKey]);

  const cells = useMemo(() => dohCells(currentKey, mode), [currentKey, mode]);
  const rows = [cells.slice(0, 4), cells.slice(4, 8), cells.slice(8, 12)];

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetTitle>Which doh?</SheetTitle>
      <SheetMessage>Your notes stay put; only the syllables move.</SheetMessage>
      <Segmented
        segments={[
          { id: "major", label: "Major" },
          { id: "minor", label: "Minor (la-based)", accessibilityLabel: "Minor, la-based" },
        ]}
        value={mode}
        onChange={setMode}
        stretch
        style={styles.modes}
      />
      <View style={styles.grid}>
        {rows.map((row, r) => (
          <View key={r} style={styles.row}>
            {row.map((cell) => (
              <Touchable
                key={cell.key}
                onPress={() => (cell.on ? onClose() : onChoose(cell.key))}
                disabled={disabled}
                style={[styles.cell, cell.on && styles.cellOn]}
                radius={radii.md}
                accessibilityState={{ selected: cell.on }}
                accessibilityLabel={cell.minorName ? `${cell.minorName}, doh ${cell.doh}` : `Doh ${cell.doh}`}
              >
                <Text style={[styles.doh, cell.on && styles.textOn]}>{cell.doh}</Text>
                {cell.minorName ? (
                  <Text style={[styles.minor, cell.on && styles.textOn]} numberOfLines={1}>
                    {cell.minorName}
                  </Text>
                ) : null}
              </Touchable>
            ))}
          </View>
        ))}
      </View>
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    modes: { marginBottom: 16 },
    grid: { gap: 8 },
    row: { flexDirection: "row", gap: 8 },
    cell: {
      flex: 1,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.md,
      backgroundColor: c.sheetRow,
      borderWidth: 1,
      borderColor: c.border,
    },
    cellOn: { backgroundColor: c.selectedWash, borderColor: c.accent },
    doh: { fontFamily: typography.mono.fontFamily, fontSize: 18, color: c.text },
    minor: { fontFamily: fonts.medium, fontSize: 12, color: c.textMuted },
    textOn: { color: c.link },
  });
