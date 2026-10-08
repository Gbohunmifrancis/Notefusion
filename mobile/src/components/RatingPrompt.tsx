import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Mark } from "./night/NightUI";
import { rating } from "../lib/rating";
import { fonts, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";

/**
 * The store-rating ask, mounted once at the app root. It shows itself when
 * `rating.recordSave()` decides the moment has come (see `ratingPolicy`), so no
 * screen has to know anything about it beyond reporting a save.
 */
export function RatingPrompt() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [saves, setSaves] = useState<number | null>(null);
  const [stars, setStars] = useState(5);

  useEffect(() => rating.subscribe(setSaves), []);

  const close = () => setSaves(null);
  const later = () => {
    void rating.snooze();
    close();
  };

  return (
    <Modal visible={saves !== null} transparent animationType="fade" onRequestClose={later}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <View style={styles.tile}>
            <Mark height={44} />
          </View>
          <Text style={styles.title}>Enjoying Notefusion?</Text>
          <Text style={styles.body}>
            {saves} sheets saved so far. A rating on Google Play helps other choirs find it.
          </Text>
          <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel={`${stars} of 5 stars`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setStars(n)} hitSlop={6} accessibilityLabel={`${n} stars`}>
                <Ionicons name={n <= stars ? "star" : "star-outline"} size={30} color={c.premium} />
              </Pressable>
            ))}
          </View>
          <Pressable
            style={styles.rate}
            accessibilityRole="button"
            onPress={() => {
              void rating.rate();
              close();
            }}
          >
            <Text style={styles.rateText}>Rate on Google Play</Text>
          </Pressable>
          <Pressable onPress={later} hitSlop={10} accessibilityRole="button" style={styles.later}>
            <Text style={styles.laterText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    scrim: { flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end", padding: 16, paddingBottom: 32 },
    card: {
      backgroundColor: c.bgElevated,
      borderRadius: 30,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 24,
      paddingTop: 30,
      paddingBottom: 18,
      alignItems: "center",
    },
    tile: {
      width: 84,
      height: 84,
      borderRadius: 24,
      backgroundColor: c.ink,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: c.ink,
      shadowOpacity: 0.45,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
      elevation: 10,
    },
    title: { marginTop: 22, fontSize: 24, letterSpacing: -0.6, fontFamily: fonts.semibold, color: c.text },
    body: {
      marginTop: 8,
      textAlign: "center",
      fontSize: 14.5,
      lineHeight: 21,
      fontFamily: fonts.regular,
      color: c.textMuted,
    },
    stars: { flexDirection: "row", gap: 12, marginTop: 22 },
    rate: {
      alignSelf: "stretch",
      height: 54,
      borderRadius: 27,
      marginTop: 26,
      backgroundColor: c.text,
      alignItems: "center",
      justifyContent: "center",
    },
    rateText: { fontSize: 15.5, fontFamily: fonts.semibold, color: c.bg },
    later: { marginTop: 16, paddingVertical: 4 },
    laterText: { fontSize: 15, fontFamily: fonts.medium, color: c.textMuted },
  });
