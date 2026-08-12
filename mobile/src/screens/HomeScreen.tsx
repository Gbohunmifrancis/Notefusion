import React, { useCallback, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { ConfidenceBadge } from '../components/ConfidenceBadge';
import { libraryApi } from '../api/endpoints';
import { toApiError } from '../api/client';
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const styles = useThemedStyles(makeStyles);
  const colors = useColors();

  // A failed fetch must not read as an empty library — that tells the user their
  // work is gone. Surface it as an error the Recent list shows with a retry, and
  // keep whatever we last loaded on screen.
  const reload = useCallback(() => {
    libraryApi
      .list()
      .then((all) => {
        setRecent(all.slice(0, 3));
        setLoadError(null);
      })
      .catch((e) => setLoadError(toApiError(e).message));
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      libraryApi
        .list()
        .then((all) => {
          if (!active) return;
          setRecent(all.slice(0, 3));
          setLoadError(null);
        })
        .catch((e) => {
          if (active) setLoadError(toApiError(e).message);
        });
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
                <Text style={styles.recordSub}>Live capture, transcribed to solfa</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Quick action row */}
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
          loadError ? (
            <Card style={styles.empty}>
              <Ionicons name="cloud-offline-outline" size={30} color={colors.danger} />
              <Text style={styles.emptyText}>{loadError}</Text>
              <TouchableOpacity onPress={reload} style={styles.retryBtn}>
                <Text style={styles.retryLabel}>Try again</Text>
              </TouchableOpacity>
            </Card>
          ) : (
            <Card style={styles.empty}>
              <Image source={appIcons.songbook} style={styles.emptyIcon} />
              <Text style={styles.emptyText}>
                No transcriptions yet. Tap "Tap to start recording" to capture your first melody.
              </Text>
            </Card>
          )
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
    retryBtn: {
      marginTop: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radii.pill,
      backgroundColor: c.accentSoft,
    },
    retryLabel: { ...typography.label, color: c.accent, fontSize: 14 },
  });
