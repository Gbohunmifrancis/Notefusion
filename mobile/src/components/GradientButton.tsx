import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { gradients, radii, spacing, typography } from "../design/theme";

interface Props {
  label: string;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  /** Override gradient colours — defaults to "The Fusion" (deep blue → bright blue). */
  colors?: readonly [string, string, ...string[]];
}

/**
 * GradientButton — the primary CTA component in the light blue system.
 *
 * Features:
 *  • "The Fusion" gradient (Deep Blue #1D4ED8 → Bright Blue #3B82F6) by default.
 *  • Tactile spring-scale animation via react-native-reanimated (no JS thread).
 *  • Leading icon slot using @expo/vector-icons Ionicons.
 *  • Loading state replaces content with an ActivityIndicator.
 *  • Disabled state fades to 40 % opacity and swallows press events.
 *
 * Usage:
 *   <GradientButton label="Save to Library" icon="bookmark" onPress={save} />
 *   <GradientButton label="Record" colors={['#0EA5E9', '#2563EB']} onPress={start} />
 */
export function GradientButton({
  label,
  onPress,
  icon,
  loading = false,
  disabled = false,
  style,
  colors: customColors,
}: Props) {
  const scale = useSharedValue(1);
  const isDisabled = disabled || loading;

  /** Animated scale style — runs entirely on the UI thread. */
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!isDisabled) {
      scale.value = withSpring(0.96, { damping: 15, stiffness: 300 });
    }
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  const gradientColors = customColors ?? gradients.brand;

  return (
    <Animated.View
      style={[animatedStyle, style, isDisabled && styles.disabled]}
    >
      {/* overflow:hidden clips the gradient to the pill radius on Android */}
      <Pressable
        onPress={isDisabled ? undefined : onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        style={styles.pressable}
      >
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.gradient}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              {icon && (
                <Ionicons
                  name={icon}
                  size={18}
                  color="#FFFFFF"
                  style={styles.icon}
                />
              )}
              <Text style={styles.label}>{label}</Text>
            </>
          )}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /** Clips LinearGradient to pill border-radius on both platforms. */
  pressable: {
    borderRadius: radii.pill,
    overflow: "hidden",
  },

  gradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 54,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
  },

  label: {
    ...typography.label,
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },

  icon: {
    marginRight: spacing.sm,
  },

  /** Preserves layout while signalling non-interactivity. */
  disabled: {
    opacity: 0.4,
  },
});
