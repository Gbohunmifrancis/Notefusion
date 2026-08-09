import React, { useCallback, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { ConfidenceBadge } from '../components/ConfidenceBadge';
import { libraryApi } from '../api/endpoints';
import { useAuth } from '../lib/auth';
import { radii, spacing, typography, gradients, type Palette, type Shadows } from '../design/theme';
import { useThemedStyles, useColors } from '../lib/theme';
import { appIcons } from '../design/icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { SavedTranscription } from '../api/types';
import type { TabParams } from '../navigation/types';

type Props = BottomTabScreenProps<TabParams, 'Home'>;

/** Landing screen: clean minimalist greeting, Shazam listening card CTA, and recent transcriptions. */
export function HomeScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [recent, setRecent] = useState<SavedTranscription[]>([]);
  const styles = useThemedStyles(makeStyles);
  const colors = useColors();

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
            <Text style={styles.greeting}>Good morning, {firstName} 🎵</Text>
            <Text style={styles.sub}>What will you transcribe today?</Text>

            {/* Hero record CTA — centred mic ring on a gradient card */}
            <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate('Record')}>
              <LinearGradient colors={gradients.brand} style={styles.recordCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                <View style={styles.micRing}>
                  <Ionicons name="mic" size={36} color="#fff" />
                </View>
                <Text style={styles.recordTitle}>Tap to start recording</Text>
                <Text style={styles.recordSub}>or import audio file</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Quick action row */}
            <View style={styles.quickRow}>
              <TouchableOpacity style={styles.quickBtn}>
                <Ionicons name="folder-open-outline" size={20} color={colors.accent} />
                <Text style={styles.quickLabel}>Import</Text>
              </TouchableOpacity>
              <View style={styles.quickDivider} />
              <TouchableOpacity style={styles.quickBtn}>
                <Ionicons name="link-outline" size={20} color={colors.accent} />
                <Text style={styles.quickLabel}>Paste URL</Text>
              </TouchableOpacity>
            </View>

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
                <Image source={appIcons.music} style={styles.noteIconImg} />
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
            <Image source={appIcons.songbook} style={styles.emptyIcon} />
            <Text style={styles.emptyText}>
              No transcriptions yet. Tap "Tap to Listen & Transcribe" to capture your first melody.
            </Text>
          </Card>
        }
      />
    </Screen>
  );
}

const makeStyles = (c: Palette, s: Shadows) =>
  StyleSheet.create({
    headerArea: { paddingTop: spacing.xs },
    listContent: { paddingBottom: 120 },

    greeting: { ...typography.display, color: c.text, fontSize: 26 },
    sub: { ...typography.body, color: c.textMuted, marginTop: 4, marginBottom: spacing.xl },

    // ── Hero record card ──────────────────────────────────────────────────────
    recordCard: {
      borderRadius: radii.xl,
      paddingVertical: spacing.xxl,
      alignItems: 'center',
      ...s.glow,
    },
    micRing: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: 'rgba(255,255,255,0.22)',
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg,
    },
    recordTitle: {
      ...typography.heading,
      color: '#fff',
      fontSize: 17,
    },
    recordSub: {
      ...typography.caption,
      color: 'rgba(255,255,255,0.72)',
      marginTop: spacing.xs,
    },

    // ── Quick actions ─────────────────────────────────────────────────────────
    quickRow: {
      flexDirection: 'row',
      marginTop: spacing.lg,
      backgroundColor: c.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
    },
    quickBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md,
    },
    quickDivider: {
      width: 1,
      backgroundColor: c.border,
      marginVertical: spacing.sm,
    },
    quickLabel: {
      ...typography.label,
      color: c.accent,
      fontSize: 14,
    },

    // ── Recent section ────────────────────────────────────────────────────────
    recentHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: spacing.xxl,
      marginBottom: spacing.md,
    },
    sectionTitle: { ...typography.heading, color: c.text, fontSize: 18 },
    link: { ...typography.label, color: c.accent, fontSize: 14 },
    recentCard: { marginBottom: spacing.sm },
    recentRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
    noteIcon: {
      width: 40,
      height: 40,
      borderRadius: radii.md,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    noteIconImg: { width: 24, height: 24 },
    recentInfo: { flex: 1, marginHorizontal: spacing.md },
    recentTitle: { ...typography.label, color: c.text, fontSize: 15 },
    recentMeta: { ...typography.caption, color: c.textFaint, marginTop: 2 },
    empty: { alignItems: 'center', paddingVertical: spacing.xxl },
    emptyIcon: { width: 30, height: 30 },
    emptyText: {
      ...typography.body,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: spacing.md,
      lineHeight: 20,
      fontSize: 14,
    },
  });
