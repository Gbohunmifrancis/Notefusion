import React, { useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import LottieView from "lottie-react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { gradients, radii, spacing, typography, type Palette } from "../design/theme";
import { useTheme, useThemedStyles } from "../lib/theme";
import type { AuthStackParams } from "../navigation/types";

const { width } = Dimensions.get("window");

/** What `require()` on a bundled .json asset resolves to. */
type AnimationSource = React.ComponentProps<typeof LottieView>["source"];

// ─── Slide data ───────────────────────────────────────────────────────────────

const SLIDES: {
  animation: AnimationSource;
  title: string;
  body: string;
  /** Palette token, resolved at render — a literal here would freeze the light hue. */
  accent: keyof Palette;
}[] = [
  {
    animation: require("../../assets/animations/record.json"),
    title: "Record a melody",
    body: "Capture a live tune or hum — a few bars is all it takes. Sing, hum, or play near the mic.",
    accent: "pink",
  },
  {
    animation: require("../../assets/animations/transcribe.json"),
    title: "Instant transcription",
    body: "We turn your audio into Tonic Solfa and staff notation, perfectly on-key every time.",
    accent: "accent",
  },
  {
    animation: require("../../assets/animations/rekey.json"),
    title: "Save & re-key",
    body: "Build a personal library and change the Doh anytime — your notes never shift, only the labels do.",
    accent: "accentAlt",
  },
];

type Props = NativeStackScreenProps<AuthStackParams, "Onboarding">;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * OnboardingScreen — light blue three-slide intro.
 *
 * Design language:
 *   • Mist canvas with no competing backgrounds.
 *   • Each slide plays a looping Lottie illustration on a soft tinted disc.
 *   • Dot indicators: active dot expands into a pill and glows in the slide accent.
 *   • "Next" uses the GradientButton (The Fusion); "I already have an account" is ghost.
 *   • Subtle slide-in animation on mount so the first slide doesn't just snap into view.
 */
export function OnboardingScreen({ navigation }: Props) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);
  const { palette, mode } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Per-slide fade + slide-up animation
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

  const next = () => {
    if (index < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
      setIndex(index + 1);
      animateSlide();
    } else {
      navigation.navigate("Register");
    }
  };

  const slide = SLIDES[index];
  const currentAccent = slide ? palette[slide.accent] : palette.purple;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />

      {/* ── Ambient glow orb — changes hue with the active slide ────────── */}
      <Animated.View
        style={[
          styles.ambientOrb,
          {
            backgroundColor: `${currentAccent}1A`, // 10 % opacity
          },
        ]}
      />

      {/* ── Slide list ───────────────────────────────────────────────────── */}
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
          <View style={[styles.slide, { width }]}>
            {/* Animated illustration on a soft radial-style wash */}
            <View style={styles.stage}>
              <LinearGradient
                colors={gradients.brandDim}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.stageWash}
              />
              <LottieView
                source={item.animation}
                autoPlay
                loop
                resizeMode="contain"
                style={styles.animation}
              />
            </View>

            {/* Text block */}
            <View style={styles.textBlock}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
            </View>
          </View>
        )}
      />

      {/* ── Dot indicators ───────────────────────────────────────────────── */}
      <View style={styles.dots}>
        {SLIDES.map((s, i) => {
          const isActive = i === index;
          return (
            <View
              key={s.title}
              style={[
                styles.dot,
                isActive && {
                  // Active dot: wider pill, coloured with the current slide's accent
                  width: 28,
                  backgroundColor: currentAccent,
                  // Soft glow
                  shadowColor: currentAccent,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.8,
                  shadowRadius: 6,
                  elevation: 4,
                },
              ]}
            />
          );
        })}
      </View>

      {/* ── CTA buttons ──────────────────────────────────────────────────── */}
      <View style={styles.actions}>
        <Button
          label={index === SLIDES.length - 1 ? "Get started" : "Next"}
          onPress={next}
          icon={
            index === SLIDES.length - 1 ? "arrow-forward" : "chevron-forward"
          }
        />
        <Button
          label="I already have an account"
          variant="ghost"
          onPress={() => navigation.navigate("Login")}
          style={styles.ghostBtn}
        />
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
      alignItems: "center",
    },

    // Ambient orb behind everything — transitions with slide accent colour
    ambientOrb: {
      position: "absolute",
      top: -60,
      width: 420,
      height: 420,
      borderRadius: 210,
      alignSelf: "center",
    },

    list: {
      flexGrow: 0,
      marginTop: spacing.xxxl,
    },

    slide: {
      alignItems: "center",
      paddingHorizontal: spacing.xl,
    },

    // ── Animated illustration ────────────────────────────────────────────────────

    stage: {
      width: 280,
      height: 280,
      alignItems: "center",
      justifyContent: "center",
    },

    /** Soft tinted disc behind the animation, standing in for a radial glow. */
    stageWash: {
      position: "absolute",
      width: 260,
      height: 260,
      borderRadius: 130,
    },

    animation: {
      width: 280,
      height: 280,
    },

    // ── Text ──────────────────────────────────────────────────────────────────────

    textBlock: {
      marginTop: spacing.xxxl,
      alignItems: "center",
      paddingHorizontal: spacing.md,
    },

    title: {
      ...typography.title,
      color: c.text,
      textAlign: "center",
      fontSize: 28,
      fontWeight: "700",
      letterSpacing: -0.5,
      marginBottom: spacing.md,
    },

    body: {
      ...typography.body,
      color: c.textMuted,
      textAlign: "center",
      lineHeight: 26,
      fontSize: 16,
      paddingHorizontal: spacing.sm,
    },

    // ── Dots ──────────────────────────────────────────────────────────────────────

    dots: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      marginTop: spacing.xxl,
      marginBottom: spacing.lg,
      gap: spacing.sm,
    },

    dot: {
      width: 8,
      height: 8,
      borderRadius: radii.pill,
      backgroundColor: c.border, // Dim inactive
    },

    // ── Actions ───────────────────────────────────────────────────────────────────

    actions: {
      width: "100%",
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xl,
      gap: spacing.xs,
    },

    ghostBtn: {
      marginTop: spacing.xs,
    },
  });
