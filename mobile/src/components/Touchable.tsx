import React from "react";
import {
  Pressable,
  StyleSheet,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type AccessibilityRole,
  type AccessibilityState,
  type Insets,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { motion } from "../design/theme";
import { useColors } from "../lib/theme";
import * as haptics from "../lib/haptics";
import type { HapticKind } from "../lib/haptics";

/**
 * The press primitive. Replaces `TouchableOpacity activeOpacity={0.85}` — a flat
 * fade with no scale, no ripple and no haptic — everywhere a control is tapped.
 *
 * Three things happen on press-in: a spring scale on the UI thread, a native Android
 * ripple, and a haptic tick. All three fire on **press-in, not press**: on press is
 * too late to feel connected to the finger, and feedback should still land when the
 * gesture is later cancelled by a scroll — the point is confirming the touch
 * registered, which is true either way.
 *
 * ── Why Reanimated here and RN `Animated` in `Button.tsx` ─────────────────────
 * Reanimated runs the spring on the UI thread, so it holds up while the JS thread is
 * busy — and in this app it frequently is: the synth, the level meter and the job
 * poll all live there. It was already a dependency (correctly configured, and until
 * now imported only by dead code), so this costs nothing new. `Button.tsx` keeps its
 * existing RN `Animated` spring: it works, and re-engining it would be a refactor
 * for its own sake.
 *
 * ── Why one animated Pressable and not a wrapper view ─────────────────────────
 * The obvious shape is `Animated.View` wrapping a `Pressable`, which is what
 * `Button.tsx` does. It does not generalise: call sites pass layout styles like
 * `flex: 1` (the tab items) and the wrapper would consume the flex while the inner
 * Pressable shrank to its content, quietly losing the full-width tap target. One
 * animated Pressable takes the caller's style directly, so the touch target is
 * exactly the styled box — and it spares a view per row in the lists.
 */

/** `Pressable` that accepts an animated style. Created once, at module scope. */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /**
   * Extra press-in work, run alongside the spring and the haptic. For a control that
   * paints its own press effect — Home's mic fires a ring from here — because
   * press-in is the moment that reads as connected to the finger, not press.
   */
  onPressIn?: () => void;
  /**
   * The matching release. Paired with `onPressIn` for a control whose press has a
   * *duration* rather than a moment — the piano's keys, where how long a key is
   * held is the note's length.
   */
  onPressOut?: () => void;
  disabled?: boolean;
  /**
   * How far to press in. Defaults to `motion.scale.default` (0.97); use
   * `motion.scale.large` for big circular targets and `motion.scale.row` for
   * full-bleed rows, which reveal the canvas down both edges if they move further.
   */
  scaleTo?: number;
  /** Defaults to a light tick. `"none"` opts out where a buzz would be noise. */
  haptic?: HapticKind;
  /**
   * Android ripple. `"borderless"` draws the unbounded circular ripple that is the
   * platform idiom for bare icon buttons; `false` turns it off for a control that
   * paints its own press state.
   */
  ripple?: boolean | "borderless";
  /**
   * Clips the view — and so the ripple — to this corner radius. Pass it whenever the
   * child has rounded corners, or the ripple paints square over them. Leave it unset
   * when the child casts a shadow: the clip would cut the shadow off.
   */
  radius?: number;
  style?: StyleProp<ViewStyle>;
  /** One number for every side, or per side where a neighbour sits closer on one of them. */
  hitSlop?: number | Insets;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  /**
   * What else a screen reader can do with this control, as `accessibilityActions`: the way to a control nested
   * inside it (a row's ⋯), which VoiceOver cannot reach on its own.
   */
  accessibilityActions?: readonly AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
}

export function Touchable({
  children,
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  disabled = false,
  scaleTo = motion.scale.default,
  haptic = "light",
  ripple = true,
  radius,
  style,
  hitSlop,
  accessibilityLabel,
  accessibilityRole = "button",
  accessibilityState,
  accessibilityActions,
  onAccessibilityAction,
}: Props) {
  const colors = useColors();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (disabled) return;
    scale.value = withSpring(scaleTo, motion.press);
    haptics.play(haptic);
    onPressIn?.();
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, motion.press);
    // Runs even when disabled turned true mid-press: a key that went away while
    // held still has to be released, or it sustains forever.
    onPressOut?.();
  };

  return (
    <AnimatedPressable
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      // Spread first so a real disabled state always wins over a caller's guess.
      accessibilityState={{ ...accessibilityState, disabled }}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      android_ripple={
        ripple === false
          ? undefined
          : {
              color: colors.accentSoft,
              borderless: ripple === "borderless",
              // Drawn over the child rather than behind it: most call sites wrap a
              // filled Card or circle, and a background ripple would be invisible
              // underneath one.
              foreground: true,
            }
      }
      style={[
        animatedStyle,
        style,
        radius !== undefined && { borderRadius: radius, overflow: "hidden" },
        // Same 0.4 the Button variants use, so disabled reads the same everywhere.
        disabled && styles.disabled,
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}

// Nothing here is palette-dependent — the one colour this component needs is the
// ripple, which is a prop rather than a style — so this stays a plain StyleSheet
// instead of the `makeStyles(palette)` factory the themed components use.
const styles = StyleSheet.create({
  disabled: { opacity: 0.4 },
});
