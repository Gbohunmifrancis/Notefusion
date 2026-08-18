import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { libraryApi } from '../api/endpoints';
import { toApiError } from '../api/client';
import { deriveSolfa } from '../lib/solfa';
import { synthesizeMelodyWavBase64 } from '../lib/synth';
import { useAuth } from '../lib/auth';
import { fonts, radii, spacing, type Palette, type Shadows } from '../design/theme';
import { useThemedStyles, useColors, useTheme } from '../lib/theme';
import type { SavedTranscription } from '../api/types';
import type { RootStackParams, TabParams } from '../navigation/types';

type Props = BottomTabScreenProps<TabParams, 'Home'>;

/**
 * HomeScreen — strictly following row 2 screen 1 ("Home") of the design sheet:
 * 1. Top bar: "Home" title on left, Dark Mode & Bell on right. NO sidebar drawer, NO profile icon in upper right.
 * 2. Greeting: "Good morning, Francis", "What will you transcribe today?"
 * 3. Primary Mic Card: Centred blue circular mic button, "Tap to start recording", "or import audio file"
 * 4. Quick Action Buttons: "Import" and "Paste URL"
 * 5. Recent Section: Clean "Recent" header with "See all" link and vector-icon transcription cards (NO emojis)
 */
export function HomeScreen({ navigation }: Props) {
  const rootNav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { user } = useAuth();
  const [recent, setRecent] = useState<SavedTranscription[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { mode, toggle } = useTheme();
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

  async function openRecent(item: SavedTranscription) {
    try {
      const full = await libraryApi.get(item.id);
      const derived = deriveSolfa(
        full.notes ?? [],
        full.key,
        full.timeSignature,
      );
      const audioPreviewBase64 = synthesizeMelodyWavBase64(
        derived.notes,
        full.tempoBpm,
      );

      rootNav.navigate('Result', {
        result: {
          key: full.key,
          keyConfidence: 1,
          tempo: full.tempoBpm,
          timeSignature: full.timeSignature,
          musicXml: full.musicXml ?? '',
          midiBase64: '',
          notes: derived.notes,
          solfaLines: derived.solfaLines,
          overallConfidence: full.overallConfidence,
          audioPreviewBase64,
        },
        savedId: full.id,
        title: full.title,
      });
    } catch (e) {
      Alert.alert('Could not open', toApiError(e).message);
    }
  }

  const firstName = user?.fullName?.split(' ')[0] ?? 'there';

  // Read at render rather than memoised: the screen re-renders on every focus, so
  // the greeting corrects itself if the app sat open from morning into afternoon.
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <Screen>
      <FlatList
        data={recent}
        keyExtractor={(t) => t.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerArea}>
            {/* ── 1. Top Header Bar: Dark Mode & Notifications (right) ─ */}
            <View style={styles.topHeader}>
              <View />

              <View style={styles.headerActions}>
                {/* Dark Mode Toggle */}
                <TouchableOpacity
                  onPress={toggle}
                  style={styles.headerIconBtn}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  <Ionicons
                    name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'}
                    size={22}
                    color={colors.text}
                  />
                </TouchableOpacity>

                {/* Notifications Bell — opens the notification controls. There is
                    no server-side notification feed to list, so an inbox would be
                    an empty screen; the settings are the real destination. */}
                <TouchableOpacity
                  onPress={() => rootNav.navigate('Settings', { focus: 'notifications' })}
                  style={styles.headerIconBtn}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Notification settings"
                >
                  <Ionicons name="notifications-outline" size={22} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            {/* ── 2. Greeting Header ────────────────────────────────────────── */}
            <Text style={styles.greetingTitle}>{greeting}, {firstName}</Text>
            <Text style={styles.greetingSub}>What will you transcribe today?</Text>

            {/* ── 3. Centred Mic Recording Stage ───────────────────────────── */}
            <View style={styles.stageCard}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => navigation.navigate('Record')}
                style={styles.micCircleWrap}
              >
                <View style={styles.micCircle}>
                  <Ionicons name="mic" size={42} color="#FFFFFF" />
                </View>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => navigation.navigate('Record')}>
                <Text style={styles.tapText}>Tap to start recording</Text>
                <Text style={styles.importSubLink}>or import audio file</Text>
              </TouchableOpacity>
            </View>

            {/* ── 4. Recent Recordings Header ───────────────────────────────── */}
            <View style={styles.recentSectionHeader}>
              <Text style={styles.recentSectionTitle}>Recent</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Library')}>
                <Text style={styles.seeAllText}>See all</Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => openRecent(item)}
          >
            <Card style={styles.recentCard} padded={false}>
              <View style={styles.recentRow}>
                <View style={styles.noteIconBadge}>
                  <Ionicons name="musical-notes-outline" size={20} color={colors.accent} />
                </View>

                <View style={styles.recentInfo}>
                  <Text style={styles.recentTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.recentMeta}>
                    {item.key} Major · {item.tempoBpm} BPM
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
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
              <Ionicons name="musical-notes-outline" size={36} color={colors.accent} />
              <Text style={styles.emptyText}>
                No transcriptions yet. Tap the mic button above to start recording.
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
    pageTitle: {
      fontSize: 24,
      fontFamily: fonts.bold,
      color: c.text,
    },
    headerIconBtn: {
      padding: 4,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },

    // ── Greeting Header ───────────────────────────────────────────────────────
    greetingTitle: {
      fontSize: 22,
      fontFamily: fonts.bold,
      color: c.text,
      marginBottom: 2,
    },
    greetingSub: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: c.textMuted,
      marginBottom: spacing.xl,
    },

    // ── Centred Stage Card ────────────────────────────────────────────────────
    stageCard: {
      backgroundColor: c.surface,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.xl,
      alignItems: 'center',
      marginBottom: spacing.xxl,
      ...s.card,
    },
    micCircleWrap: {
      marginBottom: spacing.md,
    },
    micCircle: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: '#2563EB',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#2563EB',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 8,
    },
    tapText: {
      fontSize: 16,
      fontFamily: fonts.bold,
      color: c.accent,
      textAlign: 'center',
    },
    importSubLink: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: c.textFaint,
      textAlign: 'center',
      marginTop: 2,
      marginBottom: spacing.lg,
    },

    // Quick Action Row
    quickActionRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    quickBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: c.bg,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.pill,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs + 3,
    },
    quickBtnLabel: {
      fontSize: 13,
      fontFamily: fonts.semibold,
      color: c.text,
    },

    // ── Recent Section ────────────────────────────────────────────────────────
    recentSectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    recentSectionTitle: {
      fontSize: 18,
      fontFamily: fonts.bold,
      color: c.text,
    },
    seeAllText: {
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
      width: 40,
      height: 40,
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
      fontFamily: fonts.regular,
      color: c.textMuted,
      marginTop: 2,
    },

    emptyCard: {
      alignItems: 'center',
      paddingVertical: spacing.xxl,
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
  });
