import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  type DimensionValue,
  type StyleProp,
  View,
  type ViewStyle,
} from "react-native";
import { radii, spacing } from "../design/theme";
import { useColors } from "../lib/theme";

interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Base animated skeleton element.
 * Pulses gently between 0.35 and 0.85 opacity using the native driver for 60fps performance.
 */
export function Skeleton({
  width = "100%",
  height = 16,
  radius = radii.md,
  style,
}: SkeletonProps) {
  const colors = useColors();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.85,
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: colors.surfaceAlt,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

/**
 * Skeleton placeholder for a single transcription item row (in Library or Home Recent).
 */
export function TranscriptionRowSkeleton() {
  const colors = useColors();

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      {/* Icon badge */}
      <Skeleton width={44} height={44} radius={radii.md} />

      {/* Info column */}
      <View style={styles.infoCol}>
        <Skeleton width="65%" height={15} radius={radii.sm} style={styles.titleLine} />
        <Skeleton width="40%" height={12} radius={radii.sm} />
      </View>

      {/* Pill badge or chevron placeholder */}
      <Skeleton width={56} height={22} radius={radii.pill} />
    </View>
  );
}

/**
 * Skeleton placeholder for a subscription plan card in UpgradeScreen.
 */
export function PlanCardSkeleton() {
  const colors = useColors();

  return (
    <View
      style={[
        styles.planCard,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.planHeader}>
        <View style={styles.infoCol}>
          <Skeleton width="45%" height={18} radius={radii.sm} style={styles.titleLine} />
          <Skeleton width="75%" height={13} radius={radii.sm} />
        </View>
        <Skeleton width={24} height={24} radius={12} />
      </View>
      <View style={styles.planPriceRow}>
        <Skeleton width="35%" height={24} radius={radii.sm} />
        <Skeleton width={70} height={22} radius={radii.pill} />
      </View>
    </View>
  );
}

/**
 * Skeleton placeholder for the ProfileScreen header.
 */
export function ProfileHeaderSkeleton() {
  return (
    <View style={styles.profileHeader}>
      <Skeleton width={104} height={104} radius={52} style={styles.avatarSkeleton} />
      <Skeleton width={160} height={20} radius={radii.sm} style={styles.titleLine} />
      <Skeleton width={190} height={13} radius={radii.sm} style={styles.titleLine} />
      <Skeleton width={90} height={24} radius={radii.pill} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  infoCol: {
    flex: 1,
    justifyContent: "center",
  },
  titleLine: {
    marginBottom: 6,
  },
  planCard: {
    padding: spacing.lg,
    borderRadius: radii.xl,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  planHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  planPriceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.xs,
  },
  profileHeader: {
    alignItems: "center",
    paddingVertical: spacing.lg,
  },
  avatarSkeleton: {
    marginBottom: spacing.md,
  },
});
