import React, { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing, typography } from '../design/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

/**
 * Minimalist responsive button component.
 * Features tactile spring scaling on press and clean solid contrast colors.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  style,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const isDisabled = disabled || loading;

  const animate = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

  const getTextColor = () => {
    if (variant === 'primary') return colors.onInk;
    if (variant === 'danger') return colors.danger;
    return colors.text;
  };

  const getIconColor = () => {
    if (variant === 'primary') return colors.onInk;
    if (variant === 'danger') return colors.danger;
    return colors.ink;
  };

  const content = (
    <>
      {loading ? (
        <ActivityIndicator color={getTextColor()} />
      ) : (
        <>
          {icon && (
            <Ionicons
              name={icon}
              size={18}
              color={getIconColor()}
              style={styles.icon}
            />
          )}
          <Text style={[styles.label, { color: getTextColor() }]}>
            {label}
          </Text>
        </>
      )}
    </>
  );

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style, isDisabled && styles.disabled]}>
      <Pressable
        onPress={isDisabled ? undefined : onPress}
        onPressIn={() => !isDisabled && animate(0.97)}
        onPressOut={() => animate(1)}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
      >
        <Animated.View
          style={[
            styles.base,
            variant === 'primary' && styles.primary,
            variant === 'secondary' && styles.secondary,
            variant === 'ghost' && styles.ghost,
            variant === 'danger' && styles.danger,
          ]}
        >
          {content}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 54,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
  },
  primary: {
    backgroundColor: colors.ink,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  danger: {
    backgroundColor: 'rgba(240, 87, 107, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(240, 87, 107, 0.28)',
  },
  disabled: { opacity: 0.45 },
  label: { ...typography.label, fontSize: 15, fontWeight: '600' },
  icon: { marginRight: spacing.sm },
});
