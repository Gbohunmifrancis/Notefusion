import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { type Palette } from "../design/theme";
import { useThemedStyles } from "../lib/theme";

/**
 * SplashScreen — the brand identity card on the app canvas.
 *
 * Inspired by the NoteFusion logo card:
 *   • Plain canvas — no gradients, no distractions.
 *   • "Note"   rendered in Sky (#0EA5E9) with a sky text-shadow glow.
 *   • "Fusion" rendered in Primary Blue (#2563EB) with a blue text-shadow glow.
 *   • A pulsing ambient orb behind the wordmark simulates the halo in the logo card.
 *   • Tagline fades in after the wordmark for a staged, cinematic entrance.
 *
 * The wordmark and orbs keep their literal brand hues in both modes — they are
 * the logo, not themed chrome; only the canvas and tagline follow the palette.
 *
 * No masked-view or native gradient-text libraries are required — the split-word
 * technique plus React Native textShadow achieves the glowing gradient look.
 */
export function SplashScreen() {
  const styles = useThemedStyles(makeStyles);

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
        {/* "Note" — Sky with sky glow */}
        <Text style={styles.wordNote}>Note</Text>
        {/* "Fusion" — Primary Blue with blue glow */}
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.bg, // no gradients, the logo IS the colour
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
      backgroundColor: "rgba(14, 165, 233, 0.18)", // Sky at low opacity
    },

    /** Blue halo — centred, smaller, layered on top of the pink orb. */
    orbPurple: {
      position: "absolute",
      width: 280,
      height: 280,
      borderRadius: 140,
      backgroundColor: "rgba(37, 99, 235, 0.22)", // Primary Blue at low opacity
    },

    // ── Wordmark ─────────────────────────────────────────────────────────────────

    wordmarkRow: {
      flexDirection: "row",
      alignItems: "baseline",
    },

    /**
     * "Note" — Sky (#0EA5E9).
     * textShadow with a large radius and high opacity creates the bloom / glow
     * effect visible in the brand identity card.
     */
    wordNote: {
      fontSize: 52,
      fontWeight: "800",
      color: "#0EA5E9",
      letterSpacing: -1.5,
      // Glow layer 1 — tight sky core
      textShadowColor: "rgba(14, 165, 233, 0.95)",
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 18,
    },

    /**
     * "Fusion" — Primary Blue (#2563EB).
     * Matching glow technique so the two halves read as one glowing wordmark.
     */
    wordFusion: {
      fontSize: 52,
      fontWeight: "800",
      color: "#2563EB",
      letterSpacing: -1.5,
      // Glow layer 1 — tight blue core
      textShadowColor: "rgba(37, 99, 235, 0.95)",
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 18,
    },

    // ── Tagline ──────────────────────────────────────────────────────────────────

    tagline: {
      marginTop: 14,
      fontSize: 14,
      fontWeight: "400",
      color: c.textMuted, // readable but clearly secondary
      letterSpacing: 1.2,
      textTransform: "uppercase",
    },
  });
