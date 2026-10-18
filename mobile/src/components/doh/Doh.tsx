/**
 * Doh outside Practice: the bird on Home's suggestion card, the result toast and the empty states, with the moves of
 * board c-practice/8c — hop in, blink, a curious head tilt, cheer, and a squish when tapped (timings and the idle
 * schedule in `lib/dohMotion`). Reanimated transforms on the art (translate, scale, rotate about the feet), so it
 * ships over the air; the art and each pose's blink twin come from design/practice-art.
 *
 * At most one Doh is on a screen (the card, the toast and the empty states live on different screens, and the
 * Practice tab keeps its own). Idle moves stop after 30 s and while `active` is false (the screen is away, or a
 * recording or the player is running). With Reduce Motion, Doh fades in and keeps still. Doh is never the only way to
 * do something: tapping it is a bonus.
 */

import React, { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Art } from "../practice/Art";
import type { ArtName } from "../practice/art/svgs";
import { DOH_MS, idleSchedule } from "../../lib/dohMotion";
import * as haptics from "../../lib/haptics";

export type DohPose = "wave" | "sing" | "encourage" | "cheer-notes" | "handoff";
/** How Doh arrives: hops in, cheers (a sheet just arrived), or is simply there. */
export type DohEntrance = "hop" | "cheer" | "none";

/** The poses with open eyes have a blink twin; the happy-eyed ones (sing, cheer, handoff) have nothing to blink. */
const BLINK: Partial<Record<DohPose, ArtName>> = { wave: "doh-wave-blink", encourage: "doh-encourage-blink" };

interface Props {
  pose: DohPose;
  size: number;
  entrance?: DohEntrance;
  /** Blink and tilt now and then, for 30 s. */
  idle?: boolean;
  /** False pauses the idle moves: the screen is away, or recording or playing. */
  active?: boolean;
  /** Tapping Doh (squish, a light tick, then this): the empty states' tips. Without it Doh is decorative. */
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

const ease = Easing.out(Easing.quad);
const t = (to: number, duration: number, easing = ease) => withTiming(to, { duration, easing });

export function Doh({ pose, size, entrance = "hop", idle = true, active = true, onPress, accessibilityLabel, style }: Props) {
  const reduce = useReducedMotion();
  const twin = BLINK[pose];

  const y = useSharedValue(0);
  const sx = useSharedValue(1);
  const sy = useSharedValue(1);
  const rot = useSharedValue(0);
  const shown = useSharedValue(entrance === "none" ? 1 : 0);
  const shut = useSharedValue(0);

  // ── Entrance, once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (entrance === "none") return;
    if (reduce) {
      // The one move left with Reduce Motion on; Reanimated would otherwise skip it to the end.
      shown.value = withTiming(1, { duration: DOH_MS.fade, easing: ease, reduceMotion: ReduceMotion.Never });
      return;
    }
    shown.value = t(1, 120);
    if (entrance === "hop") {
      // Below the edge → springs up, stretched (120) → top of the hop (260) → lands, a soft squash (380) → settles (480).
      y.value = size * 0.5;
      y.value = withSequence(t(-size * 0.08, 120), t(-size * 0.12, 140, Easing.out(Easing.sin)), t(0, 120, Easing.in(Easing.quad)), t(0, 100));
      sy.value = withSequence(t(1.08, 120), t(1, 140), t(0.92, 120), t(1, 100));
      sx.value = withSequence(t(0.94, 120), t(1, 140), t(1.06, 120), t(1, 100));
    } else {
      // A small nod (140) → hops, wings up (300) → lands (520).
      rot.value = withSequence(t(-5, 140), t(0, 160), t(0, 220));
      y.value = withSequence(t(size * 0.02, 140), t(-size * 0.12, 160), t(0, 120, Easing.in(Easing.quad)), t(0, 100));
      sy.value = withSequence(t(0.96, 140), t(1.06, 160), t(0.95, 120), t(1, 100));
      sx.value = withSequence(t(1.03, 140), t(0.96, 160), t(1.04, 120), t(1, 100));
    }
    // Played once, as Doh first appears; the values are made once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Idle: blinks and the odd tilt, for 30 s while on screen ───────────────
  useEffect(() => {
    if (!idle || !active || reduce) return;
    const blink = (delay = 0) => {
      if (!twin) return;
      shut.value = withDelay(delay, withSequence(t(1, 20), withDelay(DOH_MS.blink - 40, t(0, 20))));
    };
    // Let the entrance land before the first move is counted.
    const settle = entrance === "none" ? 0 : DOH_MS.hop;
    const timers = idleSchedule(Math.random, true).map(({ at, move }) =>
      setTimeout(() => {
        if (move === "blink") return blink();
        // Leans 9° toward the words, holds with one blink, comes back upright.
        rot.value = withSequence(
          t(9, DOH_MS.tiltIn, Easing.inOut(Easing.quad)),
          withDelay(DOH_MS.tiltHold, t(0, DOH_MS.tiltOut, Easing.inOut(Easing.quad))),
        );
        blink(DOH_MS.tiltBlinkAt);
      }, settle + at),
    );
    return () => {
      timers.forEach(clearTimeout);
      cancelAnimation(shut);
      shut.value = 0;
      if (rot.value !== 0) rot.value = t(0, DOH_MS.tiltOut);
    };
  }, [idle, active, reduce, twin, entrance, rot, shut]);

  const tapping = useRef(false);
  function press() {
    if (!onPress) return;
    haptics.play("light");
    if (!reduce && !tapping.current) {
      // Squish (100) → bounces back (220) → settles (300).
      tapping.current = true;
      sy.value = withSequence(t(0.88, 100), t(1.05, 120), t(1, 80));
      sx.value = withSequence(t(1.1, 100), t(0.97, 120), t(1, 80));
      y.value = withSequence(t(0, 100), t(-4, 120), t(0, 80));
      setTimeout(() => {
        tapping.current = false;
      }, DOH_MS.tap);
    }
    onPress();
  }

  const body = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: y.value }, { rotate: `${rot.value}deg` }, { scaleX: sx.value }, { scaleY: sy.value }],
  }));
  const blinkStyle = useAnimatedStyle(() => ({ opacity: shut.value }));

  const figure = (
    <Animated.View style={[styles.feet, { width: size, height: size }, body]}>
      <Art name={`doh-${pose}` as ArtName} width={size} height={size} />
      {twin ? (
        <Animated.View style={[StyleSheet.absoluteFill, blinkStyle]} pointerEvents="none">
          <Art name={twin} width={size} height={size} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );

  if (!onPress) {
    return (
      <View style={style} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
        {figure}
      </View>
    );
  }
  return (
    <Pressable
      onPress={press}
      style={style}
      hitSlop={size < 44 ? (44 - size) / 2 : 0}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? "Doh: tap for a tip"}
    >
      {figure}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /** Every move turns and squashes about the feet (y ≈ 188 of the 200 viewBox). */
  feet: {
    transformOrigin: "50% 94%",
  },
});
