/**
 * Doh's suggestion card on Home (board c-practice/8a): Doh, one line in bold, a line or two under it, one text action,
 * and × to put it away. Which card and its words come from `lib/dohSuggestion`; Home decides when it shows.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "../Button";
import { Touchable } from "../Touchable";
import { Doh } from "./Doh";
import type { DohCard as Card } from "../../lib/dohSuggestion";
import { fonts, radii, type Palette, type Shadows } from "../../design/theme";
import { useColors, useTheme, useThemedStyles } from "../../lib/theme";

/** The text button's own side padding (`Button`), taken back so its word lines up with the lines above. */
const TEXT_PAD = 12;

export function DohCard({
  card,
  hop,
  active,
  onAction,
  onClose,
}: {
  card: Card;
  /** Doh hops in: the first time Home shows this card. */
  hop: boolean;
  /** Home is on screen: Doh may blink now and then. */
  active: boolean;
  onAction: () => void;
  onClose: () => void;
}) {
  const c = useColors();
  const { mode } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.card, mode === "light" && styles.cardDay]}>
      <Doh pose={card.pose} size={62} entrance={hop ? "hop" : "none"} active={active} />
      <View style={styles.text}>
        <Text style={styles.title}>{card.title}</Text>
        <Text style={styles.body}>{card.body}</Text>
        <Button
          label={card.action}
          variant="text"
          size="sm"
          icon="arrow-forward"
          iconPosition="right"
          onPress={onAction}
          style={styles.action}
        />
      </View>
      <Touchable
        onPress={onClose}
        style={styles.close}
        radius={radii.pill}
        ripple="borderless"
        hitSlop={4}
        accessibilityLabel="Hide this suggestion"
      >
        <Ionicons name="close" size={17} color={c.textFaint} />
      </Touchable>
    </View>
  );
}

const makeStyles = (c: Palette, s: Shadows) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginTop: 18,
      paddingTop: 12,
      paddingBottom: 6,
      paddingLeft: 10,
      paddingRight: 40,
      borderRadius: 18,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    cardDay: {
      ...s.card,
    },
    text: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      lineHeight: 20,
      color: c.text,
    },
    body: {
      fontFamily: fonts.regular,
      fontSize: 13.5,
      lineHeight: 19,
      color: c.textMuted,
      marginTop: 3,
    },
    action: {
      alignSelf: "flex-start",
      marginLeft: -TEXT_PAD,
      marginTop: 2,
    },
    close: {
      position: "absolute",
      top: 4,
      right: 4,
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
  });
