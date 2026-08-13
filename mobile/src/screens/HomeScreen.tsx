import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { BrandMark } from '../components/BrandMark';
import { libraryApi } from '../api/endpoints';
import { toApiError } from '../api/client';
import { useAuth } from '../lib/auth';
import { fonts, radii, spacing, typography, gradients, type Palette, type Shadows } from '../design/theme';
import { useThemedStyles, useColors } from '../lib/theme';
import { appIcons } from '../design/icons';
import type { SavedTranscription } from '../api/types';
import type { TabParams } from '../navigation/types';

type Props = BottomTabScreenProps<TabParams, 'Home'>;

/**
 * HomeScreen — matching the design sheet (Image 3):
 * 1. Top bar: BrandMark + Wordmark + Tagline + Profile Avatar button
 * 2. Hero Card: Deep Blue gradient with 3D Mic icon, "Welcome back!", "+ New Recording" button
 * 3. Recent Recordings: List with duration pill tags, key/solfa meta, date, three dots menu
 * 4. Tools Grid: Record Audio, Import Audio, Key Changer, My Library
 * 5. Backup Promo Card: Light blue card with Cloud icon, "Enable Sync" button, Close button
 */
export function HomeScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [recent, setRecent] = useState<SavedTranscription[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showBackup, setShowBackup] = useState(true);
  const styles = useThemedStyles(makeStyles);
  const colors = useColors();

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
            {/* ── 1. Header Bar: Logo + Profile avatar ───────────────────── */}
            <View style={styles.topHeader}>
              <View style={styles.brandRow}>
                <BrandMark size={42} color={colors.accent} waveColor={colors.accentAlt} showWaves />
                <View style={styles.brandTextWrap}>
                  <Text style={styles.wordmark}>Notefusion</Text>
                  <Text style={styles.tagline}>Hear it. See it. Notate it.</Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => navigation.navigate('Profile')}
                style={styles.avatarBtn}
                accessibilityRole="button"
                accessibilityLabel="Go to profile"
              >
                <Ionicons name="person-outline" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* ── 2. Hero Gradient Banner ─────────────────────────────────── */}
            <LinearGradient
              colors={['#1D4ED8', '#2563EB', '#3B82F6']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroCard}
            >
              <View style={styles.heroLeft}>
                <Text style={styles.heroGreeting}>Good morning,</Text>
                <Text style={styles.heroTitle}>Welcome back!</Text>
                <Text style={styles.heroSub}>
                  Record, transcribe and transform your music in seconds.
                </Text>

                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => navigation.navigate('Record')}
                  style={styles.newRecordBtn}
                >
                  <Ionicons name="add" size={20} color="#2563EB" />
                  <Text style={styles.newRecordText}>New Recording</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.heroRight}>
                <View style={styles.heroMicDisc}>
                  <Ionicons name="mic" size={48} color="#FFFFFF" />
                </View>
              </View>
            </LinearGradient>

            {/* ── 3. Recent Recordings Section Header ───────────────────────── */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Recordings</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Library')}>
                <Text style={styles.seeAllLink}>See all</Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Library')}
          >
            <Card style={styles.recentCard} padded={false}>
              <View style={styles.recentRow}>
                <View style={styles.noteIconBadge}>
                  <Ionicons name="document-text-outline" size={22} color={colors.accent} />
                </View>

                <View style={styles.recentInfo}>
                  <Text style={styles.recentTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.recentMeta}>
                    Tonic Solfa · {item.key} Major
                  </Text>
                  <Text style={styles.recentDate}>
                    📅 {new Date(item.createdAtUtc).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </View>

                <View style={styles.recentRight}>
                  <View style={styles.durationPill}>
                    <Text style={styles.durationText}>02:45</Text>
                  </View>
                  <TouchableOpacity hitSlop={8} style={styles.moreBtn}>
                    <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
            </Card>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          loadError ? (
            <Card style={styles.emptyCard}>
              <Ionicons name="cloud-offline-outline" size={30} color={colors.danger} />
              <Text style={styles.emptyText}>{loadError}</Text>
              <TouchableOpacity onPress={reload} style={styles.retryBtn}>
                <Text style={styles.retryLabel}>Try again</Text>
              </TouchableOpacity>
            </Card>
          ) : (
            <Card style={styles.emptyCard}>
              <Image source={appIcons.songbook} style={styles.emptyIcon} />
              <Text style={styles.emptyText}>
                No recordings yet. Tap "+ New Recording" to capture your first melody.
              </Text>
            </Card>
          )
        }
        ListFooterComponent={
          <View style={styles.footerArea}>
            {/* ── 4. Tools Grid ────────────────────────────────────────────── */}
            <Text style={[styles.sectionTitle, styles.toolsTitle]}>Tools</Text>
            <View style={styles.toolsGrid}>
              <TouchableOpacity
                style={styles.toolCard}
                onPress={() => navigation.navigate('Record')}
              >
                <View style={styles.toolIconWrap}>
                  <Ionicons name="mic-outline" size={24} color="#2563EB" />
                </View>
                <Text style={styles.toolLabel}>Record Audio</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.toolCard}
                onPress={() => navigation.navigate('Record')}
              >
                <View style={styles.toolIconWrap}>
                  <Ionicons name="musical-notes-outline" size={24} color="#2563EB" />
                </View>
                <Text style={styles.toolLabel}>Import Audio</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.toolCard}
                onPress={() => navigation.navigate('Library')}
              >
                <View style={styles.toolIconWrap}>
                  <Ionicons name="options-outline" size={24} color="#2563EB" />
                </View>
                <Text style={styles.toolLabel}>Key Changer</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.toolCard}
                onPress={() => navigation.navigate('Library')}
              >
                <View style={styles.toolIconWrap}>
                  <Ionicons name="book-outline" size={24} color="#2563EB" />
                </View>
                <Text style={styles.toolLabel}>My Library</Text>
              </TouchableOpacity>
            </View>

            {/* ── 5. Backup Promo Card ─────────────────────────────────────── */}
            {showBackup && (
              <View style={styles.backupCard}>
                <TouchableOpacity
                  style={styles.backupClose}
                  onPress={() => setShowBackup(false)}
                  hitSlop={8}
                >
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </TouchableOpacity>

                <View style={styles.backupRow}>
                  <View style={styles.cloudIconWrap}>
                    <Ionicons name="cloud-upload-outline" size={32} color="#2563EB" />
                  </View>
                  <View style={styles.backupContent}>
                    <Text style={styles.backupTitle}>Backup your library</Text>
                    <Text style={styles.backupSub}>
                      Sync your recordings and notes across all your devices.
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.enableSyncBtn}
                  onPress={() => navigation.navigate('Profile')}
                >
                  <Text style={styles.enableSyncText}>Enable Sync</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        }
      />
    </Screen>
  );
}

