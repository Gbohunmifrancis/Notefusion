import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Avatar } from '../components/Avatar';
import { AppDrawer } from '../components/AppDrawer';
import { Card } from '../components/Card';
import { Touchable } from '../components/Touchable';
import { TranscriptionRowSkeleton } from '../components/Skeleton';
import { libraryApi, meApi } from '../api/endpoints';
import { toApiError } from '../api/client';
import { deriveSolfa } from '../lib/solfa';
import { synthesizeMelodyWavBase64 } from '../lib/synth';
import { useAuth } from '../lib/auth';
import { showDialog } from '../lib/dialog';
import { useSubscription } from '../lib/subscription';
import { fonts, gradients, motion, radii, spacing, type Palette, type Shadows } from '../design/theme';
import { useThemedStyles, useColors, useTheme } from '../lib/theme';
import type { SavedTranscription } from '../api/types';
import type { RootStackParams, TabParams } from '../navigation/types';

type Props = BottomTabScreenProps<TabParams, 'Home'>;

/**
 * The time-of-day greeting. Module-level so the initial value and every later
 * refresh read one rule.
 */
function currentGreeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * HomeScreen — strictly following row 2 screen 1 ("Home") of the design sheet:
 * 1. Top bar: avatar on the left (opens the account side bar), Dark Mode & Bell on right.
 * 2. Greeting: "Good morning, Francis", "What will you transcribe today?"
 * 3. Primary Mic Card: Centred blue circular mic button, "Tap to start recording", "or import audio file"
 * 4. Quick Action Buttons: "Import audio" and "Paste a link"
 * 5. Recent Section: Clean "Recent" header with "See all" link and vector-icon transcription cards (NO emojis)
 */
