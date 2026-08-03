import React from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, spacing } from '../design/theme';

/**
 * Every screen's outer shell: safe-area aware, dark status bar, consistent
 * horizontal padding. `scroll` wraps the content in a ScrollView for form-heavy
 * screens; leave it off for screens that own their own list/scroll.
 */
export function Screen({
  children,
  scroll = false,
  contentStyle,
  edges,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  return (
    <SafeAreaView style={styles.safe} edges={edges ?? ['top', 'bottom']}>
      <StatusBar style="dark" />
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.flex, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  flex: { flex: 1 },
});
