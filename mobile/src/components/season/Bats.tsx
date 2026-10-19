/**
 * A few seconds of bats (board j-halloween/01–02), on the splash and the top of Home only, while the Halloween season
 * is on: eight silhouettes, 18–34 px across and 30–50% strong (pale on Night, slate on Day), each flitting across the
 * box in a 2–3 s arc with a two-frame wing flap. None starts after 3 s and all have gone by 6 s: it plays once and
 * leaves nothing behind. Nothing at all with Reduce Motion. The numbers are lib/season's `batPlan`; Snowfall's twin.
 *
 * Core `Animated` on the native driver and react-native-svg (no native module, so it ships over the air), never
 * touchable.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { SvgXml } from "react-native-svg";

import { ART } from "../practice/art/svgs";
import { batPlan, type Bat } from "../../lib/season";

interface Props {
  /** Plays once when this turns true (and the box has been measured). */
  run: boolean;
  /** The sky's seed: the same flight every time on one screen. */
  seed?: number;
  /** The bats' colour: the palette's `bat` (pale on Night, slate on Day). */
  color: string;
  /** Where the sky is: absolutely positioned by the caller, e.g. the top third of Home. */
  style?: StyleProp<ViewStyle>;
}

export function Bats({ run, seed = 13, color, style }: Props) {
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
      {box && run ? <Flight w={box.w} h={box.h} seed={seed} color={color} onDone={() => setDone(true)} /> : null}
    </View>
  );
}

function Flight({ w, h, seed, color, onDone }: { w: number; h: number; seed: number; color: string; onDone: () => void }) {
  const plan = useMemo(() => batPlan(seed, h), [seed, h]);
  const t = useRef(plan.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const all = Animated.parallel(
      plan.map((b, i) =>
        Animated.timing(t[i]!, {
          toValue: 1,
          duration: b.duration * 1000,
          delay: b.delay * 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ),
    );
    all.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => all.stop();
    // Plays once per mount: the plan never changes under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {plan.map((b, i) => (
        <BatView key={i} b={b} t={t[i]!} w={w} color={color} />
      ))}
    </>
  );
}

/** The wing beat as two frames, open and folded, over the whole crossing (a stepped interpolation). */
function flapRange(flaps: number): { inputRange: number[]; outputRange: number[] } {
  const frames = flaps * 2;
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (let k = 0; k < frames; k++) {
    const open = k % 2 === 0 ? 1 : 0.55;
    inputRange.push(k / frames, (k + 1) / frames - 0.0005);
    outputRange.push(open, open);
  }
  inputRange.push(1);
  outputRange.push(outputRange[outputRange.length - 1]!);
  return { inputRange, outputRange };
}

function BatView({ b, t, w, color }: { b: Bat; t: Animated.Value; w: number; color: string }) {
  const height = b.size / 2;
  const from = b.dir > 0 ? -b.size : w;
  const to = b.dir > 0 ? w : -b.size;
  const flap = useMemo(() => flapRange(b.flaps), [b.flaps]);
  const style = {
    left: 0,
    top: b.y - height / 2,
    width: b.size,
    height,
    opacity: t.interpolate({ inputRange: [0, 0.08, 0.9, 1], outputRange: [0, b.opacity, b.opacity, 0] }),
    transform: [
      { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) },
      // One arc across: up (or down) to the middle, then most of the way back.
      { translateY: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, b.rise, b.rise * 0.3] }) },
      { rotate: `${b.tilt * b.dir}deg` },
      { scaleY: t.interpolate(flap) },
    ],
  };
  return (
    <Animated.View style={[styles.bat, style]}>
      <SvgXml xml={ART.bat} width={b.size} height={height} color={color} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sky: { position: "absolute", overflow: "hidden" },
  bat: { position: "absolute" },
});
