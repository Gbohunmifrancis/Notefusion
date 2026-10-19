import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle } from "react-native-svg";
import { Glow, MARK_ASPECT, Mark, Wordmark } from "../components/night/NightUI";
import { MarkCostume } from "../components/season/Costume";
import { Snowfall } from "../components/season/Snowfall";
import { Bats } from "../components/season/Bats";
import { Crescent } from "../components/season/Crescent";
import { brimOnMark, costumeOf, seasonChime, type SeasonName, type SplashSeason } from "../lib/season";
import { prepareTune } from "../lib/seasonChime";
import { darkColors, night, nightFonts } from "../design/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Halloween's crescent moon behind the mark: its box, px (the moon itself fills about two thirds of it). */
const CRESCENT = 250;

/** The seven level bars a voice raises in the first beat of the intro. */
const BARS = [18, 34, 56, 30, 48, 22, 40];
/** Bar width plus gap: the distance between neighbouring bar centres. */
const PITCH = 16;
/**
 * The three that stay and become the mark's descending bars (56, 48, 40), and
 * how far each slides so the trio closes up around the centre.
 */
const STAY: Record<number, number> = { 2: 0, 4: -PITCH, 6: -PITCH * 2 };
/** The mark's own three bars: all the brief version raises. */
const MARK_BARS = Object.keys(STAY).map(Number);

const RING_R = 62;
/** The arc's drawn length; the gap that is left is where the "5" opens. */
const RING_ARC = 260;

type Play = "hold" | "intro" | "brief" | "still";

interface Props {
  /**
   * `intro` is the full first-run animation, `brief` the short one every later
   * cold start gets, `hold` the native splash's cover alone while the fonts load,
   * and `still` (the default) the finished frame, for when the app is waiting on
   * something else after the splash has already played.
   */
  play?: Play;
  /**
   * The season as the phone last heard it (lib/appReady): `intro` once a season — the costume drops onto the mark as
   * it lights (1.0 s: 220 ms down, then a spring with a 4° wobble) and the season's few seconds play: at Christmas
   * the cap, a few flakes and "Joy to the world"; at Halloween the witch hat, eight bats across the top third and the
   * Mountain King's opening, under a faint crescent moon. `dressed` after that, the costume (and the moon) simply on;
   * `none` (the default) exactly as always. The still frame that may follow wears what the launch wore.
   */
  season?: SplashSeason;
  /** Which season it is (lib/appReady); Christmas when not said, as before Halloween was. */
  seasonName?: SeasonName | null;
}

/**
 * Whether this launch played the full intro, for the still frame that may follow
 * it (RootNavigator, while the session restores): the tagline belongs to it only.
 */
let introPlayed = false;
/** What this launch's splash wore for the season, for that still frame too. */
let launchSeason: SplashSeason = "none";
let launchSeasonName: SeasonName = "christmas";

/** The splash mark's height. */
const MARK_H = 132;

/**
 * The animated splash (board a-core/02). The first launch on a phone, about 1.6 s:
 *
 *   0.0 s  seven bars rise out of the native splash's blue, like a sung level
 *   0.5 s  four fall away, three close up and a ring draws round them
 *   1.0 s  the mark itself lights up with a bloom and the wordmark rises
 *   1.4 s  the tagline lands, and the app takes over from this frame
 *
 * Every cold start after it, 0.6 s: the blue dissolves (160 ms), only the mark's
 * own three bars rise, 30 ms apart, the ring sweeps once (0.15–0.39 s), and the
 * mark and wordmark land together (0.35–0.60 s), with no tagline. Coming back from
 * the background shows no splash at all: the app is still in memory.
 *
 * It opens on the native splash's colour and mark (app.json) so the hand-over is a
 * dissolve rather than a cut. Nothing here blocks a tap: the app mounts the moment
 * `useAppReady` says so. Reduce Motion gets the finished frame with a 200 ms fade.
 *
 * While `hold`, only the cover is drawn. The wordmark must first be laid out once
 * Nunito Black is in memory: laid out earlier, Android measures it in the fallback
 * face (narrower), keeps that box when the font arrives, and the last "n" of
 * "Notefusion" falls onto a hidden second line.
 */
