/**
 * Confetti — Playful's burst for three stars, a level or a sticker: a couple of dozen paper bits from the Practice art
 * (quavers, sharps, flats, sparkles, ribbons) flung out from the middle and falling away in about a second. Core
 * `Animated` only (no native module), on the native driver, never touchable. Nothing at all when the system asks for
 * reduced motion: the stars say it.
 */

import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

import { CONFETTI_ART } from "../../lib/practiceTrack";
import { Art } from "./Art";

const PIECES = 24;
const DURATION_MS = 1300;

interface Piece {
  dx: number;
  dy: number;
  spin: number;
  size: number;
}

/** Fixed per index, so a burst looks scattered without a random number in render. */
function layout(): Piece[] {
  return Array.from({ length: PIECES }, (_, i) => {
    const angle = (i / PIECES) * Math.PI * 2 + ((i * 37) % 11) / 20;
    const reach = 90 + ((i * 53) % 70);
    return {
      dx: Math.cos(angle) * reach,
      dy: Math.sin(angle) * reach * 0.8 - 40,
      spin: ((i * 97) % 720) - 360,
      size: 14 + ((i * 7) % 9),
    };
  });
}

/** Fires once each time `burst` changes to a new number above 0. */
export function Confetti({ burst, reduceMotion }: { burst: number; reduceMotion: boolean }) {
  const t = useRef(new Animated.Value(0)).current;
  const pieces = useMemo(layout, []);

  useEffect(() => {
    if (burst <= 0 || reduceMotion) return;
    t.setValue(0);
    const run = Animated.timing(t, { toValue: 1, duration: DURATION_MS, easing: Easing.out(Easing.quad), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [burst, reduceMotion, t]);

  if (burst <= 0 || reduceMotion) return null;

  return (
    <View pointerEvents="none" style={styles.layer} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={[
            styles.piece,
            {
              opacity: t.interpolate({ inputRange: [0, 0.1, 0.75, 1], outputRange: [0, 1, 1, 0] }),
              transform: [
                { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] }) },
                // Out, then falling: the last stretch drops further than it rose.
                { translateY: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, p.dy, p.dy + 140] }) },
                { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${p.spin}deg`] }) },
              ],
            },
          ]}
        >
          <Art name={CONFETTI_ART[i % CONFETTI_ART.length]!} width={p.size} />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", left: 0, right: 0, top: "38%", alignItems: "center" },
  piece: { position: "absolute" },
});
