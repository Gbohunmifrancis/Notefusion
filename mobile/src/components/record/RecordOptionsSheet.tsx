import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "../Icon";
import { Button } from "../Button";
import { Chip } from "../Chip";
import { Sheet, SheetActions } from "../Sheet";
import { Touchable } from "../Touchable";
import { fonts, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { METER_CHOICES, meterLabel, type Meter } from "../../lib/meter";

export type RecordMode = "melody" | "poly" | "choir" | "chords";

export interface ModeOption {
  mode: RecordMode;
  /** What the top bar's pill says. */
  title: string;
  /** One line on what the mode listens for. */
  hint: string;
  icon: IconName;
}

/**
 * Everything the record screen asks before a take — what is being recorded, the key, the beats in
 * a bar, and the keyboard's transpose — in one bottom sheet behind the mode pill, so the screen itself keeps to
 * the timer, the line and the button.
 */
export function RecordOptionsSheet({
  visible,
  onClose,
  modes,
  mode,
  onMode,
  keys,
  selectedKey,
  onKey,
  meter,
  onMeter,
  showTranspose,
  transposeChoices,
  transpose,
  transposeLabel,
  onTranspose,
}: {
  visible: boolean;
  onClose: () => void;
  modes: readonly ModeOption[];
  mode: RecordMode;
  onMode: (m: RecordMode) => void;
  keys: readonly string[];
  selectedKey: string;
  onKey: (k: string) => void;
  /** Beats in a bar; null is Not sure, which sends nothing. */
  meter: Meter | null;
  onMeter: (m: Meter | null) => void;
  /** Shown for chords, and whenever a transpose is set, because it rides along with every submit. */
  showTranspose: boolean;
  transposeChoices: readonly number[];
  transpose: number;
  transposeLabel: (t: number) => string;
  onTranspose: (t: number) => void;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
        <Text style={styles.eyebrow}>What are you recording?</Text>
        <View>
          {modes.map((m, i) => {
            const active = m.mode === mode;
            return (
              <Touchable
                key={m.mode}
                onPress={() => onMode(m.mode)}
                scaleTo={0.99}
                radius={16}
                style={[styles.modeRow, i > 0 && styles.modeRowRule, active && styles.modeRowOn]}
                accessibilityLabel={`${m.title} mode`}
                accessibilityState={{ selected: active }}
              >
                <View style={[styles.modeIcon, active && styles.modeIconOn]}>
                  <Icon name={m.icon} size={20} color={active ? c.onInk : c.icon} />
                </View>
                <View style={styles.modeText}>
                  <Text style={styles.modeTitle}>{m.title}</Text>
                  <Text style={styles.modeHint}>{m.hint}</Text>
                </View>
                {active ? <Icon name="check" size={20} color={c.link} /> : null}
              </Touchable>
            );
          })}
        </View>

        {/* No keys, no section: a guest's preview takes none. */}
        {keys.length > 0 ? (
          <>
            <Text style={[styles.eyebrow, styles.eyebrowGap]}>Key signature</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {keys.map((k) => (
                <Chip
                  key={k}
                  label={k}
                  selected={selectedKey === k}
                  onPress={() => onKey(k)}
                  accessibilityLabel={`Key: ${k}`}
                />
              ))}
            </ScrollView>
          </>
        ) : null}

        <Text style={[styles.eyebrow, styles.eyebrowGap]}>Beats in a bar</Text>
        <View style={styles.chipsWrap}>
          {METER_CHOICES.map((m) => (
            <Chip
              key={m.short}
              label={m.short}
              selected={meter === m.value}
              onPress={() => onMeter(m.value)}
              accessibilityLabel={`Beats in a bar: ${m.label}`}
            />
          ))}
        </View>
        <Text style={styles.meterHint}>{meterLabel(meter)}</Text>

        {showTranspose ? (
          <>
            {/* The setting on the player's keyboard, so the sheet reads as the music sounded,
                not as the shapes were played. */}
            <Text style={[styles.eyebrow, styles.eyebrowGap]}>
              Keyboard transpose{transpose !== 0 ? ` · ${transposeLabel(transpose)}` : ""}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {transposeChoices.map((t) => {
                const label = transposeLabel(t);
                return (
                  <Chip
                    key={t}
                    label={label}
                    mono
                    selected={transpose === t}
                    onPress={() => onTranspose(t)}
                    accessibilityLabel={`Keyboard transpose ${label}`}
                  />
                );
              })}
            </ScrollView>
          </>
        ) : null}

        <SheetActions style={{ marginTop: spacing.xl }}>
          <Button label="Done" onPress={onClose} />
        </SheetActions>
      </ScrollView>
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    scroll: {
      flexGrow: 0,
    },
    eyebrow: {
      fontFamily: fonts.medium,
      fontSize: 12,
      letterSpacing: 1.7,
      textTransform: "uppercase",
      color: c.textMuted,
      marginBottom: spacing.sm,
    },
    eyebrowGap: {
      marginTop: spacing.xl,
    },
    modeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm,
      borderRadius: 16,
    },
    modeRowRule: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    modeRowOn: {
      backgroundColor: c.accentSoft,
      borderTopColor: "transparent",
    },
    modeIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    modeIconOn: {
      backgroundColor: c.ink,
      borderColor: c.ink,
    },
    modeText: {
      flex: 1,
    },
    modeTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15.5,
      letterSpacing: -0.2,
      color: c.text,
    },
    modeHint: {
      ...typography.caption,
      letterSpacing: 0,
      color: c.textMuted,
      lineHeight: 17,
      marginTop: 2,
    },
    // The chips are 44 px to a thumb, 8 apart (board m-ux-medium P3e).
    chips: {
      gap: spacing.sm,
      paddingRight: spacing.lg,
    },
    chipsWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    meterHint: {
      ...typography.caption,
      letterSpacing: 0,
      color: c.textMuted,
      marginTop: spacing.sm,
    },
  });
