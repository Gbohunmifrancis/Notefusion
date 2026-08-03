import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { ConfidenceBadge } from '../components/ConfidenceBadge';
import { libraryApi } from '../api/endpoints';
import { useAuth } from '../lib/auth';
import { colors, gradients, radii, spacing, typography } from '../design/theme';
import type { SavedTranscription } from '../api/types';
import type { TabParams } from '../navigation/types';

type Props = BottomTabScreenProps<TabParams, 'Home'>;

/** Landing screen: a warm greeting, the primary "Record" CTA, and recent work. */
export function HomeScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [recent, setRecent] = useState<SavedTranscription[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      libraryApi
        .list()
        .then((all) => active && setRecent(all.slice(0, 3)))
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, []),
  );

  const firstName = user?.fullName?.split(' ')[0] ?? 'there';

  return (
    <Screen>
      <FlatList
        data={recent}
        keyExtractor={(t) => t.id}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <Text style={styles.greeting}>Hi {firstName} 👋</Text>
            <Text style={styles.sub}>What shall we transcribe today?</Text>

            <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate('Record')}>
              <LinearGradient colors={gradients.brand} style={styles.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                <View style={styles.heroIcon}>
                  <Ionicons name="mic" size={30} color={colors.text} />
                </View>
                <View style={styles.heroText}>
                  <Text style={styles.heroTitle}>New transcription</Text>
                  <Text style={styles.heroSub}>Record or hum a melody</Text>
                </View>
                <Ionicons name="arrow-forward-circle" size={30} color={colors.text} />
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.recentHeader}>
              <Text style={styles.sectionTitle}>Recent</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Library')}>
                <Text style={styles.link}>See all</Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Card style={styles.recentCard} padded={false}>
            <View style={styles.recentRow}>
              <View style={styles.noteIcon}>
                <Ionicons name="musical-note" size={20} color={colors.accent} />
              </View>
              <View style={styles.recentInfo}>
                <Text style={styles.recentTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.recentMeta}>
                  {item.key} · {item.tempoBpm} BPM
                </Text>
              </View>
              <ConfidenceBadge value={item.overallConfidence} compact />
            </View>
          </Card>
        )}
        ListEmptyComponent={
          <Card style={styles.empty}>
            <Ionicons name="sparkles-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              Your transcriptions will show up here. Tap “New transcription” to begin.
            </Text>
          </Card>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: { ...typography.display, color: colors.text, marginTop: spacing.sm },
  sub: { ...typography.body, color: colors.textMuted, marginBottom: spacing.xl },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.xl,
    padding: spacing.xl,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: { flex: 1, marginLeft: spacing.lg },
  heroTitle: { ...typography.heading, color: colors.text },
  heroSub: { ...typography.caption, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  sectionTitle: { ...typography.heading, color: colors.text },
  link: { ...typography.label, color: colors.accent },
  recentCard: { marginBottom: spacing.md },
  recentRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  noteIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentInfo: { flex: 1, marginHorizontal: spacing.md },
  recentTitle: { ...typography.label, color: colors.text, fontSize: 15 },
  recentMeta: { ...typography.caption, color: colors.textFaint, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 22,
  },
});
