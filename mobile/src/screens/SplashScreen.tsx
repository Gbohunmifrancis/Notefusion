import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle } from "react-native-svg";
import { Glow, Mark, Wordmark } from "../components/night/NightUI";
import { night, nightFonts } from "../design/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** The seven level bars a voice raises in the first beat of the intro. */
const BARS = [18, 34, 56, 30, 48, 22, 40];
/** Bar width plus gap: the distance between neighbouring bar centres. */
const PITCH = 16;
/**
 * The three that stay and become the mark's descending bars (56, 48, 40), and
 * how far each slides so the trio closes up around the centre.
 */
const STAY: Record<number, number> = { 2: 0, 4: -PITCH, 6: -PITCH * 2 };

const RING_R = 62;
/** The arc's drawn length; the gap that is left is where the "5" opens. */
const RING_ARC = 260;

type Play = "hold" | "intro" | "brief" | "still";

interface Props {
  /**
   * `intro` is the full first-run animation, `brief` the quick reveal returning
   * users get, `hold` the native splash colour while fonts load, and `still`
   * (the default) the finished frame, for when the app is waiting on something
   * else after the splash has already played.
   */
  play?: Play;
}

/**
 * The animated splash, in four beats over about 1.6 seconds:
 *
 *   0.0 s  seven bars rise out of the native splash's blue, like a sung level
 *   0.5 s  four fall away, three close up and a ring draws round them
 *   1.0 s  the mark itself lights up with a bloom and the wordmark rises
 *   1.4 s  the tagline lands, and the app takes over from this frame
 *
 * It opens on the native splash's colour and mark (app.json) so the hand-over
 * from the static native splash is a dissolve rather than a cut. Nothing here
 * blocks a tap: the app mounts the moment `useAppReady` says so. People who ask
 * the system for reduced motion get the brief reveal instead.
 */
export function SplashScreen({ play = "still" }: Props) {
  const finished = play === "still" || play === "brief";

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
  const started = useRef(false);

  useEffect(() => {
    if (play === "hold" || play === "still" || started.current) return;
    started.current = true;
    let cancelled = false;

    const t = (v: Animated.Value, toValue: number, duration: number, easing = Easing.out(Easing.cubic)) =>
      Animated.timing(v, { toValue, duration, easing, useNativeDriver: true });

    const finish = () => {
      markIn.setValue(1);
      glow.setValue(0.7);
      wordIn.setValue(1);
      tagIn.setValue(1);
      t(cover, 0, 260).start();
    };

    // Returning users: the finished frame, uncovered. It is set here rather than
    // at mount because the screen first renders in `hold`, before the launch flag
    // has been read.
    if (play === "brief") {
      finish();
      return;
    }

    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) return finish();

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

          // Beat 3: the real mark lights up over them, with one bloom.
          Animated.sequence([
            Animated.delay(1000),
            Animated.parallel([
              t(stageOut, 1, 240),
              Animated.spring(markIn, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 5 }),
              Animated.sequence([t(glow, 1, 320), t(glow, 0.7, 400)]),
            ]),
          ]),
          Animated.sequence([Animated.delay(1150), t(wordIn, 1, 320)]),

          // Beat 4: the promise.
          Animated.sequence([Animated.delay(1400), t(tagIn, 1, 260)]),
        ]).start();
      });

    return () => {
      cancelled = true;
    };
  }, [play]);

  const stageOpacity = stageOut.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <View style={styles.root} accessible accessibilityLabel="Notefusion">
      <StatusBar style="light" />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]}>
        <Glow y={0.42} radius={300} opacity={0.42} />
      </Animated.View>

      <View style={styles.column}>
        <View style={styles.stage}>
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
                  const rise = barIn[i];
                  const transform = [
                    {
                      translateX: stays
                        ? gather.interpolate({ inputRange: [0, 1], outputRange: [0, STAY[i]] })
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
            <Mark height={132} />
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
        <Animated.View style={{ opacity: tagIn }}>
          <Text style={styles.tagline}>Hear it. See it. Notate it.</Text>
        </Animated.View>
      </View>

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
