/**
 * The unit as a winding path (the game-coloured Practice, as the web's `pathView`): its banner in the grade's colour,
 * then a stop for each drill snaking down — done ones ticked, the one to sing now with START over it, those ahead
 * locked — and the unit's chest. A tap on START opens the drill (the screen's own main action, the drill card under the
 * path). Playful's Doh stands beside START, on the side with room (`dohSide`): the drill card's Doh steps aside then.
 * The pulse and the bob are still under Reduce Motion.
 */

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { Icon } from "../Icon";
import { Touchable } from "../Touchable";
import { Chest } from "./GameGlyphs";
import type { Drill } from "../../api/types";
import { gameColorsFor } from "../../design/gameColors";
import { fonts, motion, spacing, type Palette } from "../../design/theme";
import { useTheme, useThemedStyles } from "../../lib/theme";
import { dohSide, unitBanner, type PathStop } from "../../lib/practiceArcade";

const STOP = { w: 68, h: 62 } as const;
const NOW = { w: 78, h: 70 } as const;
/** The ring round the stop to sing, and the gap inside it. */
const RING = 4;
const RING_GAP = 5;
const LIP = 6;
const DOH_GAP = 10;

export function PathMap({
  drill,
  stops,
  doh,
  startLabel,
  onStart,
}: {
  drill: Drill;
  stops: PathStop[];
  /** Playful's Doh, drawn beside START; null leaves him in the drill card (or off screen for one Doh). */
  doh: React.ReactNode | null;
  /** What START does, read out: "Sing it", "Continue", "Done for today". */
  startLabel: string;
  onStart: () => void;
}) {
  const { mode, palette: c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const g = gameColorsFor(mode);
  const banner = unitBanner(drill);
  const tone = g.tones[banner?.tone ?? "blue"];

  const pulse = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0);
      bob.setValue(0);
      return;
    }
    const loops = [
      Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1800, useNativeDriver: true })),
      Animated.loop(
        Animated.sequence([
          Animated.timing(bob, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(bob, { toValue: 0, duration: 800, useNativeDriver: true }),
        ]),
      ),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [bob, pulse, reduceMotion]);

  return (
    <View style={styles.wrap}>
      {banner ? (
        <View
          style={[styles.banner, { backgroundColor: tone.fill, borderBottomColor: tone.lip }]}
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${banner.eyebrow}: ${banner.title}. Drill ${drill.drillIndex} of ${drill.drillCount}.`}
        >
          <View style={styles.bannerText}>
            <Text style={[styles.eyebrow, { color: tone.ink }]} numberOfLines={1}>{banner.eyebrow}</Text>
            <Text style={[styles.bannerTitle, { color: tone.ink }]} numberOfLines={2}>{banner.title}</Text>
          </View>
          {banner.mastery ? (
            <View style={styles.badge}>
              <Text style={[styles.badgeText, { color: tone.ink }]}>∞</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.road}>
        {stops.map((stop) => {
          const shift = { transform: [{ translateX: stop.offset }] };
          if (stop.kind === "current") {
            const outer = { w: NOW.w + (RING + RING_GAP) * 2, h: NOW.h + LIP + (RING + RING_GAP) * 2 };
            const side = dohSide(stop.offset);
            return (
              <View key={stop.index} style={[styles.nowWrap, shift]}>
                <Animated.View
                  style={[
                    styles.start,
                    { borderColor: c.border, transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }] },
                  ]}
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                >
                  <Text style={[styles.startText, { color: mode === "dark" ? tone.fill : tone.lip }]}>START</Text>
                </Animated.View>
                <View style={{ width: outer.w, height: outer.h, alignItems: "center", justifyContent: "center" }}>
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.ring,
                      {
                        width: outer.w,
                        height: outer.h,
                        borderRadius: outer.w / 2,
                        borderColor: tone.fill,
                        opacity: reduceMotion ? 1 : pulse.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0.35, 1] }),
                      },
                    ]}
                  />
                  <Touchable
                    onPress={onStart}
                    scaleTo={motion.scale.large}
                    haptic="medium"
                    radius={NOW.w / 2}
                    accessibilityRole="button"
                    accessibilityLabel={`${startLabel}: drill ${drill.drillIndex} of ${drill.drillCount}, ${drill.title}`}
                  >
                    <View style={[styles.stop, { width: NOW.w, height: NOW.h + LIP, borderRadius: NOW.w / 2, backgroundColor: tone.fill, borderBottomColor: tone.lip }]}>
                      <Icon name="mic" size={30} strokeWidth={2.4} color={tone.ink} />
                    </View>
                  </Touchable>
                </View>
                {doh ? (
                  <View pointerEvents="none" style={[styles.doh, side === "left" ? { right: outer.w + DOH_GAP } : { left: outer.w + DOH_GAP }]}>
                    {doh}
                  </View>
                ) : null}
              </View>
            );
          }
          if (stop.kind === "chest") {
            return (
              <View key={stop.index} style={[styles.chestStop, shift]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <Chest open={false} width={52} color={g.locked.ink} />
              </View>
            );
          }
          const done = stop.kind === "done";
          const fill = done ? tone : g.locked;
          return (
            <View
              key={stop.index}
              style={[styles.stop, shift, { width: STOP.w, height: STOP.h + LIP, borderRadius: STOP.w / 2, backgroundColor: fill.fill, borderBottomColor: fill.lip }]}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              <Icon name={done ? "check" : "lock"} size={26} strokeWidth={2.6} color={fill.ink} />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { marginBottom: spacing.md },
    banner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      paddingVertical: 14,
      paddingHorizontal: spacing.lg,
      borderRadius: 18,
      borderBottomWidth: 5,
    },
    bannerText: { flex: 1, minWidth: 0, gap: 3 },
    eyebrow: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1, opacity: 0.85 },
    bannerTitle: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 24 },
    badge: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.28)" },
    badgeText: { fontFamily: fonts.bold, fontSize: 26 },
    road: { alignItems: "center", gap: 14, paddingTop: spacing.md, paddingBottom: spacing.xs },
    stop: { alignItems: "center", justifyContent: "center", borderBottomWidth: LIP },
    nowWrap: { alignItems: "center", marginTop: 4 },
    ring: { position: "absolute", top: 0, left: 0, borderWidth: RING },
    start: {
      marginBottom: 8,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 2,
      backgroundColor: c.surface,
    },
    startText: { fontFamily: fonts.bold, fontSize: 13, letterSpacing: 1 },
    /** Level with the stop, under START's label. */
    doh: { position: "absolute", bottom: 0, top: 38, justifyContent: "center" },
    chestStop: { paddingTop: 2 },
  });
