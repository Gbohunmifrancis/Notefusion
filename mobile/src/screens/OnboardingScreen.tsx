import React, { useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import LottieView from "lottie-react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button } from "../components/Button";
import { GoogleButton } from "../components/GoogleButton";
import { OrDivider } from "../components/OrDivider";
import { StaffRibbon } from "../components/StaffRibbon";
import { useAuth } from "../lib/auth";
import { googleAuthConfigured } from "../lib/env";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useTheme, useThemedStyles, useColors } from "../lib/theme";
import type { AuthStackParams } from "../navigation/types";

const { width } = Dimensions.get("window");

/** What `require()` on a bundled .json asset resolves to. */
type AnimationSource = React.ComponentProps<typeof LottieView>["source"];

// ─── Slide data ───────────────────────────────────────────────────────────────

const SLIDES: { animation: AnimationSource; title: string; body: string }[] = [
  {
    animation: require("../../assets/animations/record.json"),
    title: "Record a melody",
    body: "Capture a live tune or hum — a few bars is all it takes. Sing, hum, or play near the mic.",
  },
  {
    animation: require("../../assets/animations/transcribe.json"),
    title: "Instant transcription",
    body: "We turn your audio into Tonic Solfa and staff notation, perfectly on-key every time.",
  },
  {
    animation: require("../../assets/animations/rekey.json"),
    title: "Save & re-key",
    body: "Build a personal library and change the key anytime — your notes never shift, only the labels do.",
  },
];

type Props = NativeStackScreenProps<AuthStackParams, "Onboarding">;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * OnboardingScreen — the three-slide intro, following the design sheet.
 *
 * Each slide is the same frame: a Skip link in the top-right, the illustration
 * on a pale blue disc, the heading and body, three dots, then the actions. Only
 * the disc and the text change as you page, so the buttons never move under the
 * thumb between slides.
 *
 * Google sits here as well as on Login because the design offers it on every
 * slide — someone who already has an account shouldn't have to page to the end
 * to get in. It is gated on `googleAuthConfigured` exactly as Login is.
 */
export function OnboardingScreen({ navigation }: Props) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);
  const { mode } = useTheme();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  // Per-slide fade + rise, so a paged slide arrives rather than snapping in.
  const slideAnim = useRef(new Animated.Value(0)).current;

  const animateSlide = () => {
    slideAnim.setValue(1);
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
    if (newIndex !== index) {
      setIndex(newIndex);
      animateSlide();
    }
  };

  const isLast = index === SLIDES.length - 1;

  const next = () => {
    if (!isLast) {
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
      setIndex(index + 1);
      animateSlide();
    } else {
      navigation.navigate("Register");
    }
  };

  const { signInWithGoogle } = useAuth();
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleGoogle = async () => {
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
    } catch {
      // Error handles inside auth provider
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />

      {/* ── Skip ─────────────────────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => navigation.navigate("Login")}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Skip onboarding and sign in"
        >
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      {/* ── Centre column: slides + dots ────────────────────────────────── */}
      <View style={styles.centre}>
        {/* Slides */}
        <FlatList
          ref={listRef}
          data={SLIDES}
          keyExtractor={(s) => s.title}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
          style={styles.list}
          renderItem={({ item }) => (
            <Animated.View
              style={[
                styles.slide,
                {
                  width,
                  opacity: slideAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 0.3],
                  }),
                  transform: [
                    {
                      translateY: slideAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 14],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.stage}>
                <View style={styles.disc} />
                <LottieView
                  source={item.animation}
                  autoPlay
                  loop
                  resizeMode="contain"
                  style={styles.animation}
                />
              </View>

              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
            </Animated.View>
          )}
        />

        {/* ── Dots ───────────────────────────────────────────────────────── */}
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <View
              key={s.title}
              style={[styles.dot, i === index && styles.dotActive]}
            />
          ))}
        </View>
      </View>

      {/* ── Footer: CTA button & Google button ───────────────────────────── */}
      <View style={styles.footer}>
        <Button
          label={isLast ? "Get started" : "Next"}
          onPress={next}
          icon="arrow-forward"
          iconPosition="right"
        />

        {googleAuthConfigured && (
          <>
            <OrDivider />
            <GoogleButton onPress={handleGoogle} loading={googleBusy} label="Sign in with Google" />
          </>
        )}
      </View>

      {/* ── Decorative staff ─────────────────────────────────────────────── */}
      <View style={styles.ribbon} pointerEvents="none">
        <StaffRibbon width={width} height={110} color={colors.accent} opacity={0.18} />
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: c.bg,
    },

    // ── Skip ──────────────────────────────────────────────────────────────────

    topBar: {
      alignItems: "flex-end",
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
    },

    skip: {
      fontSize: 16,
      fontFamily: fonts.semibold,
      color: c.accent,
    },

    // ── Centre column ─────────────────────────────────────────────────────────

    /** Takes all remaining space and centres slides + dots in the middle. */
    centre: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
    },

    // ── Slides ────────────────────────────────────────────────────────────────

    /** flexGrow:0 keeps the list at its natural content height so it does not
     *  expand and push the dots / button out of the centred group. */
    list: {
      flexGrow: 0,
    },

    slide: {
      alignItems: "center",
      paddingHorizontal: spacing.xl,
    },

    stage: {
      width: 260,
      height: 260,
      alignItems: "center",
      justifyContent: "center",
    },

    disc: {
      position: "absolute",
      width: 250,
      height: 250,
      borderRadius: 125,
      backgroundColor: c.accentSoft,
    },

    animation: {
      width: 230,
      height: 230,
    },

    title: {
      ...typography.screenTitle,
      fontSize: 28,
      color: c.text,
      textAlign: "center",
      marginTop: spacing.xl,
    },

    body: {
      ...typography.body,
      fontSize: 16,
      lineHeight: 26,
      color: c.textMuted,
      textAlign: "center",
      marginTop: spacing.md,
      paddingHorizontal: spacing.sm,
    },

    // ── Dots ──────────────────────────────────────────────────────────────────

    dots: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      marginTop: spacing.xl,
      gap: spacing.sm,
    },

    dot: {
      width: 9,
      height: 9,
      borderRadius: radii.pill,
      backgroundColor: c.border,
    },

    dotActive: {
      backgroundColor: c.accent,
    },

    // ── Actions ───────────────────────────────────────────────────────────────

    /** Sits directly below the dots inside the centred group. */
    actions: {
      marginTop: spacing.xl,
      paddingHorizontal: spacing.xl,
      width: "100%",
    },

    /** CTA button pinned to the bottom of the screen, full-width with side padding. */
    footer: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.lg,
      paddingTop: spacing.md,
    },

    ribbon: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: -1,
    },
  });
