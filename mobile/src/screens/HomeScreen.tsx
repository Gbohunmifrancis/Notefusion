import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Avatar } from '../components/Avatar';
import { AppDrawer } from '../components/AppDrawer';
import { Touchable } from '../components/Touchable';
import { Skeleton } from '../components/Skeleton';
import { Mark, Wordmark } from '../components/night/NightUI';
import { libraryApi, meApi } from '../api/endpoints';
import { toApiError } from '../api/client';
import { deriveSolfa, dohLetter } from '../lib/solfa';
import { synthesizeMelodyWavBase64 } from '../lib/synth';
import { useAuth } from '../lib/auth';
import { showDialog } from '../lib/dialog';
import { useSubscription } from '../lib/subscription';
import { confidenceColor, fonts, motion, radii, spacing, typography, type Palette, type Shadows } from '../design/theme';
import { useThemedStyles, useColors } from '../lib/theme';
import type { SavedTranscription } from '../api/types';
import type { RootStackParams, TabParams } from '../navigation/types';
import { solfaOpening } from '../lib/solfaOpening';

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
 * HomeScreen — "02 · Home" of the night board: one question, one button. The
 * mark is the record button; the chips under it are the other ways in; every
 * recent sheet is known by its doh tile, its opening solfa and its confidence.
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
  const styles = useThemedStyles(makeStyles);
  const colors = useColors();

  // ── Mic stage motion ──────────────────────────────────────────────────────
  /**
   * One driver, 0 → 1 → 0, feeding both the bloom's opacity and the circle's own
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

  const bloomOpacity = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1],
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
            {/* ── Top bar: the lock-up left, the account right ───────────── */}
            <View style={styles.topHeader}>
              <View style={styles.lockup} accessible accessibilityLabel="Notefusion">
                <Mark height={24} color={colors.text} />
                <Wordmark size={19} style={{ color: colors.text }} />
              </View>

              <View style={styles.headerActions}>
                {/* The gold ring is `Avatar`'s own `premium` prop, so Home and Profile
                    cannot disagree about who is paying. It opens the account side bar;
                    the profile is one row inside it. */}
                <Avatar
                  uri={pictureUrl}
                  name={user?.fullName}
                  size={38}
                  premium={isPro}
                  onPress={() => setDrawerOpen(true)}
                />
              </View>
            </View>

            <Animated.View
              style={{
                opacity: mountOpacity,
                transform: [{ translateY: mountTranslate }],
              }}
            >
              {/* ── The question ──────────────────────────────────────── */}
              <View style={styles.eyebrowRow}>
                <Text style={styles.eyebrow} numberOfLines={1}>
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
              <Text style={styles.title}>What are we singing today?</Text>

              {/* ── The record button: the mark itself ────────────────── */}
              <View style={styles.stage}>
                <View style={styles.micStage}>
                  {/* The soft bloom behind the button breathes with it. SVG because
                      React Native has no radial gradient; non-interactive, so the tap
                      target stays the 112px circle. */}
                  <Animated.View
                    pointerEvents="none"
                    style={[styles.bloom, { opacity: bloomOpacity }]}
                  >
                    <Svg width={BLOOM} height={BLOOM}>
                      <Defs>
                        <RadialGradient id="homeBloom" cx="50%" cy="50%" r="50%">
                          <Stop offset="0" stopColor={colors.ink} stopOpacity={0.32} />
                          <Stop offset="1" stopColor={colors.ink} stopOpacity={0} />
                        </RadialGradient>
                      </Defs>
                      <Circle cx={BLOOM / 2} cy={BLOOM / 2} r={BLOOM / 2} fill="url(#homeBloom)" />
                    </Svg>
                  </Animated.View>

                  <View pointerEvents="none" style={styles.ringOuter} />
                  <View pointerEvents="none" style={styles.ringInner} />

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
                        colors={[colors.accent, colors.ink, colors.ink]}
                        start={{ x: 0.2, y: 0.1 }}
                        end={{ x: 0.85, y: 1 }}
                        style={styles.micCircle}
                      >
                        <Mark height={58} />
                      </LinearGradient>
                    </Animated.View>
                  </Touchable>
                </View>

                <Touchable
                  onPress={() => navigation.navigate('Record')}
                  ripple={false}
                  accessibilityLabel="Start recording"
                >
                  <Text style={styles.tapText}>Tap to record · hum, sing or play</Text>
                </Touchable>
              </View>

              {/* ── The other ways in ─────────────────────────────────── */}
              <View style={styles.chipRow}>
                <Touchable
                  onPress={() => rootNav.navigate('Link')}
                  style={styles.chip}
                  radius={radii.pill}
                  accessibilityLabel="Paste a song link"
                >
                  <Ionicons name="link-outline" size={17} color={colors.accent} />
                  <Text style={styles.chipLabel}>Paste link</Text>
                </Touchable>
                <Touchable
                  onPress={() => navigation.navigate('Record', { autoPickAudio: true })}
                  style={styles.chip}
                  radius={radii.pill}
                  accessibilityLabel="Import audio file"
                >
                  <Ionicons name="download-outline" size={17} color={colors.accent} />
                  <Text style={styles.chipLabel}>Import</Text>
                </Touchable>
                <Touchable
                  onPress={() => rootNav.navigate('Listen')}
                  style={styles.chip}
                  radius={radii.pill}
                  accessibilityLabel="Find the key of a song that is playing"
                >
                  <Ionicons name="radio-outline" size={17} color={colors.accent} />
                  <Text style={styles.chipLabel}>Find key</Text>
                </Touchable>
              </View>

              {/* ── Recent ────────────────────────────────────────────── */}
              <View style={styles.recentSectionHeader}>
                <Text style={styles.recentSectionTitle}>Recent</Text>
                <Touchable
                  onPress={() => navigation.navigate('Library')}
                  ripple={false}
                  hitSlop={8}
                  accessibilityLabel="See all transcriptions"
                >
                  <Text style={styles.seeAllText}>See all</Text>
                </Touchable>
              </View>
            </Animated.View>
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => {
          const opening = solfaOpening(item.notes ?? item.preview, item.timeSignature);
          const tone = confidenceColor(item.overallConfidence, colors);
          return (
            <Touchable
              onPress={() => openRecent(item)}
              style={styles.recentRow}
              radius={radii.md}
              accessibilityLabel={`Open ${item.title}`}
            >
              <View style={styles.dohTile}>
                <Text style={styles.dohLetter} numberOfLines={1}>
                  {dohLetter(item.key)}
                </Text>
                <Text style={styles.dohCaption}>DOH</Text>
              </View>

              <View style={styles.recentInfo}>
                <Text style={styles.recentTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                {opening ? (
                  <Text style={styles.solfaPreview} numberOfLines={1}>
                    <Text style={styles.solfaLead}>{opening.first}</Text>
                    {opening.rest ? ` │ ${opening.rest}` : ''}
                  </Text>
                ) : (
                  <Text style={styles.recentMeta} numberOfLines={1}>
                    {item.key} · {item.tempoBpm} BPM · {item.timeSignature}
                  </Text>
                )}
              </View>

              <View
                style={styles.score}
                accessibilityLabel={`${Math.round(item.overallConfidence * 100)} percent sure`}
              >
                <View style={[styles.scoreDot, { backgroundColor: tone }]} />
                <Text style={[styles.scoreText, { color: tone }]}>
                  {Math.round(item.overallConfidence * 100)}
                </Text>
              </View>
            </Touchable>
          );
        }}
        ListEmptyComponent={
          loadingRecent ? (
            <View>
              {[0, 1, 2].map((i) => (
                <View key={i} style={styles.recentRow}>
                  <Skeleton width={44} height={48} radius={radii.md} />
                  <View style={styles.recentInfo}>
                    <Skeleton width="60%" height={14} radius={radii.sm} style={styles.skeletonTitle} />
                    <Skeleton width="40%" height={11} radius={radii.sm} />
                  </View>
                  <Skeleton width={34} height={12} radius={radii.pill} />
                </View>
              ))}
            </View>
          ) : loadError ? (
            <View style={styles.empty}>
              <Ionicons name="cloud-offline-outline" size={26} color={colors.textMuted} />
              <Text style={styles.emptyText}>{loadError}</Text>
              <Touchable
                onPress={reload}
                style={styles.emptyAction}
                radius={radii.pill}
                accessibilityLabel="Try again"
              >
                <Text style={styles.emptyActionLabel}>Try again</Text>
              </Touchable>
            </View>
          ) : (
            <View style={styles.empty}>
              <Mark height={34} color={colors.textFaint} />
              <Text style={styles.emptyText}>
                Your sheets land here. Hum a line and see it in solfa.
              </Text>
              <Touchable
                onPress={() => navigation.navigate('Record')}
                style={styles.emptyAction}
                radius={radii.pill}
                accessibilityLabel="Record your first tune"
              >
                <Text style={styles.emptyActionLabel}>Record your first tune</Text>
              </Touchable>
            </View>
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

/** The record button, its two rings and the bloom they sit in, by diameter. */
const MIC = 112;
const RING_INNER = 140;
const RING_OUTER = 176;
const BLOOM = 280;

const makeStyles = (c: Palette, s: Shadows) =>
  StyleSheet.create({
    headerArea: {
      paddingTop: spacing.xs,
    },
    // Clears the floating tab bar.
    listContent: {
      paddingBottom: 120,
    },

    // ── Top bar ───────────────────────────────────────────────────────────────
    topHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: spacing.xs,
    },
    lockup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },

    // ── The question ──────────────────────────────────────────────────────────
    eyebrowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: 28,
    },
    eyebrow: {
      fontSize: 12,
      fontFamily: fonts.medium,
      letterSpacing: 1.7,
      textTransform: 'uppercase',
      color: c.textMuted,
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
    title: {
      ...typography.display,
      lineHeight: 37,
      color: c.text,
      marginTop: spacing.sm,
    },

    // ── Record stage ──────────────────────────────────────────────────────────
    stage: {
      alignItems: 'center',
      marginTop: spacing.xl,
    },
    /** Centres the bloom, both rings, the tap ring and the button on one point. */
    micStage: {
      alignItems: 'center',
      justifyContent: 'center',
      width: RING_OUTER,
      height: RING_OUTER,
    },
    bloom: {
      position: 'absolute',
      width: BLOOM,
      height: BLOOM,
    },
    ringOuter: {
      position: 'absolute',
      width: RING_OUTER,
      height: RING_OUTER,
      borderRadius: RING_OUTER / 2,
      borderWidth: 1,
      borderColor: c.accentSoft,
    },
    ringInner: {
      position: 'absolute',
      width: RING_INNER,
      height: RING_INNER,
      borderRadius: RING_INNER / 2,
      borderWidth: 1,
      borderColor: c.accentGlow,
    },
    micRing: {
      position: 'absolute',
      width: MIC,
      height: MIC,
      borderRadius: MIC / 2,
      borderWidth: 1.5,
      borderColor: c.accent,
    },
    micCircle: {
      width: MIC,
      height: MIC,
      borderRadius: MIC / 2,
      alignItems: 'center',
      justifyContent: 'center',
      ...s.glow,
    },
    tapText: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: spacing.sm,
    },

    // ── Chips ─────────────────────────────────────────────────────────────────
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: spacing.sm,
      marginTop: 22,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      height: 40,
      paddingHorizontal: 14,
      borderRadius: radii.pill,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    chipLabel: {
      fontSize: 13.5,
      fontFamily: fonts.medium,
      color: c.text,
    },

    // ── Recent ────────────────────────────────────────────────────────────────
    recentSectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 28,
      marginBottom: spacing.xs,
    },
    recentSectionTitle: {
      fontSize: 17,
      fontFamily: fonts.semibold,
      letterSpacing: -0.3,
      color: c.text,
    },
    seeAllText: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: c.accent,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
    },
    recentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 12,
    },
    dohTile: {
      width: 44,
      height: 48,
      borderRadius: radii.md,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dohLetter: {
      fontFamily: typography.mono.fontFamily,
      fontSize: 16,
      color: c.text,
    },
    dohCaption: {
      fontSize: 8.5,
      fontFamily: fonts.medium,
      letterSpacing: 1,
      color: c.textMuted,
      marginTop: 2,
    },
    recentInfo: {
      flex: 1,
    },
    recentTitle: {
      fontSize: 15,
      fontFamily: fonts.medium,
      letterSpacing: -0.15,
      color: c.text,
    },
    solfaPreview: {
      fontFamily: typography.mono.fontFamily,
      fontSize: 12.5,
      letterSpacing: 0.5,
      color: c.textMuted,
      marginTop: 3,
    },
    solfaLead: {
      color: c.accent,
    },
    recentMeta: {
      fontSize: 12.5,
      fontFamily: fonts.regular,
      color: c.textMuted,
      marginTop: 3,
    },
    score: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    scoreDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    scoreText: {
      fontSize: 12.5,
      fontFamily: fonts.medium,
    },
    skeletonTitle: {
      marginBottom: 6,
    },

    // ── Empty and error states ────────────────────────────────────────────────
    empty: {
      alignItems: 'center',
      paddingVertical: spacing.xl,
    },
    emptyText: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: c.textMuted,
      textAlign: 'center',
      lineHeight: 20,
      marginTop: spacing.md,
      maxWidth: 280,
    },
    emptyAction: {
      marginTop: spacing.lg,
      height: 40,
      paddingHorizontal: 18,
      justifyContent: 'center',
      borderRadius: radii.pill,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    emptyActionLabel: {
      fontSize: 13.5,
      fontFamily: fonts.semibold,
      color: c.accent,
    },
  });