export function SplashScreen({ play = "still", season, seasonName }: Props) {
  const finished = play === "still";
  if (play === "intro") introPlayed = true;
  if (play !== "still" && play !== "hold" && season) {
    launchSeason = season;
    launchSeasonName = seasonName ?? "christmas";
  }
  const dress: SplashSeason = season ?? (finished ? launchSeason : "none");
  const which: SeasonName = season ? seasonName ?? "christmas" : launchSeasonName;
  const costume = costumeOf(which)!;
  const halloween = dress !== "none" && which === "halloween";
  /** The season's intro drops the costume on; every other dressed splash shows it on from the start. */
  const dropping = play === "intro" && dress === "intro";
  /** Where the costume's brim sits on the mark (lib/season): the drop's wobble turns about it. */
  const [pivotX, pivotY] = brimOnMark(costume, MARK_H);

  const cover = useRef(new Animated.Value(play === "still" ? 0 : 1)).current;
  const barIn = useRef(BARS.map(() => new Animated.Value(0))).current;
  const gather = useRef(new Animated.Value(0)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;
  /** Not native-driven: an SVG stroke offset is a prop, not a style. */
  const ringDraw = useRef(new Animated.Value(RING_ARC)).current;
  const stageOut = useRef(new Animated.Value(0)).current;
  const markIn = useRef(new Animated.Value(finished ? 1 : 0)).current;
  const glow = useRef(new Animated.Value(finished ? 0.7 : 0)).current;
  const wordIn = useRef(new Animated.Value(finished ? 1 : 0)).current;
  const tagIn = useRef(new Animated.Value(finished ? 1 : 0)).current;
  /** The season's costume: 0 above the mark and unseen, 1 on it. */
  const capIn = useRef(new Animated.Value(dropping ? 0 : 1)).current;
  /** Its wobble once landed, ±1 for ±4°. */
  const capTilt = useRef(new Animated.Value(0)).current;
  /** The season's few seconds of snow or bats, from the moment the costume drops. */
  const [sky, setSky] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (play === "hold" || play === "still" || started.current) return;
    started.current = true;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // The season's first splash: its chime ("Joy to the world", or the Mountain King's tiptoe) as the costume lands
    // (1.0 s), rendered now so it is ready by then. It plays with Reduce Motion too (sound is not motion), never with
    // the app's sound off, and rings on after the splash hands over.
    if (dropping) {
      // The same splash was the native cover a moment ago (`hold`), with the costume at rest: lift it for the drop.
      capIn.setValue(0);
      const startedAt = Date.now();
      const tune = seasonChime(which);
      void prepareTune(tune.notes, tune.bpm).then((chime) => {
        if (!chime || cancelled) return;
        const wait = Math.max(0, 1000 - (Date.now() - startedAt));
        timers.push(setTimeout(chime, wait));
      });
    }

    const dropCap = () =>
      Animated.sequence([
        Animated.timing(capIn, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(capTilt, { toValue: 1, duration: 60, useNativeDriver: true }),
          Animated.spring(capTilt, { toValue: 0, friction: 3.2, tension: 140, useNativeDriver: true }),
        ]),
      ]);

    const t = (v: Animated.Value, toValue: number, duration: number, easing = Easing.out(Easing.cubic)) =>
      Animated.timing(v, { toValue, duration, easing, useNativeDriver: true });

    // Reduce Motion: the finished frame, uncovered in 200 ms.
    const finish = () => {
      stageOut.setValue(1);
      markIn.setValue(1);
      glow.setValue(0.7);
      wordIn.setValue(1);
      capIn.setValue(1);
      if (play === "intro") tagIn.setValue(1);
      t(cover, 0, 200).start();
    };

    // Every later cold start: the same motif in 0.6 s. The kept bars start closed
    // up (`gather` at 1), so only the mark's own three rise and the rest stay hidden.
    const brief = () => {
      gather.setValue(1);
      Animated.parallel([
        t(cover, 0, 160),
        Animated.stagger(
          30,
          MARK_BARS.map((i) =>
            Animated.timing(barIn[i]!, {
              toValue: 1,
              duration: 160,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ),
        ),
        Animated.sequence([
          Animated.delay(150),
          Animated.parallel([
            t(ringOpacity, 1, 80),
            Animated.timing(ringDraw, {
              toValue: 0,
              duration: 240,
              easing: Easing.inOut(Easing.cubic),
              useNativeDriver: false,
            }),
          ]),
        ]),
        Animated.sequence([
          Animated.delay(350),
          Animated.parallel([t(stageOut, 1, 160), t(markIn, 1, 250), t(wordIn, 1, 250), t(glow, 0.7, 250)]),
        ]),
      ]).start();
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) return finish();
        if (play === "brief") return brief();

        Animated.parallel([
          t(cover, 0, 280),

          // Beat 1: the bars rise, left to right.
          Animated.stagger(
            45,
            barIn.map((v) => Animated.timing(v, {
              toValue: 1,
              duration: 320,
              delay: 100,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            })),
          ),

          // Beat 2: four fall away, three close up, the ring draws itself.
          Animated.sequence([
            Animated.delay(520),
            Animated.parallel([
              t(gather, 1, 320),
              t(ringOpacity, 1, 120),
              Animated.timing(ringDraw, {
                toValue: 0,
                duration: 480,
                easing: Easing.inOut(Easing.cubic),
                useNativeDriver: false,
              }),
            ]),
          ]),

          // Beat 3: the real mark lights up over them, with one bloom (and, once a season, the costume drops on).
          Animated.sequence([
            Animated.delay(1000),
            Animated.parallel([
              t(stageOut, 1, 240),
              Animated.spring(markIn, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 5 }),
              Animated.sequence([t(glow, 1, 320), t(glow, 0.7, 400)]),
              ...(dropping ? [dropCap()] : []),
            ]),
          ]),
          Animated.sequence([Animated.delay(1150), t(wordIn, 1, 320)]),

          // Beat 4: the promise.
          Animated.sequence([Animated.delay(1400), t(tagIn, 1, 260)]),
        ]).start();
        // The season's few flakes or bats start with the costume.
        if (dropping) timers.push(setTimeout(() => setSky(true), 1000));
      });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [play]);

  // The fonts are not in memory yet: the native splash's cover alone (the native
  // splash itself is still up, so nothing visible changes). See the note above.
  if (play === "hold") {
    return (
      <View style={styles.root} accessible accessibilityLabel="Notefusion">
        <StatusBar style="light" />
        <View pointerEvents="none" style={styles.cover}>
          <Mark height={119} />
        </View>
      </View>
    );
  }

  const stageOpacity = stageOut.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const showTagline = play === "intro" || (play === "still" && introPlayed);

  return (
    <View style={styles.root} accessible accessibilityLabel="Notefusion">
      <StatusBar style="light" />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]}>
        <Glow y={0.42} radius={300} opacity={0.42} />
      </Animated.View>

      <View style={styles.column}>
        <View style={styles.stage}>
          {/* Halloween's faint crescent, behind and to the right of the mark: it fades in with the mark and stays. */}
          {halloween ? (
            <Animated.View pointerEvents="none" style={[styles.crescent, { opacity: markIn }]}>
              <Crescent size={CRESCENT} />
            </Animated.View>
          ) : null}
          {!finished && (
            <Animated.View style={[styles.centre, { opacity: stageOpacity }]}>
              <Animated.View style={[styles.ring, { opacity: ringOpacity }]}>
                <Svg width={200} height={200}>
                  <AnimatedCircle
                    cx={100}
                    cy={100}
                    r={RING_R}
                    fill="none"
                    stroke={night.blue}
                    strokeWidth={15}
                    strokeLinecap="round"
                    strokeDasharray={`${RING_ARC} 400`}
                    strokeDashoffset={ringDraw}
                    rotation={150}
                    origin="100, 100"
                  />
                </Svg>
              </Animated.View>

              <View style={styles.bars}>
                {BARS.map((h, i) => {
                  const stays = i in STAY;
                  const rise = barIn[i]!;
                  const transform = [
                    {
                      translateX: stays
                        ? gather.interpolate({ inputRange: [0, 1], outputRange: [0, STAY[i]!] })
                        : 0,
                    },
                    {
                      translateY: stays
                        ? 0
                        : gather.interpolate({ inputRange: [0, 1], outputRange: [0, 16] }),
                    },
                    { scaleY: rise },
                  ];
                  const opacity = stays
                    ? rise
                    : Animated.multiply(rise, gather.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }));
                  return (
                    <Animated.View key={i} style={[styles.bar, { height: h, opacity, transform }]}>
                      <LinearGradient colors={[night.ice, night.blue]} style={StyleSheet.absoluteFill} />
                    </Animated.View>
                  );
                })}
              </View>
            </Animated.View>
          )}

          <Animated.View
            style={[
              styles.centre,
              {
                opacity: markIn,
                transform: [{ scale: markIn.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }],
              },
            ]}
          >
            {dress === "none" ? (
              <Mark height={MARK_H} />
            ) : (
              <View style={styles.capped}>
                <Mark height={MARK_H} />
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      transformOrigin: [pivotX, pivotY, 0],
                      opacity: capIn.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
                      transform: [
                        { translateY: capIn.interpolate({ inputRange: [0, 1], outputRange: [-44, 0] }) },
                        { rotate: capTilt.interpolate({ inputRange: [-1, 1], outputRange: ["4deg", "-4deg"] }) },
                      ],
                    },
                  ]}
                >
                  <MarkCostume height={MARK_H} costume={costume} />
                </Animated.View>
              </View>
            )}
          </Animated.View>
        </View>

        <Animated.View
          style={{
            opacity: wordIn,
            transform: [{ translateY: wordIn.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
          }}
        >
          <Wordmark size={38} />
        </Animated.View>
        {showTagline ? (
          <Animated.View style={{ opacity: tagIn }}>
            <Text style={styles.tagline}>Hear it. See it. Notate it.</Text>
          </Animated.View>
        ) : null}
      </View>

      {/* The season's few seconds (its intro only): they start with the costume and play on as the app takes over —
          flakes falling at Christmas, bats across the top third at Halloween. */}
      {dropping && which === "christmas" ? <Snowfall run={sky} seed={21} color={night.text} style={StyleSheet.absoluteFill} /> : null}
      {dropping && which === "halloween" ? <Bats run={sky} seed={5} color={darkColors.bat} style={styles.batSky} /> : null}

      {/* The native splash, recreated so the hand-over dissolves instead of cutting. */}
      <Animated.View pointerEvents="none" style={[styles.cover, { opacity: cover }]}>
        <Mark height={119} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: night.bgDeep },
  column: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 40 },
  stage: { width: 220, height: 200, marginBottom: 18 },
  centre: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute" },
  capped: { width: MARK_H * MARK_ASPECT, height: MARK_H },
  /** Behind and to the right of the mark, centred above its top right. */
  crescent: { position: "absolute", left: 110 + 92 - CRESCENT / 2, top: 100 - 62 - CRESCENT / 2 },
  /** The top third of the screen. */
  batSky: { top: 0, left: 0, right: 0, height: "34%" },
  bars: { flexDirection: "row", alignItems: "center", gap: PITCH - 9 },
  bar: {
    width: 9,
    borderRadius: 5,
    overflow: "hidden",
    shadowColor: night.blue,
    shadowOpacity: 0.5,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
  },
  tagline: { marginTop: 8, fontSize: 15, fontFamily: nightFonts.regular, color: night.muted },
  cover: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: night.nativeSplash,
    alignItems: "center",
    justifyContent: "center",
  },
});
