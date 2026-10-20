import React, { useId } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Icon } from "../Icon";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { KeyboardAvoider } from "../KeyboardAvoider";
import { MarkCostume } from "../season/Costume";
import type { Costume } from "../../lib/season";
import { Touchable } from "../Touchable";
import { night, nightFonts } from "../../design/theme";

const MARK = require("../../../assets/brand/mark.png");
/** The shipped mark is 331 × 438; see BrandMark for why it is a tinted image. */
export const MARK_ASPECT = 331 / 438;

/**
 * The Notefusion mark, white by default, at a given height. `costume` lays the season's over it (Christmas's cap,
 * Halloween's witch hat) while a season is on: on the brand mark only — never a control's — and one a screen.
 */
export function Mark({ height, color = "#FFFFFF", costume = null }: { height: number; color?: string; costume?: Costume | null }) {
  const image = (
    <Image
      source={MARK}
      style={{ height, width: height * MARK_ASPECT }}
      resizeMode="contain"
      tintColor={color}
      accessibilityIgnoresInvertColors
    />
  );
  if (!costume) return image;
  return (
    <View style={{ height, width: height * MARK_ASPECT }}>
      {image}
      <MarkCostume height={height} costume={costume} />
    </View>
  );
}

/**
 * "Notefusion" in the wordmark face. Nunito Black, and nowhere else.
 *
 * One line always (a logo does not wrap), grown at most 1.2x with large system text, and 2 px clear either side
 * so Android's negative letter spacing cannot shave the last glyph.
 */
export function Wordmark({ size, style }: { size: number; style?: StyleProp<TextStyle> }) {
  return (
    <Text
      style={[
        { fontFamily: nightFonts.wordmark, fontSize: size, color: night.text, letterSpacing: -size * 0.02, paddingHorizontal: 2 },
        style,
      ]}
      numberOfLines={1}
      maxFontSizeMultiplier={1.2}
      accessibilityRole="header"
    >
      Notefusion
    </Text>
  );
}

/** Mark and wordmark side by side, the small lock-up in screen headers; `costume` while a season is on. */
export function Lockup({ size = 16, costume = null }: { size?: number; costume?: Costume | null }) {
  return (
    <View style={styles.lockup} accessible accessibilityLabel="Notefusion">
      <Mark height={size * 1.25} costume={costume} />
      <Wordmark size={size} />
    </View>
  );
}

/**
 * A soft radial bloom behind a screen — the "light" in the night palette. Drawn
 * with SVG because React Native has no radial gradient of its own.
 */
export function Glow({
  x = 0.5,
  y = 0.3,
  radius = 260,
  color = night.blue,
  opacity = 0.22,
}: {
  /** Centre as a fraction of the window. */
  x?: number;
  y?: number;
  radius?: number;
  color?: string;
  opacity?: number;
}) {
  const { width, height } = useWindowDimensions();
  // useId gives ":r1:"; colons are not safe inside an SVG url(#…) reference.
  const id = "glow" + useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={height}>
      <Defs>
        <RadialGradient id={id} cx={width * x} cy={height * y} r={radius} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

/** The round 40px back button. */
export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Touchable onPress={onPress} hitSlop={8} radius={20} accessibilityLabel="Go back" style={styles.iconBtn}>
      <Icon name="back" size={20} color={night.text} />
    </Touchable>
  );
}

/** A plain-language problem, shown once above the action it blocks. */
export function ErrorNote({
  message,
  action,
}: {
  message: string;
  /** A way on, after the words ("Forgot password?"): a text link with a 44 px hit area. */
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.error} accessibilityLiveRegion="polite">
      <Icon name="problem" size={17} color={night.amber} />
      {action ? (
        <View style={styles.errorBody}>
          <Text style={styles.errorWords}>{message}</Text>
          <Pressable
            onPress={action.onPress}
            hitSlop={13}
            style={({ pressed }) => pressed && pressedLink}
            accessibilityRole="button"
          >
            <Text style={styles.errorLink}>{action.label}</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.errorText}>{message}</Text>
      )}
    </View>
  );
}

