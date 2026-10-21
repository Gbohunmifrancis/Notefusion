import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "./Icon";
import { fonts, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";

/**
 * A problem in plain words with a small amber icon (board 7c, "field error"): under a field, a
 * player or a form. Never red — red is kept for the one word that deletes.
 */
export function ProblemNote({
  children,
  center = false,
  sentence = false,
  style,
}: {
  children: React.ReactNode;
  /** Centred under a centred block (a player, a dialog's form). */
  center?: boolean;
  /**
   * `true`: a 16 px sentence where the screen's sentences are 16 (Practice's drill card, board m-ux-medium P5c).
   * `15`: a 15/22 sentence where they are 15 (the Result's notices, board n-ux-low Q1d).
   */
  sentence?: boolean | 15;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const big = sentence === true;
  const mid = sentence === 15;
  return (
    <View style={[styles.row, mid && styles.rowSentence15, center && styles.center, style]} accessibilityLiveRegion="polite">
      <Icon
        name="problem"
        size={15}
        color={c.warning}
        style={[styles.icon, big && styles.iconSentence, mid && styles.iconSentence15]}
      />
      <Text style={[styles.text, big && styles.textSentence, mid && styles.textSentence15, center && styles.textCenter]}>
        {children}
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 6,
      marginTop: 8,
    },
    rowSentence15: {
      gap: 8,
    },
    center: {
      justifyContent: "center",
    },
    icon: {
      marginTop: 1,
    },
    /** Centred on the first of the sentence's 23 px lines. */
    iconSentence: {
      marginTop: 4,
    },
    /** Centred on the first of the sentence's 22 px lines. */
    iconSentence15: {
      marginTop: 3.5,
    },
    text: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      lineHeight: 18,
      color: c.textMuted,
    },
    textSentence: {
      fontFamily: fonts.regular,
      fontSize: 16,
      lineHeight: 23,
    },
    textSentence15: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 22,
    },
    textCenter: {
      textAlign: "center",
    },
  });
