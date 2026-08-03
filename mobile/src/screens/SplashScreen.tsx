import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, gradients, spacing, typography } from '../design/theme';

/**
 * Branded splash shown while the session is restored — replaces the default,
 * jarring RN loading flash (PRD: no default loading screen). The mark pulses
 * gently so the wait never feels frozen.
 */
export function SplashScreen() {
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.9,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [opacity, scale]);

  return (
    <View style={styles.container}>
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <LinearGradient colors={gradients.brand} style={styles.mark}>
          <Ionicons name="musical-notes" size={48} color={colors.text} />
        </LinearGradient>
      </Animated.View>
      <Animated.Text style={[styles.wordmark, { opacity }]}>NoteFusion</Animated.Text>
      <Animated.Text style={[styles.tagline, { opacity }]}>
        Hear it. See it. Sing it.
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  mark: {
    width: 108,
    height: 108,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { ...typography.display, color: colors.text, marginTop: spacing.xl },
  tagline: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm },
});