export function OrRule() {
  return (
    <View style={styles.or}>
      <View style={styles.orLine} />
      <Text style={styles.orText}>or</Text>
      <View style={styles.orLine} />
    </View>
  );
}

/**
 * The frame every night auth screen shares: the dark canvas, light status bar,
 * an optional bloom, keyboard avoidance and a scroll body with the 22px gutter.
 */
export function NightScreen({
  children,
  glow,
  header,
  contentStyle,
}: {
  children: React.ReactNode;
  glow?: React.ReactNode;
  /** The row above the scroll body: back button, lock-up, step count. */
  header?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {glow}
      <SafeAreaView style={styles.flex} edges={["top", "bottom"]}>
        {header ? <View style={styles.header}>{header}</View> : null}
        <KeyboardAvoider>
          <ScrollView
            contentContainerStyle={[styles.body, contentStyle]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </KeyboardAvoider>
      </SafeAreaView>
    </View>
  );
}

export const nightText = StyleSheet.create({
  h1: {
    fontSize: 34,
    lineHeight: 37,
    fontFamily: nightFonts.semibold,
    letterSpacing: -1.3,
    color: night.text,
  },
  lead: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: nightFonts.regular,
    color: night.muted,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.7,
    textTransform: "uppercase",
    fontFamily: nightFonts.medium,
    color: night.muted,
  },
  link: { fontSize: 14, fontFamily: nightFonts.semibold, color: night.text },
  muted: { fontSize: 14, fontFamily: nightFonts.regular, color: night.muted },
  step: { fontSize: 12, fontFamily: nightFonts.mono, color: night.muted },
});

/**
 * The pressed look for a bare text link: an instant dim, no motion. Use as
 * `style={({ pressed }) => [base, pressed && pressedLink]}` on a `Pressable`.
 */
export const pressedLink = { opacity: 0.55 } as const;

/**
 * A link as its own text button (board m-ux-medium P5d): the words and colour of a link in a sentence, but 44 px tall
 * with 10 px either side, so a thumb can hit it. Its lead-in ("New here?") stays plain text beside it. `legal` is the
 * legal line's: 13 px, underlined, in the muted grey.
 */
export function NightLink({ label, onPress, legal = false }: { label: string; onPress: () => void; legal?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      style={({ pressed }) => [styles.textButton, legal && styles.textButtonLegal, pressed && pressedLink]}
    >
      <Text style={legal ? styles.legalLink : nightText.link}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: night.bg },
  flex: { flex: 1 },
  header: {
    height: 52,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  body: { flexGrow: 1, paddingHorizontal: 22, paddingBottom: 32 },
  lockup: { flexDirection: "row", alignItems: "center", gap: 7 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: night.surface2,
    borderWidth: 1,
    borderColor: night.line,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    // A neutral card: the amber icon and the words say it is a problem, never a red wash.
    backgroundColor: night.surface2,
    borderWidth: 1,
    borderColor: night.line,
  },
  errorText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontFamily: nightFonts.medium, color: night.text },
  /** The words and the link on one line while they fit, the link wrapping under them when not. */
  errorBody: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 4 },
  errorWords: { fontSize: 13.5, lineHeight: 19, fontFamily: nightFonts.medium, color: night.text },
  errorLink: { fontSize: 13.5, lineHeight: 19, fontFamily: nightFonts.semibold, color: night.ice },
  or: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 20 },
  orLine: { flex: 1, height: 1, backgroundColor: night.line },
  orText: { fontSize: 13, fontFamily: nightFonts.regular, color: night.faint },
  textButton: { minHeight: 44, paddingHorizontal: 10, justifyContent: "center" },
  textButtonLegal: { paddingHorizontal: 8 },
  legalLink: { fontSize: 13, fontFamily: nightFonts.medium, color: night.muted, textDecorationLine: "underline" },
});
