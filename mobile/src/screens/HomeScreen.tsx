import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { ConfidenceBadge } from '../components/ConfidenceBadge';
import { libraryApi } from '../api/endpoints';
import { useAuth } from '../lib/auth';
import { colors, radii, shadow, spacing, typography } from '../design/theme';
import type { SavedTranscription } from '../api/types';
import type { TabParams } from '../navigation/types';

type Props = BottomTabScreenProps<TabParams, 'Home'>;

/** Landing screen: clean minimalist greeting, Shazam listening card CTA, and recent transcriptions. */
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
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerArea}>
            <Text style={styles.greeting}>Hi, {firstName} 👋</Text>
            <Text style={styles.sub}>What are we listening to today?</Text>

            {/* Listening trigger — dark ink hero card with a cyan action circle */}
            <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate('Record')}>
              <View style={styles.shazamCard}>
                <View style={styles.shazamText}>
                  <Text style={styles.shazamTitle}>Tap to Listen & Transcribe</Text>
                  <Text style={styles.shazamSub}>Identify notes and Solfa in real time</Text>
                </View>
                <View style={styles.shazamIconBg}>
                  <Ionicons name="radio" size={24} color={colors.ink} />
                </View>
              </View>
            </TouchableOpacity>

            <View style={styles.recentHeader}>
              <Text style={styles.sectionTitle}>Recent Transcriptions</Text>
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
                <Ionicons name="musical-note" size={20} color={colors.ink} />
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
            <Ionicons name="musical-note-outline" size={28} color={colors.textFaint} />
            <Text style={styles.emptyText}>
              No transcriptions yet. Tap "Tap to Listen & Transcribe" to capture your first melody.
            </Text>
          </Card>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerArea: { paddingTop: spacing.xs },
  listContent: { paddingBottom: 120 },
  greeting: { ...typography.display, color: colors.text, fontSize: 30 },
  sub: { ...typography.body, color: colors.textMuted, marginTop: 4, marginBottom: spacing.xl },
  shazamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.xl,
    padding: spacing.xl,
    ...shadow.glow,
  },
  shazamIconBg: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shazamText: { flex: 1, marginRight: spacing.lg },
  shazamTitle: { ...typography.heading, color: colors.onInk, fontSize: 17 },
  shazamSub: { ...typography.caption, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  sectionTitle: { ...typography.heading, color: colors.text, fontSize: 18 },
  link: { ...typography.label, color: colors.accent, fontSize: 14 },
  recentCard: { marginBottom: spacing.sm },
  recentRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  noteIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
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
    lineHeight: 20,
    fontSize: 14,
  },
});