export function HomeScreen({ navigation }: Props) {
  const rootNav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { user } = useAuth();
  const { isPro, refresh: refreshSubscription } = useSubscription();
  const [recent, setRecent] = useState<SavedTranscription[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pictureUrl, setPictureUrl] = useState<string | null>(null);
  const [greeting, setGreeting] = useState(currentGreeting);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { mode, toggle } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const colors = useColors();

  // ── Mic stage motion ──────────────────────────────────────────────────────
  /**
   * One driver, 0 → 1 → 0, feeding both the halo's opacity and the circle's own
   * scale so they breathe as a single object rather than two things that happen
   * to share a duration.
   *
   * RN `Animated` rather than Reanimated, matching the ambient pulse on
   * RecordScreen: this is an idle loop on the native driver, not a gesture
   * response, and there is nothing for the UI thread to win here. The press
   * spring inside `Touchable` is the Reanimated half.
   */
  const breathe = useRef(new Animated.Value(0)).current;
  /** Fires once per press-in: one ring out of the circle, then gone. */
  const ring = useRef(new Animated.Value(0)).current;
  /** Entrance: fades + slides the content in once per focus, so navigating away
   *  and back replays the transition rather than keeping a stale snapshot. */
  const mountFade = useRef(new Animated.Value(0)).current;

  const haloOpacity = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 0.6],
  });
  const breatheScale = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.03],
  });
  const ringScale = ring.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.7],
  });
  const ringOpacity = ring.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 0],
  });
  const mountOpacity = mountFade.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const mountTranslate = mountFade.interpolate({
    inputRange: [0, 1],
    outputRange: [14, 0],
  });

  // Gated on focus, not mount: Home stays mounted for the whole session, so an
  // ungated loop would keep waking the native driver behind Library and Settings
  // for as long as the app is open.
  useFocusEffect(
    useCallback(() => {
      // Reset and replay entrance animation on every focus.
      mountFade.setValue(0);
      const entrance = Animated.timing(mountFade, {
        toValue: 1,
        duration: 340,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      entrance.start();

      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, {
            toValue: 1,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(breathe, {
            toValue: 0,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      pulse.start();
      return () => {
        entrance.stop();
        pulse.stop();
        breathe.setValue(0);
      };
    }, [breathe, mountFade]),
  );

  const fireRing = useCallback(() => {
    ring.setValue(0);
    Animated.timing(ring, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [ring]);

  // The greeting used to be read at render, on the assumption that focus alone would
  // keep it honest. It does not: backgrounding the app with Home focused and coming
  // back hours later never re-fires the focus effect — the screen never lost focus —
  // so "Good morning" sat there into the evening. Foreground is the case that was
  // missing. React bails out when the string is unchanged, so this costs no renders.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setGreeting(currentGreeting());
    });
    return () => sub.remove();
  }, []);

  const reload = useCallback(() => {
    setLoadingRecent(true);
    libraryApi
      .list()
      .then((all) => {
        setRecent(all.slice(0, 3));
        setLoadError(null);
      })
      .catch((e) => setLoadError(toApiError(e).message))
      .finally(() => setLoadingRecent(false));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        libraryApi
          .list()
          .then((all) => {
            setRecent(all.slice(0, 3));
            setLoadError(null);
          })
          .catch((e) => setLoadError(toApiError(e).message)),
        meApi
          .get()
          .then((p) => setPictureUrl(p.profilePictureUrl))
          .catch(() => undefined),
        refreshSubscription(true).catch(() => undefined),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshSubscription]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setGreeting(currentGreeting());
      // Re-read on focus rather than once on mount: Home stays mounted for the whole
      // session, so a photo changed on Profile would otherwise not appear until relaunch.
      meApi
        .get()
        .then((p) => {
          if (active) setPictureUrl(p.profilePictureUrl);
        })
        .catch(() => undefined);
      setLoadingRecent(true);
      libraryApi
        .list()
        .then((all) => {
          if (!active) return;
          setRecent(all.slice(0, 3));
          setLoadError(null);
        })
        .catch((e) => {
          if (active) setLoadError(toApiError(e).message);
        })
        .finally(() => {
          if (active) setLoadingRecent(false);
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
          chords: full.chords ?? null,
        },
        savedId: full.id,
        title: full.title,
      });
    } catch (e) {
      showDialog({
        title: 'Could not open',
        message: toApiError(e).message,
        icon: 'alert-circle-outline',
        tone: 'danger',
      });
    }
  }

  const firstName = user?.fullName?.split(' ')[0] ?? 'there';

  return (
    <Screen>
      <FlatList
        data={recent}
        keyExtractor={(t) => t.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerArea}>
            {/* ── 1. Top Header Bar: Dark Mode & Notifications (right) ─ */}
            <View style={styles.topHeader}>
              {/* The left slot was an empty spacer holding the actions right. The
                  avatar fills it and carries the premium signal: the gold ring is
                  `Avatar`'s own `premium` prop, so Home and Profile cannot disagree
                  about who is paying. Tapping it opens the account side bar rather
                  than jumping straight to Profile — the profile is one row inside it. */}
              <Avatar
                uri={pictureUrl}
                name={user?.fullName}
                size={38}
                premium={isPro}
                onPress={() => setDrawerOpen(true)}
              />

              <View style={styles.headerActions}>
                {/* Dark Mode Toggle */}
                <Touchable
                  onPress={toggle}
                  style={styles.headerIconBtn}
                  hitSlop={8}
                  // Bare glyphs, so the ripple radiates from the icon rather than
                  // boxing its 4px of padding.
                  ripple="borderless"
                  accessibilityLabel={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  <Ionicons
                    name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'}
                    size={22}
                    color={colors.text}
                  />
                </Touchable>

                {/* Notifications Bell — opens the notification controls. There is
                    no server-side notification feed to list, so an inbox would be
                    an empty screen; the settings are the real destination. */}
                <Touchable
                  onPress={() => rootNav.navigate('Settings', { focus: 'notifications' })}
                  style={styles.headerIconBtn}
                  hitSlop={8}
                  ripple="borderless"
                  accessibilityLabel="Notification settings"
                >
                  <Ionicons name="notifications-outline" size={22} color={colors.text} />
                </Touchable>
              </View>
            </View>

            {/* ── 2. Greeting Header + Stage + Recent: animated entrance ─── */}
            <Animated.View
              style={{
                opacity: mountOpacity,
                transform: [{ translateY: mountTranslate }],
              }}
            >
              {/* ── 2. Greeting Header ──────────────────────────────────── */}
              <View style={styles.greetingRow}>
                <Text style={styles.greetingTitle} numberOfLines={1}>
                  {greeting}, {firstName}
                </Text>
                {/* Same soft-gold chip as the Profile plan badge rather than a second
                    gold treatment invented here. */}
                {isPro && (
                  <View style={styles.proChip}>
                    <Ionicons name="star" size={9} color={colors.premiumDeep} />
                    <Text style={styles.proChipText}>PRO</Text>
                  </View>
                )}
              </View>
              <Text style={styles.greetingSub}>What will you transcribe today?</Text>

              {/* ── 3. Centred Mic Recording Stage ──────────────────────── */}
              <View style={styles.stageCard}>
                <View style={styles.micStage}>
                  {/* Faint brand logo watermark. Sits behind everything — purely
                      decorative, so it is non-interactive and very low opacity.
                      pointerEvents="none" is redundant on a plain Image but explicit
                      for maintainability. */}
                  <Image
                    source={require('../../assets/brand/mark.png')}
                    style={styles.micLogo}
                    resizeMode="contain"
                  />

                  {/* Breathing halo. Behind the circle and non-interactive, so the
                      tap target stays the 88px circle rather than growing to the
                      halo's diameter. */}
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.micHalo,
                      { opacity: haloOpacity, transform: [{ scale: breatheScale }] },
                    ]}
                  />

                  {/* Tap ring — one expanding outline per press, fired from
                      press-in so it starts under the finger. */}
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.micRing,
                      { opacity: ringOpacity, transform: [{ scale: ringScale }] },
                    ]}
                  />

                  <Touchable
                    onPress={() => navigation.navigate('Record')}
                    onPressIn={fireRing}
                    // The screen's hero control: heavier tick, deeper press. No ripple
                    // and no radius — the circle casts a glow that a clip would cut.
                    haptic="medium"
                    scaleTo={motion.scale.large}
                    ripple={false}
                    accessibilityLabel="Start recording"
                  >
                    {/* Breathing scale lives here, not on the Touchable: that already
                        owns a Reanimated scale, and two drivers writing one transform
                        fight. Nested, they compose — parent press × child breath. */}
                    <Animated.View style={{ transform: [{ scale: breatheScale }] }}>
                      <LinearGradient
                        colors={gradients.brand}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.micCircle}
                      >
                        <Ionicons name="mic" size={42} color="#FFFFFF" />
                      </LinearGradient>
                    </Animated.View>
                  </Touchable>
                </View>

                <Touchable
                  onPress={() => navigation.navigate('Record')}
                  ripple={false}
                  accessibilityLabel="Start recording"
                >
                  <Text style={styles.tapText}>Tap to start recording</Text>
                </Touchable>

                <Touchable
                  onPress={() => navigation.navigate('Record', { autoPickAudio: true })}
                  ripple={false}
                  accessibilityLabel="Import audio file"
                >
                  <Text style={styles.importSubLink}>or import audio file</Text>
                </Touchable>

                {/* ── Quick Action Row ──────────────────────────────────── */}
                <View style={styles.quickActionRow}>
                  <Touchable
                    onPress={() => navigation.navigate('Record', { autoPickAudio: true })}
                    style={styles.quickBtn}
                    ripple="borderless"
                    scaleTo={motion.scale.default}
                    accessibilityLabel="Import audio file"
                  >
                    <Ionicons name="folder-open-outline" size={16} color={colors.text} />
                    <Text style={styles.quickBtnLabel}>Import audio</Text>
                  </Touchable>

                  <Touchable
                    onPress={() => rootNav.navigate('Link')}
                    style={styles.quickBtn}
                    ripple="borderless"
                    scaleTo={motion.scale.default}
                    accessibilityLabel="Paste a song link"
                  >
                    <Ionicons name="link-outline" size={16} color={colors.text} />
                    <Text style={styles.quickBtnLabel}>Paste a link</Text>
                  </Touchable>
                </View>
              </View>

              {/* ── Find the key: the Shazam-style listener ─────────────── */}
              <Touchable
                onPress={() => rootNav.navigate('Listen')}
                ripple={false}
                accessibilityLabel="Find the key of a song that is playing"
              >
                <Card style={styles.listenCard} padded={false}>
                  <View style={styles.recentRow}>
                    <View style={styles.noteIconBadge}>
                      <Ionicons name="radio-outline" size={20} color={colors.accent} />
                    </View>
                    <View style={styles.recentInfo}>
                      <Text style={styles.recentTitle}>Find the key</Text>
                      <Text style={styles.recentMeta}>
                        Play any song out loud and NoteFusion names its doh — even while you use other apps.
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                  </View>
                </Card>
              </Touchable>

              {/* ── 4. Recent Recordings Header ─────────────────────────── */}
              <View style={styles.recentSectionHeader}>
                <Text style={styles.recentSectionTitle}>Recent</Text>
                <Touchable
                  onPress={() => navigation.navigate('Library')}
                  ripple={false}
                  accessibilityLabel="See all transcriptions"
                >
                  <Text style={styles.seeAllText}>See all</Text>
                </Touchable>
              </View>
            </Animated.View>
          </View>
        }

        renderItem={({ item }) => (
          <Touchable
            onPress={() => openRecent(item)}
            // No ripple: clipping it to the Card's 20px radius would need
            // overflow:hidden, which cuts off the Card's own shadow. The scale
            // carries the press on its own.
            ripple={false}
            accessibilityLabel={`Open ${item.title}`}
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
                    {item.key} · {item.tempoBpm} BPM
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </View>
            </Card>
          </Touchable>
        )}
        ListEmptyComponent={
          loadingRecent ? (
            <View style={styles.skeletonContainer}>
              <TranscriptionRowSkeleton />
              <TranscriptionRowSkeleton />
              <TranscriptionRowSkeleton />
            </View>
          ) : loadError ? (
            <Card style={styles.emptyCard}>
              <Ionicons name="cloud-offline-outline" size={30} color={colors.danger} />
              <Text style={styles.emptyText}>{loadError}</Text>
              {/* Flat accentSoft fill and no shadow, so this one can be clipped
                  to its pill and take the ripple. */}
              <Touchable
                onPress={reload}
                style={styles.retryBtn}
                radius={radii.pill}
                accessibilityLabel="Try again"
              >
                <Text style={styles.retryLabel}>Try again</Text>
              </Touchable>
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

      {/* Mounted here rather than in the navigator: nothing else needs to open it, so
          local state beats another context. A Modal takes no layout space. */}
      <AppDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        pictureUrl={pictureUrl}
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
    greetingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: 2,
    },
    greetingTitle: {
      fontSize: 22,
      fontFamily: fonts.bold,
      color: c.text,
      // Shrinks so a long name is truncated rather than pushing the chip off-screen.
      flexShrink: 1,
    },
    proChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: c.premiumSoft,
      borderWidth: 1,
      borderColor: c.premiumBorder,
      borderRadius: radii.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    proChipText: {
      fontSize: 9.5,
      fontFamily: fonts.bold,
      color: c.premiumDeep,
      letterSpacing: 0.8,
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
    /** Centres the halo, the tap ring and the circle on one point.
     *  Fixed height matches the 148px halo diameter so the glow shadow stays
     *  within the stage bounds and the "Tap to start recording" text below
     *  is never occluded. */
    micStage: {
      alignItems: 'center',
      justifyContent: 'center',
      height: 148,
      width: 148,
      marginBottom: spacing.md,
    },
    /** Faint brand mark behind the mic button — purely decorative.
     *  Opacity is low enough to be subliminal; the mic icon reads as the
     *  primary element. */
    micLogo: {
      position: 'absolute',
      width: 120,
      height: 120,
      opacity: 0.05,
    },
    /** Same filled-glow idiom as RecordScreen's ambient orb, scaled to the
     *  smaller circle: 30px of halo either side of an 88px button. */
    micHalo: {
      position: 'absolute',
      width: 148,
      height: 148,
      borderRadius: 74,
      backgroundColor: c.accentGlow,
    },
    micRing: {
      position: 'absolute',
      width: 88,
      height: 88,
      borderRadius: 44,
      borderWidth: 1.5,
      borderColor: c.accent,
    },
    micCircle: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      ...s.glow,
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

    /** Sits between the stage and Recent; the row inside reuses the recent-card layout. */
    listenCard: {
      marginBottom: spacing.xxl,
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
      backgroundColor: c.accentSoft,
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
    skeletonContainer: {
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
  });
