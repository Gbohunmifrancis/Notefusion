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
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { gradients, colors, radii, spacing, typography } from "../design/theme";
import type { AuthStackParams } from "../navigation/types";

const { width } = Dimensions.get("window");

// ─── Slide data ───────────────────────────────────────────────────────────────

const SLIDES: {
  icon: keyof typeof Ionicons.glyphMap;
  gradient: readonly [string, string];
  title: string;
  body: string;
  accent: string;
}[] = [
  {
    icon: "mic",
    gradient: ["#D946EF", "#A855F7"], // Pink → Purple
    title: "Record a melody",
    body: "Capture a live tune or hum — a few bars is all it takes. Sing, hum, or play near the mic.",
    accent: "#D946EF",
  },
  {
    icon: "sparkles",
    gradient: ["#A855F7", "#F59E0B"], // Purple → Gold  ("The Fusion")
    title: "Instant transcription",
    body: "We turn your audio into Tonic Solfa and staff notation, perfectly on-key every time.",
    accent: "#A855F7",
  },
  {
    icon: "library",
    gradient: ["#F59E0B", "#D97706"], // Gold → Amber
    title: "Save & re-key",
    body: "Build a personal library and change the Doh anytime — your notes never shift, only the labels do.",
    accent: "#F59E0B",
  },
];

type Props = NativeStackScreenProps<AuthStackParams, "Onboarding">;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * OnboardingScreen — dark luxury three-slide intro.
 *
 * Design language:
 *   • Pitch Black canvas with no competing backgrounds.
 *   • Each slide has a large gradient "bubble" icon (using its own accent gradient).
 *   • Dot indicators: active dot expands into a pill and glows in the slide accent.
 *   • "Next" uses the GradientButton (The Fusion); "I already have an account" is ghost.
 *   • Subtle slide-in animation on mount so the first slide doesn't just snap into view.
 */
export function OnboardingScreen({ navigation }: Props) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);

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

  const currentAccent = SLIDES[index]?.accent ?? colors.purple;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />

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
            {/* Gradient icon bubble */}
            <View style={styles.bubbleWrap}>
              <LinearGradient
                colors={item.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.bubble}
              >
                {/* Inner glass ring */}
                <View style={styles.bubbleRing}>
                  <Ionicons name={item.icon} size={64} color="#FFFFFF" />
                </View>
              </LinearGradient>
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#000000",
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

  // ── Bubble icon ──────────────────────────────────────────────────────────────

  bubbleWrap: {
    // Outer shadow ring
    shadowColor: colors.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 32,
    elevation: 12,
  },

  bubble: {
    width: 180,
    height: 180,
    borderRadius: 90,
    alignItems: "center",
    justifyContent: "center",
  },

  /** Frosted inner ring — simulates depth inside the bubble. */
  bubbleRing: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.25)",
  },

  // ── Text ──────────────────────────────────────────────────────────────────────

  textBlock: {
    marginTop: spacing.xxxl,
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },

  title: {
    ...typography.title,
    color: colors.text, // Crisp White
    textAlign: "center",
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginBottom: spacing.md,
  },

  body: {
    ...typography.body,
    color: colors.textMuted, // Soft Ash
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
    backgroundColor: "rgba(255, 255, 255, 0.20)", // Dim inactive
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
