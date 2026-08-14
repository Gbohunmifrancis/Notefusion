import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { BrandMark } from '../components/BrandMark';
import { libraryApi } from '../api/endpoints';
import { toApiError } from '../api/client';
import { useAuth } from '../lib/auth';
import { fonts, radii, spacing, typography, type Palette, type Shadows } from '../design/theme';
import { useThemedStyles, useColors, useTheme } from '../lib/theme';
import { appIcons } from '../design/icons';
import type { SavedTranscription } from '../api/types';
import type { TabParams } from '../navigation/types';

type Props = BottomTabScreenProps<TabParams, 'Home'>;

/**
 * HomeScreen — strictly following row 2 screen 1 ("Home") of the design sheet:
 * 1. Top bar: Menu (≡) on left opens functional slide-out Side Drawer menu. Dark Mode & Bell on right. NO profile icon in upper right.
 * 2. Greeting: "Good morning, Francis", "What will you transcribe today?"
 * 3. Primary Mic Card: Centred blue circular mic button, "Tap to start recording", "or import audio file"
 * 4. Quick Action Buttons: "Import" and "Paste URL"
 * 5. Recent Section: "Recent" header with "See all" link and clean transcription cards
 */
export function HomeScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [recent, setRecent] = useState<SavedTranscription[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
            {/* ── 1. Top Header Bar: Menu (left), Dark Mode & Notifications (right) ─ */}
            <View style={styles.topHeader}>
              <TouchableOpacity
                onPress={() => setDrawerOpen(true)}
                style={styles.headerIconBtn}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Open side menu"
              >
                <Ionicons name="menu-outline" size={24} color={colors.text} />
              </TouchableOpacity>

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

                {/* Notifications Bell */}
                <TouchableOpacity
                  onPress={() => Alert.alert('Notifications', 'You have no new notifications.')}
                  style={styles.headerIconBtn}
                  hitSlop={8}
                >
                  <Ionicons name="notifications-outline" size={22} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            {/* ── 2. Greeting Header ────────────────────────────────────────── */}
            <Text style={styles.greetingTitle}>Good morning, {firstName}</Text>
            <Text style={styles.greetingSub}>What will you transcribe today?</Text>

            {/* ── 3. Centred Mic Recording Stage (Design Sheet) ─────────────── */}
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

              {/* Quick action buttons row */}
              <View style={styles.quickActionRow}>
                <TouchableOpacity
                  style={styles.quickBtn}
                  onPress={() => navigation.navigate('Record')}
                >
                  <Ionicons name="cloud-upload-outline" size={16} color={colors.text} />
                  <Text style={styles.quickBtnLabel}>Import</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.quickBtn}
                  onPress={() => navigation.navigate('Record')}
                >
                  <Ionicons name="link-outline" size={16} color={colors.text} />
                  <Text style={styles.quickBtnLabel}>Paste URL</Text>
                </TouchableOpacity>
              </View>
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
            onPress={() => navigation.navigate('Library')}
          >
            <Card style={styles.recentCard} padded={false}>
              <View style={styles.recentRow}>
                <View style={styles.noteIconBadge}>
                  <Ionicons name="document-text-outline" size={20} color={colors.accent} />
                </View>

                <View style={styles.recentInfo}>
                  <Text style={styles.recentTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.recentMeta}>
                    {item.key} Major · {item.tempoBpm} BPM
                  </Text>
                </View>

                <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
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
                No transcriptions yet. Tap the mic button above to start recording.
              </Text>
            </Card>
          )
        }
      />

      {/* ── Side Menu Drawer Modal ───────────────────────────────────────── */}
      <Modal
        visible={drawerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setDrawerOpen(false)}
      >
        <View style={styles.drawerOverlay}>
          <Pressable style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)} />

          <View style={styles.drawerContent}>
            <View style={styles.drawerHeader}>
              <View style={styles.brandRow}>
                <BrandMark size={36} color={colors.accent} waveColor={colors.accentAlt} showWaves />
                <Text style={styles.drawerBrandText}>Notefusion</Text>
              </View>
              <TouchableOpacity onPress={() => setDrawerOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.drawerUserEmail}>{user?.email ?? 'user@notefusion.studio'}</Text>

            <View style={styles.drawerMenu}>
              <DrawerItem
                icon="home-outline"
                label="Home"
                onPress={() => {
                  setDrawerOpen(false);
                  navigation.navigate('Home');
                }}
              />
              <DrawerItem
                icon="folder-outline"
                label="Library"
                onPress={() => {
                  setDrawerOpen(false);
                  navigation.navigate('Library');
                }}
              />
              <DrawerItem
                icon="mic-outline"
                label="Record"
                onPress={() => {
                  setDrawerOpen(false);
                  navigation.navigate('Record');
                }}
              />
              <DrawerItem
                icon="person-outline"
                label="Profile"
                onPress={() => {
                  setDrawerOpen(false);
                  navigation.navigate('Profile');
                }}
              />
              <View style={styles.drawerDivider} />
              <DrawerItem
                icon={mode === 'dark' ? 'sunny-outline' : 'moon-outline'}
                label={mode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                onPress={() => {
                  toggle();
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function DrawerItem({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <TouchableOpacity style={styles.drawerRow} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={20} color={colors.text} style={styles.drawerIcon} />
      <Text style={styles.drawerLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </TouchableOpacity>
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
      fontSize: 24,
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

    // ── Drawer Modal ──────────────────────────────────────────────────────────
    drawerOverlay: {
      flex: 1,
      flexDirection: 'row',
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    drawerBackdrop: {
      flex: 1,
    },
    drawerContent: {
      width: 280,
      backgroundColor: c.bg,
      paddingTop: spacing.xxl,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
    },
    drawerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.xs,
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    drawerBrandText: {
      fontSize: 18,
      fontFamily: fonts.bold,
      color: c.text,
    },
    drawerUserEmail: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: c.textMuted,
      marginBottom: spacing.xl,
    },
    drawerMenu: {
      gap: spacing.xs,
    },
    drawerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.md,
    },
    drawerIcon: {
      marginRight: spacing.md,
    },
    drawerLabel: {
      flex: 1,
      fontSize: 15,
      fontFamily: fonts.medium,
      color: c.text,
    },
    drawerDivider: {
      height: 1,
      backgroundColor: c.border,
      marginVertical: spacing.sm,
    },
  });
