import React, { useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop, Text as SvgText } from "react-native-svg";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { NightButton } from "../components/night/NightButton";
import { Glow, Lockup, nightText } from "../components/night/NightUI";
import { AppleMusicLogo, SpotifyLogo, YouTubeLogo, YouTubeMusicLogo } from "../components/SourceLogos";
import { onboarding } from "../lib/onboarding";
import { night, nightFonts } from "../design/theme";
import type { AuthStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AuthStackParams, "Onboarding">;

interface Slide {
  key: string;
  eyebrow: string;
  title: string;
  body: string;
  /** The tint of the bloom behind this card. */
  glow: string;
  Art: React.ComponentType<{ width: number }>;
}

const SLIDES: Slide[] = [
  {
    key: "sing",
    eyebrow: "01 · Sing",
    title: "Hum a tune.\nSee it as solfa.",
    body: "A few bars is enough. Notefusion finds the doh, the beat and every note while you sing.",
    glow: night.blue,
    Art: PitchLineArt,
  },
  {
    key: "song",
    eyebrow: "02 · Any song",
    title: "Paste a link.\nGet the melody.",
    body: "From YouTube, Spotify or Apple Music. The lead voice is lifted out of the band and written down.",
    glow: "#FF5A3C",
    Art: SourcesArt,
  },
  {
    key: "rehearse",
    eyebrow: "03 · Rehearse",
    title: "Teach it to\nthe whole choir.",
    body: "Play it back in parts, move it to your singers' key and send the folder as one link.",
    glow: night.mint,
    Art: RehearseArt,
  },
];

/**
 * Three cards that show the product itself rather than illustrations of it: the
 * pitch line the recorder draws, the services a song can come from, and the
 * rehearsal tools. Skip and the last card's button both lead to Welcome, where
 * the person chooses how to sign in, and the cards are not shown again.
 */
export function OnboardingScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Slide>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;

  const finish = () => {
    onboarding.markSeen();
    navigation.replace("Welcome");
  };

  const next = () => {
    if (isLast) return finish();
    listRef.current?.scrollToOffset({ offset: width * (index + 1), animated: true });
    setIndex(index + 1);
  };

  const onSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* One bloom per card, cross-faded with the swipe. */}
      {SLIDES.map((s, i) => (
        <Animated.View
          key={s.key}
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: scrollX.interpolate({
                inputRange: [(i - 1) * width, i * width, (i + 1) * width],
                outputRange: [0, 1, 0],
                extrapolate: "clamp",
              }),
            },
          ]}
        >
          <Glow y={0.3} radius={300} color={s.glow} opacity={s.glow === night.blue ? 0.22 : 0.16} />
        </Animated.View>
      ))}

      <SafeAreaView style={styles.flex} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Lockup />
          <Pressable
            onPress={finish}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Skip the introduction"
          >
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        </View>

        <Animated.FlatList
          ref={listRef}
          data={SLIDES}
          keyExtractor={(s) => s.key}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onSettled}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
          style={styles.flex}
          renderItem={({ item, index: i }) => {
            // The words drift a little slower than the page, so a swipe has depth.
            const drift = scrollX.interpolate({
              inputRange: [(i - 1) * width, i * width, (i + 1) * width],
              outputRange: [width * 0.18, 0, -width * 0.18],
              extrapolate: "clamp",
            });
            return (
              <View style={[styles.slide, { width }]}>
                <View style={styles.art}>
                  <item.Art width={width - 44} />
                </View>
                <Animated.View style={{ transform: [{ translateX: drift }] }}>
                  <Text style={nightText.eyebrow}>{item.eyebrow}</Text>
                  <Text style={[nightText.h1, styles.title]}>{item.title}</Text>
                  <Text style={[nightText.lead, styles.body]}>{item.body}</Text>
                </Animated.View>
              </View>
            );
          }}
        />

        <View style={styles.footer}>
          <View style={styles.dots} accessibilityLabel={`Card ${index + 1} of ${SLIDES.length}`}>
            {SLIDES.map((s) => (
              <View key={s.key} style={styles.slot}>
                <View style={styles.dot} />
              </View>
            ))}
            {/* The current-card pill slides between the slots with the swipe. */}
            <Animated.View
              style={[
                styles.pill,
                {
                  transform: [
                    {
                      translateX: scrollX.interpolate({
                        inputRange: [0, width * (SLIDES.length - 1)],
                        outputRange: [0, (SLOT + SLOT_GAP) * (SLIDES.length - 1)],
                        extrapolate: "clamp",
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>
          <NightButton
            label={isLast ? "Get started" : "Next"}
            variant={isLast ? "blue" : "white"}
            onPress={next}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

/** Each page dot sits in a slot as wide as the current-card pill. */
const SLOT = 22;
const SLOT_GAP = 4;

// ─── Card art ────────────────────────────────────────────────────────────────

/** The recorder's pitch line climbing d r m f s to a lit l. */
function PitchLineArt({ width }: { width: number }) {
  const w = Math.min(width, 346);
  const labels: [string, number, number][] = [
    ["d", 54, 172],
    ["r", 104, 148],
    ["m", 155, 124],
    ["f", 206, 100],
    ["s", 256, 76],
  ];
  return (
    <Svg width={w} height={(w * 230) / 346} viewBox="0 0 346 230">
      <Defs>
        <SvgGradient id="pitchLine" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={night.blue} stopOpacity={0.15} />
          <Stop offset="0.7" stopColor="#5C9BFF" />
          <Stop offset="1" stopColor="#BBD5FF" />
        </SvgGradient>
      </Defs>
      <Path
        d="M0 190 C 14 186, 24 184, 38 184 L 70 184 C 78 184, 80 160, 88 160 L 120 160 C 128 160, 130 136, 138 136 L 172 136 C 180 136, 182 112, 190 112 L 222 112 C 230 112, 232 88, 240 88 L 272 88 C 280 88, 284 56, 296 50 C 306 45, 318 48, 330 48"
        fill="none"
        stroke="url(#pitchLine)"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <Circle cx={330} cy={48} r={18} fill="rgba(156, 194, 255, 0.22)" />
      <Circle cx={330} cy={48} r={7} fill="#FFFFFF" />
      {labels.map(([syl, x, y]) => (
        <SvgText key={syl} x={x} y={y} fontFamily={nightFonts.mono} fontSize={17} fill={night.muted} textAnchor="middle">
          {syl}
        </SvgText>
      ))}
      <SvgText x={330} y={24} fontFamily={nightFonts.monoBold} fontSize={24} fill="#FFFFFF" textAnchor="middle">
        l
      </SvgText>
    </Svg>
  );
}

/** The source services around a song card whose first notes are already solfa. */
function SourcesArt({ width }: { width: number }) {
  const w = Math.min(width, 346);
  const logo = (rotate: string, left: number, top: number, child: React.ReactNode) => (
    <View style={[styles.logo, { left: (left / 346) * w, top, transform: [{ rotate }] }]}>{child}</View>
  );
  return (
    <View style={{ width: w, height: 280 }}>
      {logo("-8deg", 14, 18, <YouTubeLogo />)}
      {logo("9deg", 276, 8, <YouTubeMusicLogo />)}
      {logo("6deg", 6, 214, <SpotifyLogo />)}
      {logo("-7deg", 282, 206, <AppleMusicLogo />)}
      <LinearGradient
        colors={["#FF9A3D", "#E8434F", "#6B1D4A"]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.songCard, { left: (w - 200) / 2 }]}
      >
        <Text style={styles.songTitle}>Amazing Grace</Text>
        <Text style={styles.songSolfa}>s │ d – m d │ m – r</Text>
      </LinearGradient>
    </View>
  );
}

/** The syllable sounding now, the four parts, and the choir tools. */
function RehearseArt() {
  return (
    <View style={styles.rehearse}>
      <View style={styles.syllables}>
        <Text style={[styles.syl, styles.sylFar]}>d</Text>
        <Text style={[styles.syl, styles.sylNear]}>r</Text>
        <Text style={styles.sylNow}>m</Text>
        <Text style={[styles.syl, styles.sylNear]}>f</Text>
        <Text style={[styles.syl, styles.sylFar]}>s</Text>
      </View>
      <View style={styles.parts}>
        {["S", "A", "T", "B"].map((p, i) => (
          <View key={p} style={[styles.part, i === 0 && styles.partOn]}>
            <Text style={styles.partText}>{p}</Text>
          </View>
        ))}
      </View>
      <View style={styles.tags}>
        <View style={[styles.tag, styles.tagBlue]}>
          <Text style={[styles.tagText, { color: night.ice }]}>Transpose for my choir</Text>
        </View>
        <View style={styles.tag}>
          <Text style={styles.tagText}>Share a folder</Text>
        </View>
      </View>
    </View>
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
  skip: { fontSize: 14, fontFamily: nightFonts.medium, color: night.muted },
  slide: { paddingHorizontal: 22, justifyContent: "flex-end", paddingBottom: 8 },
  art: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 240 },
  title: { marginTop: 10 },
  body: { marginTop: 12 },
  footer: { paddingHorizontal: 22, paddingTop: 20, paddingBottom: 12 },
  dots: { flexDirection: "row", alignSelf: "center", gap: SLOT_GAP, marginBottom: 20 },
  slot: { width: SLOT, height: 7, alignItems: "center" },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(255, 255, 255, 0.2)" },
  pill: { position: "absolute", left: 0, top: 0, width: SLOT, height: 7, borderRadius: 4, backgroundColor: "#FFFFFF" },

  logo: {
    position: "absolute",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  songCard: {
    position: "absolute",
    top: 70,
    width: 200,
    height: 150,
    borderRadius: 22,
    padding: 14,
    justifyContent: "flex-end",
    shadowColor: "#E8434F",
    shadowOpacity: 0.35,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 20 },
    elevation: 12,
  },
  songTitle: { fontSize: 17, fontFamily: nightFonts.semibold, color: "#FFFFFF" },
  songSolfa: { marginTop: 2, fontSize: 12, fontFamily: nightFonts.mono, color: "rgba(255,255,255,0.85)" },

  rehearse: { alignItems: "center" },
  syllables: { flexDirection: "row", alignItems: "baseline", gap: 20 },
  syl: { fontFamily: nightFonts.mono },
  sylFar: { fontSize: 22, color: night.dim },
  sylNear: { fontSize: 30, color: night.muted },
  sylNow: {
    fontSize: 104,
    lineHeight: 110,
    fontFamily: nightFonts.mono,
    color: night.text,
    textShadowColor: "rgba(156, 194, 255, 0.5)",
    textShadowRadius: 30,
  },
  parts: { flexDirection: "row", gap: 10, marginTop: 30 },
  part: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: night.line2,
    alignItems: "center",
    justifyContent: "center",
  },
  partOn: {
    backgroundColor: night.blue,
    borderColor: night.blue,
    shadowColor: night.blue,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  partText: { fontSize: 17, fontFamily: nightFonts.semibold, color: night.text },
  tags: { flexDirection: "row", gap: 8, marginTop: 22 },
  tag: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 999,
    justifyContent: "center",
    backgroundColor: night.surface2,
    borderWidth: 1,
    borderColor: night.line,
  },
  tagBlue: { backgroundColor: "rgba(47, 123, 255, 0.12)", borderColor: "rgba(47, 123, 255, 0.3)" },
  tagText: { fontSize: 12, fontFamily: nightFonts.medium, color: night.muted },
});
