import React, { useEffect, useRef } from "react";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

/** A row or card leaving its list: 200 ms ease-out, as everything but Doh moves. */
export const FOLD_MS = 200;

/**
 * Folds its child away when `gone` turns true — the height closes and it fades over 200 ms — then calls `onGone`, so
 * the caller drops it from the list without the rows below jumping (board a-core/11: a deleted recent sheet; Home's
 * Doh card put away with ×).
 */
export function FoldAway({ gone, onGone, children }: { gone: boolean; onGone: () => void; children: React.ReactNode }) {
  const height = useSharedValue<number | null>(null);
  const shown = useSharedValue(1);
  const measured = useRef(0);
  const done = useRef(onGone);
  done.current = onGone;

  useEffect(() => {
    if (!gone) return;
    height.value = measured.current;
    const easing = Easing.out(Easing.quad);
    height.value = withTiming(0, { duration: FOLD_MS, easing });
    shown.value = withTiming(0, { duration: FOLD_MS, easing });
    const timer = setTimeout(() => done.current(), FOLD_MS);
    return () => clearTimeout(timer);
  }, [gone, height, shown]);

  const style = useAnimatedStyle(() =>
    height.value === null ? { opacity: shown.value } : { height: height.value, opacity: shown.value, overflow: "hidden" as const },
  );

  return (
    <Animated.View
      style={style}
      onLayout={(e) => {
        if (!gone) measured.current = e.nativeEvent.layout.height;
      }}
    >
      {children}
    </Animated.View>
  );
}
