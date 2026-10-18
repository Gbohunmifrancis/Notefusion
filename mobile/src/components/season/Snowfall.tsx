/**
 * A few seconds of slow snow (board d-christmas/01–02), on the splash and the top of Home only, while the season is
 * on: about fourteen flakes, 2–5 px and 30–60% white (pale blue-grey on Day), falling 40–70 px a second with an 8 px
 * sway. None starts after 3 s and all have gone by 6 s: it plays once and leaves nothing behind. Nothing at all with
 * Reduce Motion. The numbers are lib/season's `snowPlan`.
 *
 * Core `Animated` on the native driver (no native module, so it ships over the air), never touchable.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import Svg, { G, Path } from "react-native-svg";

import { snowPlan, type Flake } from "../../lib/season";

interface Props {
  /** Plays once when this turns true (and the box has been measured). */
  run: boolean;
  /** The sky's seed: the same flakes every time on one screen. */
  seed?: number;
  /** The flakes' colour: the palette's `snow` (white on Night, pale blue-grey on Day). */
  color: string;
  /** Where the sky is: absolutely positioned by the caller, e.g. the top third of Home. */
  style?: StyleProp<ViewStyle>;
}

export function Snowfall({ run, seed = 11, color, style }: Props) {
  const reduceMotion = useReducedMotion();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [done, setDone] = useState(false);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!box || box.w !== width || box.h !== height) setBox({ w: width, h: height });
  };

  if (reduceMotion || done) return null;
  return (
    <View
      pointerEvents="none"
      style={[styles.sky, style]}
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {box && run ? <Flakes w={box.w} h={box.h} seed={seed} color={color} onDone={() => setDone(true)} /> : null}
    </View>
  );
}

function Flakes({ w, h, seed, color, onDone }: { w: number; h: number; seed: number; color: string; onDone: () => void }) {
  const plan = useMemo(() => snowPlan(seed, h), [seed, h]);
  const t = useRef(plan.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const runs = plan.map((f, i) =>
      Animated.timing(t[i]!, {
        toValue: 1,
        duration: f.duration * 1000,
        delay: f.delay * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const all = Animated.parallel(runs);
    all.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => all.stop();
    // Plays once per mount: the plan never changes under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {plan.map((f, i) => (
        <FlakeView key={i} f={f} t={t[i]!} x={f.x * w} color={color} />
      ))}
    </>
  );
}

function FlakeView({ f, t, x, color }: { f: Flake; t: Animated.Value; x: number; color: string }) {
  const fall = f.speed * f.duration;
  // In over 0.4 s, out over the last second: a flake fades rather than vanishing at the edge of its time.
  const fadeIn = Math.min(0.4 / f.duration, 0.3);
  const fadeOut = Math.max(fadeIn + 0.01, 1 - 1 / f.duration);
  const style = {
    left: x - f.size / 2,
    top: f.y,
    opacity: t.interpolate({ inputRange: [0, fadeIn, fadeOut, 1], outputRange: [0, f.opacity, f.opacity, 0] }),
    transform: [
      { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, fall] }) },
      // One slow swing either side over the fall.
      { translateX: t.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, f.sway, 0, -f.sway, 0] }) },
    ],
  };
  if (!f.glyph) {
    return (
      <Animated.View
        style={[styles.flake, style, { width: f.size, height: f.size, borderRadius: f.size / 2, backgroundColor: color }]}
      />
    );
  }
  return (
    <Animated.View style={[styles.flake, style, { width: f.size, height: f.size }]}>
      <Svg width={f.size} height={f.size} viewBox="-10 -10 20 20">
        <G stroke={color} strokeWidth={1.6} strokeLinecap="round" fill="none">
          {[0, 60, 120].map((d) => (
            <Path key={d} rotation={d} d="M0 -8.5V8.5M-2.6 -6.4L0 -4.2L2.6 -6.4M-2.6 6.4L0 4.2L2.6 6.4" />
          ))}
        </G>
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sky: { position: "absolute", overflow: "hidden" },
  flake: { position: "absolute" },
});
