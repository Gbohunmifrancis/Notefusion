import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Sheet, SheetMessage, SheetTitle } from "../Sheet";
import { Touchable } from "../Touchable";
import { fonts, type Palette } from "../../design/theme";
import { useThemedStyles } from "../../lib/theme";
import { REMINDER_HOUR_GROUPS, hourLabel } from "../../lib/reminderPrefs";

/**
 * "Remind me at" (board b-system/12c): every hour the server takes, 8am to 9pm, as plain buttons in three rows.
 * A tap chooses and closes; there is no Save. Drawn in JavaScript, so it ships over the air (a native time picker
 * would need a store build, and offer minutes the server ignores).
 */
export function ReminderTimeSheet({
  visible,
  hour,
  onPick,
  onClose,
}: {
  visible: boolean;
  /** The hour now chosen, drawn selected. */
  hour: number;
  onPick: (hour: number) => void;
  onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetTitle>Remind me at</SheetTitle>
      <SheetMessage>On days you haven't practised yet. Your phone's own time.</SheetMessage>
      {REMINDER_HOUR_GROUPS.map((group) => (
        <View key={group.label} style={styles.group}>
          <Text style={styles.groupLabel}>{group.label}</Text>
          <View style={styles.hours}>
            {group.hours.map((h) => {
              const on = h === hour;
              return (
                <Touchable
                  key={h}
                  onPress={() => onPick(h)}
                  scaleTo={0.96}
                  radius={12}
                  style={[styles.hour, on && styles.hourOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Remind me at ${hourLabel(h)}`}
                >
                  <Text style={[styles.hourText, on && styles.hourTextOn]} maxFontSizeMultiplier={1.3}>
                    {hourLabel(h)}
                  </Text>
                </Touchable>
              );
            })}
            {/* Morning has four: the empty fifth keeps its buttons the evening's width. */}
            {Array.from({ length: 5 - group.hours.length }, (_, i) => (
              <View key={`gap-${i}`} style={styles.hourGap} />
            ))}
          </View>
        </View>
      ))}
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    group: {
      marginBottom: 18,
    },
    groupLabel: {
      fontFamily: fonts.semibold,
      fontSize: 12,
      letterSpacing: 0.7,
      textTransform: "uppercase",
      color: c.textFaint,
      marginBottom: 10,
      marginLeft: 2,
    },
    hours: {
      flexDirection: "row",
      gap: 8,
    },
    hour: {
      flex: 1,
      height: 48,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.sheetTile,
      borderWidth: 1,
      borderColor: "transparent",
    },
    hourOn: {
      backgroundColor: c.accentSoft,
      borderColor: c.primary,
    },
    hourGap: {
      flex: 1,
    },
    hourText: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: c.text,
      fontVariant: ["tabular-nums"],
    },
    hourTextOn: {
      color: c.link,
    },
  });