const makeStyles = (c: Palette, s: Shadows) =>
  StyleSheet.create({
    headerArea: {
      paddingTop: spacing.xs,
    },
    listContent: {
      paddingBottom: 120,
    },

    // ── Top Header Bar ────────────────────────────────────────────────────────
    topHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    brandTextWrap: {
      justifyContent: 'center',
    },
    wordmark: {
      fontSize: 20,
      fontFamily: fonts.bold,
      color: c.text,
      lineHeight: 24,
    },
    tagline: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: c.textMuted,
    },
    avatarBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // ── Hero Banner ───────────────────────────────────────────────────────────
    heroCard: {
      borderRadius: radii.xl,
      padding: spacing.xl,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.xl,
      ...s.glow,
    },
    heroLeft: {
      flex: 1,
      paddingRight: spacing.md,
    },
    heroGreeting: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: 'rgba(255,255,255,0.85)',
    },
    heroTitle: {
      fontSize: 24,
      fontFamily: fonts.bold,
      color: '#FFFFFF',
      marginTop: 2,
      marginBottom: spacing.xs,
    },
    heroSub: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: 'rgba(255,255,255,0.82)',
      lineHeight: 18,
      marginBottom: spacing.lg,
    },
    newRecordBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: '#FFFFFF',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm + 2,
      borderRadius: radii.pill,
      gap: 4,
    },
    newRecordText: {
      fontSize: 14,
      fontFamily: fonts.bold,
      color: '#2563EB',
    },
    heroRight: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroMicDisc: {
      width: 84,
      height: 84,
      borderRadius: 42,
      backgroundColor: 'rgba(255,255,255,0.20)',
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.40)',
      alignItems: 'center',
      justifyContent: 'center',
    },

    // ── Recent Section ────────────────────────────────────────────────────────
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    sectionTitle: {
      fontSize: 18,
      fontFamily: fonts.bold,
      color: c.text,
    },
    seeAllLink: {
      fontSize: 14,
      fontFamily: fonts.semibold,
      color: c.accent,
    },

    recentCard: {
      marginBottom: spacing.sm,
    },
    recentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.md,
    },
    noteIconBadge: {
      width: 44,
      height: 44,
      borderRadius: radii.md,
      backgroundColor: '#EFF6FF',
      alignItems: 'center',
      justifyContent: 'center',
    },
    recentInfo: {
      flex: 1,
      marginHorizontal: spacing.md,
    },
    recentTitle: {
      fontSize: 15,
      fontFamily: fonts.bold,
      color: c.text,
    },
    recentMeta: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: c.textMuted,
      marginTop: 2,
    },
    recentDate: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: c.textFaint,
      marginTop: 2,
    },
    recentRight: {
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      height: 44,
    },
    durationPill: {
      backgroundColor: '#EFF6FF',
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radii.pill,
    },
    durationText: {
      fontSize: 12,
      fontFamily: fonts.semibold,
      color: c.accent,
    },
    moreBtn: {
      padding: 2,
    },

    emptyCard: {
      alignItems: 'center',
      paddingVertical: spacing.xxl,
    },
    emptyIcon: {
      width: 36,
      height: 36,
    },
    emptyText: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: spacing.md,
      lineHeight: 20,
    },
    retryBtn: {
      marginTop: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radii.pill,
      backgroundColor: c.accentSoft,
    },
    retryLabel: {
      fontSize: 14,
      fontFamily: fonts.semibold,
      color: c.accent,
    },

    // ── Tools & Backup ────────────────────────────────────────────────────────
    footerArea: {
      marginTop: spacing.xl,
    },
    toolsTitle: {
      marginBottom: spacing.md,
    },
    toolsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.xl,
    },
    toolCard: {
      width: '48%',
      backgroundColor: c.surface,
      borderRadius: radii.lg,
      padding: spacing.md,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.border,
    },
    toolIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: '#EFF6FF',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    toolLabel: {
      fontSize: 14,
      fontFamily: fonts.semibold,
      color: c.text,
    },

    backupCard: {
      backgroundColor: '#EFF6FF',
      borderRadius: radii.xl,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: '#DBEAFE',
      position: 'relative',
    },
    backupClose: {
      position: 'absolute',
      top: spacing.md,
      right: spacing.md,
      zIndex: 10,
    },
    backupRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    cloudIconWrap: {
      width: 48,
      height: 48,
      borderRadius: radii.md,
      backgroundColor: '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
    },
    backupContent: {
      flex: 1,
      paddingRight: spacing.lg,
    },
    backupTitle: {
      fontSize: 15,
      fontFamily: fonts.bold,
      color: c.text,
    },
    backupSub: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: c.textMuted,
      marginTop: 2,
      lineHeight: 18,
    },
    enableSyncBtn: {
      alignSelf: 'flex-end',
      backgroundColor: '#FFFFFF',
      borderWidth: 1,
      borderColor: '#2563EB',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs + 3,
      borderRadius: radii.pill,
    },
    enableSyncText: {
      fontSize: 13,
      fontFamily: fonts.semibold,
      color: '#2563EB',
    },
  });
