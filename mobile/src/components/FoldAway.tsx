import React, { useCallback, useEffect, useRef } from "react";
import { View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

/** A row or card leaving its list: 200 ms ease-out, as everything but Doh moves. */
export const FOLD_MS = 200;
/** Reduce Motion: it only fades, and the rows around it do not slide. */
const REDUCED_MS = 150;

/**
 * Folds its child away when `gone` turns true — the height closes and it fades over 200 ms — then calls `onGone`, so
 * the caller drops it from the list without the rows below jumping (board a-core/11: a deleted recent sheet; Home's
 * Doh card put away with ×). When `gone` turns false again before then, or the child comes back with `appear` (Undo
 * after a held delete, board m-ux-medium P2a), it unfolds where it was. Reduce Motion: a 150 ms fade, no folding.
 */
export function FoldAway({
  gone,
  onGone,
  appear = false,
  children,
}: {
  gone: boolean;
  onGone: () => void;
  /** Arrives folded and unfolds (a row put back by Undo). */
  appear?: boolean;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const height = useSharedValue<number | null>(appear && !reduce ? 0 : null);
  const shown = useSharedValue(appear ? 0 : 1);
  /** The child's own height, measured inside the fold so it is known while folded too. */
  const measured = useRef(0);
  /** Folded (or folding): the next `gone={false}` unfolds it. */
  const closed = useRef(appear);
  /** Asked to unfold before it was measured: it unfolds on its first layout. */
  const waitingToOpen = useRef(false);
  const isGone = useRef(gone);
  isGone.current = gone;
  const done = useRef(onGone);
  done.current = onGone;

  const open = useCallback(() => {
    if (!reduce && measured.current === 0) {
      waitingToOpen.current = true;
      return;
    }
    closed.current = false;
    waitingToOpen.current = false;
    if (reduce) {
      height.value = null;
      shown.value = withTiming(1, { duration: REDUCED_MS });
      return;
    }
    const easing = Easing.out(Easing.quad);
    height.value = withTiming(measured.current, { duration: FOLD_MS, easing }, (finished) => {
      if (finished) height.value = null;
    });
    shown.value = withTiming(1, { duration: FOLD_MS, easing });
  }, [reduce, height, shown]);

  useEffect(() => {
    if (!gone) {
      if (closed.current) open();
      return;
    }
    closed.current = true;
    waitingToOpen.current = false;
    const ms = reduce ? REDUCED_MS : FOLD_MS;
    const easing = Easing.out(Easing.quad);
    if (!reduce) {
      height.value = measured.current;
      height.value = withTiming(0, { duration: ms, easing });
    }
    shown.value = withTiming(0, { duration: ms, easing });
    const timer = setTimeout(() => done.current(), ms);
    return () => clearTimeout(timer);
    // Runs when it is sent away or called back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone]);

  const style = useAnimatedStyle(() =>
    height.value === null ? { opacity: shown.value } : { height: height.value, opacity: shown.value, overflow: "hidden" as const },
  );

  return (
    <Animated.View style={style}>
      <View
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0) measured.current = h;
          if (waitingToOpen.current && h > 0 && !isGone.current) open();
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}
