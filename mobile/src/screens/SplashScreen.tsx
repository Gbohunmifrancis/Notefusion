import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

/**
 * SplashScreen — the brand identity card on a pitch-black stage.
 *
 * Inspired by the NoteFusion logo card:
 *   • Pure black (#000000) canvas — no gradients, no distractions.
 *   • "Note"   rendered in Electric Pink  (#D946EF) with a pink text-shadow glow.
 *   • "Fusion" rendered in Electric Purple (#A855F7) with a purple text-shadow glow.
 *   • A pulsing ambient orb behind the wordmark simulates the halo in the logo card.
 *   • Tagline fades in after the wordmark for a staged, cinematic entrance.
 *
 * No masked-view or native gradient-text libraries are required — the split-word
 * technique plus React Native textShadow achieves the glowing gradient look.
 */
export function SplashScreen() {
  // ── Animation values ────────────────────────────────────────────────────────
  const orbScale = useRef(new Animated.Value(0.8)).current;
  const orbOpacity = useRef(new Animated.Value(0.3)).current;
  const wordOpacity = useRef(new Animated.Value(0)).current;
  const wordTranslateY = useRef(new Animated.Value(16)).current;
  const tagOpacity = useRef(new Animated.Value(0)).current;
  const tagTranslateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    // 1. Wordmark slides up + fades in
    Animated.parallel([
      Animated.timing(wordOpacity, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(wordTranslateY, {
        toValue: 0,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // 2. Tagline appears after a short delay
    Animated.sequence([
      Animated.delay(500),
      Animated.parallel([
        Animated.timing(tagOpacity, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(tagTranslateY, {
          toValue: 0,
          duration: 500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // 3. Ambient orb pulses indefinitely
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(orbScale, {
            toValue: 1.15,
            duration: 2000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(orbOpacity, {
            toValue: 0.55,
            duration: 2000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(orbScale, {
            toValue: 0.8,
            duration: 2000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(orbOpacity, {
            toValue: 0.25,
            duration: 2000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ]),
    ).start();
  }, [
    orbScale,
    orbOpacity,
    wordOpacity,
    wordTranslateY,
    tagOpacity,
    tagTranslateY,
  ]);

  return (
    <View style={styles.container}>
      {/* ── Ambient glow orb ─────────────────────────────────────────────── */}
      {/* Two layered orbs give a richer, multi-colour halo effect */}
      <Animated.View
        style={[
          styles.orbPink,
          { opacity: orbOpacity, transform: [{ scale: orbScale }] },
        ]}
      />
      <Animated.View
        style={[
          styles.orbPurple,
          {
            opacity: orbOpacity,
            transform: [
              {
                scale: Animated.multiply(orbScale, new Animated.Value(0.75)),
              },
            ],
          },
        ]}
      />

      {/* ── Wordmark: "Note" (pink) + "Fusion" (purple) ──────────────────── */}
      <Animated.View
        style={[
          styles.wordmarkRow,
          {
            opacity: wordOpacity,
            transform: [{ translateY: wordTranslateY }],
          },
        ]}
      >
        {/* "Note" — Electric Pink with pink glow */}
        <Text style={styles.wordNote}>Note</Text>
        {/* "Fusion" — Electric Purple with purple glow */}
        <Text style={styles.wordFusion}>Fusion</Text>
      </Animated.View>

      {/* ── Tagline ───────────────────────────────────────────────────────── */}
      <Animated.Text
        style={[
          styles.tagline,
          {
            opacity: tagOpacity,
            transform: [{ translateY: tagTranslateY }],
          },
        ]}
      >
        Hear it. See it. Sing it.
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000", // Pitch Black — no gradients, the logo IS the colour
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Ambient orbs ────────────────────────────────────────────────────────────

  /** Pink halo — positioned slightly left of centre to mirror the gradient start. */
  orbPink: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "rgba(217, 70, 239, 0.18)", // Electric Pink at low opacity
  },

  /** Purple halo — centred, smaller, layered on top of the pink orb. */
  orbPurple: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(168, 85, 247, 0.22)", // Electric Purple at low opacity
  },

  // ── Wordmark ─────────────────────────────────────────────────────────────────

  wordmarkRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },

  /**
   * "Note" — Electric Pink (#D946EF).
   * textShadow with a large radius and high opacity creates the bloom / glow
   * effect visible in the brand identity card on a dark background.
   */
  wordNote: {
    fontSize: 52,
    fontWeight: "800",
    color: "#D946EF",
    letterSpacing: -1.5,
    // Glow layer 1 — tight hot-pink core
    textShadowColor: "rgba(217, 70, 239, 0.95)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },

  /**
   * "Fusion" — Electric Purple (#A855F7).
   * Matching glow technique so the two halves read as one glowing wordmark.
   */
  wordFusion: {
    fontSize: 52,
    fontWeight: "800",
    color: "#A855F7",
    letterSpacing: -1.5,
    // Glow layer 1 — tight purple core
    textShadowColor: "rgba(168, 85, 247, 0.95)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },

  // ── Tagline ──────────────────────────────────────────────────────────────────

  tagline: {
    marginTop: 14,
    fontSize: 14,
    fontWeight: "400",
    color: "#A1A1AA", // Soft Ash — readable but clearly secondary
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
});
