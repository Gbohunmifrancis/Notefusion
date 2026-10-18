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
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useReducedMotion } from 'react-native-reanimated';
import { Screen } from '../components/Screen';
import { HeaderAvatar } from '../components/HeaderAvatar';
import { Touchable } from '../components/Touchable';
import { Skeleton } from '../components/Skeleton';
import { Mark, Wordmark } from '../components/night/NightUI';
import { DohCard } from '../components/doh/DohCard';
import { FoldAway } from '../components/FoldAway';
import { useSheetActions } from '../components/library/useSheetActions';
import { practiceApi } from '../api/endpoints';
import { toApiError } from '../api/client';
import { dohLetter } from '../lib/solfa';
import { loadLibraryList, loadSheet } from '../lib/offlineLibrary';
import { resultFromSaved } from '../lib/openSheet';
import { useAuth } from '../lib/auth';
import { showDialog } from '../lib/dialog';
import * as haptics from '../lib/haptics';
import { useSubscription } from '../lib/subscription';
import { confidenceColor, fonts, motion, radii, spacing, typography, type Palette, type Shadows } from '../design/theme';
import { useThemedStyles, useColors } from '../lib/theme';
import type { PracticeProgress, SavedTranscription } from '../api/types';
import { streakSnapshot } from '../lib/practiceProgress';
import { rememberStreak } from '../lib/practiceReminder';
import { refreshProfilePicture, useAccountJoinedAt } from '../lib/profilePicture';
import { useBreath } from '../lib/breath';
import type { RootStackParams, TabParams } from '../navigation/types';
import { solfaOpening } from '../lib/solfaOpening';
import { confidenceA11y, confidenceLevel } from '../lib/confidence';
import {
  EMPTY_DOH_MEMORY,
  chooseDohCard,
  dismissDohCard,
  localDay,
  type DohCard as DohSuggestion,
  type DohMemory,
} from '../lib/dohSuggestion';
import { loadDohMemory, saveDohMemory, useDohSuggestions } from '../lib/dohPrefs';
import { parseUtc } from '../lib/sheetMeta';

/** Home lists the newest few sheets. */
const RECENT_COUNT = 3;

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
 * recent sheet is known by its doh tile, its opening solfa and its confidence,
 * and its ⋯ (or a long press) opens its actions (board a-core/11). Under the
 * ways in, Doh's one suggestion card when there is something to suggest
 * (board c-practice/8a).
 */
export function HomeScreen({ navigation }: Props) {
  const rootNav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { user } = useAuth();
  const { isPro, known, freeRemaining, boughtRemaining, refresh: refreshSubscription } = useSubscription();
  const focused = useIsFocused();
  /** The whole library as last read: Recent shows its newest, and the folder choices come from all of it. */
  const [all, setAll] = useState<SavedTranscription[]>([]);
  /** The list has been read at least once (Doh's card waits for it). */
  const [listReady, setListReady] = useState(false);
  /** Sheets deleted from a recent row, folding away (board a-core/11). */
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const recent = all.slice(0, RECENT_COUNT);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [greeting, setGreeting] = useState(currentGreeting);
  /** The streak/XP chip's numbers; null hides the chip (not loaded, or the read failed). */
  const [practice, setPractice] = useState<PracticeProgress | null>(null);
  const styles = useThemedStyles(makeStyles);
  const colors = useColors();

  // ── Mic stage motion ──────────────────────────────────────────────────────
  /**
   * One driver, 0 → 1 → 0, feeding both the bloom's opacity and the circle's own
   * scale so they breathe as a single object rather than two things that happen
   * to share a duration.
   *
   * The breath is the app's one (`lib/breath`), shared with the tab bar's record
   * halo so the two swell together. It runs while Home is focused (Home stays
   * mounted for the whole session, so an ungated loop would keep waking the
   * native driver behind Library and Settings); Reduce Motion holds it still.
   */
  const reduceMotion = useReducedMotion();
  const breathe = useBreath(focused && !reduceMotion);
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

  // Reset and replay the entrance on every focus. Reduce motion: the content still
  // fades in (no slide, below), and the mic holds still (`useBreath` above).
  useFocusEffect(
    useCallback(() => {
      mountFade.setValue(0);
      const entrance = Animated.timing(mountFade, {
        toValue: 1,
        duration: 340,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      entrance.start();
      return () => entrance.stop();
    }, [mountFade]),
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

  /** The list as read: kept whole, and Doh's card may now be chosen. */
  const listRead = useCallback((items: SavedTranscription[]) => {
    setAll(items);
    setLeaving(new Set());
    setLoadError(null);
    setListReady(true);
  }, []);

  const reload = useCallback(() => {
    setLoadingRecent(true);
    loadLibraryList()
      .then(({ items }) => listRead(items))
      .catch((e) => setLoadError(toApiError(e).message))
      .finally(() => setLoadingRecent(false));
  }, [listRead]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        loadLibraryList()
          .then(({ items }) => listRead(items))
          .catch((e) => setLoadError(toApiError(e).message)),
        user ? refreshProfilePicture(user.id, true) : undefined,
        refreshSubscription(true).catch(() => undefined),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [listRead, refreshSubscription, user]);

  /** Counts Home's visits, so Doh's card is chosen again on each (the hour and the day move on). */
  const [visit, setVisit] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setGreeting(currentGreeting());
      setVisit((v) => v + 1);
      practiceApi
        .progress()
        .then((p) => {
          if (!active) return;
          setPractice(p);
          void rememberStreak(streakSnapshot(p));
        })
        .catch(() => undefined);
      setLoadingRecent(true);
      loadLibraryList()
        .then(({ items }) => {
          if (active) listRead(items);
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
    }, [listRead]),
  );

  // ── Doh's card (board c-practice/8a) ──────────────────────────────────────
  // One card at most, chosen by lib/dohSuggestion from the list, the streak, the account's age and the free count,
  // once those are read; × and "once a day" are remembered on the phone, per account. Settings can turn it off.
  const dohOn = useDohSuggestions();
  const joinedAt = useAccountJoinedAt(user?.id);
  const freeLeft = known && !isPro ? freeRemaining : null;
  const canTranscribe = !known || isPro || freeRemaining > 0 || boughtRemaining > 0;
  const [card, setCard] = useState<DohSuggestion | null>(null);
  const [cardGoing, setCardGoing] = useState(false);
  const dohMemory = useRef<DohMemory>(EMPTY_DOH_MEMORY);
  const [memoryFor, setMemoryFor] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    void loadDohMemory(user.id).then((m) => {
      if (!live) return;
      dohMemory.current = m;
      setMemoryFor(user.id);
    });
    return () => {
      live = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!dohOn || !user || memoryFor !== user.id || !listReady || !practice) return;
    const now = new Date();
    const { card: next, memory } = chooseDohCard(
      {
        now: now.getTime(),
        hour: now.getHours(),
        day: localDay(now),
        sheets: all.map((s) => ({ id: s.id, title: s.title, savedAt: parseUtc(s.createdAtUtc) })),
        streak: practice.streak,
        joinedAt,
        freeLeft,
        canTranscribe,
      },
      dohMemory.current,
    );
    dohMemory.current = memory;
    void saveDohMemory(user.id, memory);
    setCard(next);
    // `visit` is read for its change alone: every return to Home chooses again.
  }, [dohOn, user, memoryFor, listReady, practice, all, joinedAt, freeLeft, canTranscribe, visit]);

  /** × or the card's action: it leaves Home, and does not come back for this context. */
  function putCardAway(c: DohSuggestion) {
    if (!user) return;
    dohMemory.current = dismissDohCard(dohMemory.current, c.key, localDay(new Date()));
    void saveDohMemory(user.id, dohMemory.current);
    setCard(null);
    setCardGoing(false);
  }

  function actOnCard(c: DohSuggestion) {
    putCardAway(c);
    if (c.kind === 'ready') {
      const sheet = all.find((s) => s.id === c.sheetId);
      if (sheet) void openRecent(sheet, { practise: true });
    } else if (c.kind === 'streak') {
      navigation.navigate('Practice');
    } else {
      navigation.navigate('Record');
    }
  }

  // ── Recent sheets' actions (board a-core/11) ─────────────────────────────
  // The Library's own actions on one sheet; a deleted row folds away before it leaves the list.
  const sheetActions = useSheetActions({
    items: all,
    setItems: setAll,
    reload,
    onDeleted: (ids) => setLeaving(new Set(ids)),
  });

  async function openRecent(item: SavedTranscription, opts: { practise?: boolean } = {}) {
    try {
      // The phone's copy when it is current or the API is out of reach (lib/offlineLibrary).
      const { sheet } = await loadSheet(item);
      rootNav.navigate('Result', {
        result: resultFromSaved(sheet),
        savedId: sheet.id,
        title: sheet.title,
        practise: opts.practise,
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
        extraData={[leaving, sheetActions.actionsFor]}
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
                {/* Practice: the streak and XP, a tap from the Practice tab. */}
                {practice ? (
                  <Touchable
                    onPress={() => navigation.navigate('Practice')}
                    style={styles.practiceChip}
                    radius={radii.pill}
                    accessibilityLabel={`Practice: ${practice.streak.current}-day streak, ${practice.xp} XP, level ${practice.level.name}`}
                  >
                    <Ionicons
                      name={practice.streak.current > 0 ? 'flame' : 'flame-outline'}
                      size={15}
                      color={practice.streak.current > 0 ? colors.play : colors.textMuted}
                    />
                    <Text style={styles.practiceChipText}>{practice.streak.current}</Text>
                    <View style={styles.practiceChipDivider} />
                    <Text style={styles.practiceChipText}>{practice.xp} XP</Text>
                  </Touchable>
                ) : null}
                {/* The account, as on every tab: the avatar (Pro's gold ring) opens Profile. */}
                <HeaderAvatar />
              </View>
            </View>

            <Animated.View
              style={{
                opacity: mountOpacity,
                transform: [{ translateY: reduceMotion ? 0 : mountTranslate }],
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
                  onPress={() => navigation.navigate('Record', { autoPickAudio: true })}
                  style={styles.chip}
                  radius={radii.pill}
                  accessibilityLabel="Import audio file"
                >
                  <Ionicons name="download-outline" size={17} color={colors.accent} />
                  <Text style={styles.chipLabel}>Import</Text>
                </Touchable>
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
                  onPress={() => rootNav.navigate('Listen')}
                  style={styles.chip}
                  radius={radii.pill}
                  accessibilityLabel="Find the key of a song that is playing"
                >
                  <Ionicons name="radio-outline" size={17} color={colors.accent} />
                  <Text style={styles.chipLabel}>Find key</Text>
                </Touchable>
              </View>

              {/* ── Doh's one suggestion, under the ways in: the record button stays the hero ── */}
              {dohOn && card ? (
                <FoldAway key={card.key} gone={cardGoing} onGone={() => putCardAway(card)}>
                  <DohCard
                    card={card}
                    hop
                    active={focused}
                    onAction={() => actOnCard(card)}
                    onClose={() => setCardGoing(true)}
                  />
                </FoldAway>
              ) : null}

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
          // No percentage on a row: a tone dot, and only when the sheet is worth a second look.
          const doubtful = confidenceLevel(item.overallConfidence) !== 'clear';
          const tone = confidenceColor(item.overallConfidence, colors);
          return (
            <FoldAway
              gone={leaving.has(item.id)}
              onGone={() => setAll((prev) => prev.filter((s) => s.id !== item.id))}
            >
              <Touchable
                onPress={() => openRecent(item)}
                onLongPress={() => {
                  haptics.play('light');
                  sheetActions.openActions(item);
                }}
                style={[styles.recentRow, sheetActions.actionsFor?.id === item.id && styles.recentRowActive]}
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

                {doubtful ? (
                  <View style={styles.score} accessibilityLabel={confidenceA11y(item.overallConfidence)}>
                    <View style={[styles.scoreDot, { backgroundColor: tone }]} />
                  </View>
                ) : null}

                {/* The piece's actions: share, rename, file, keep offline, delete (also a long press). */}
                <Touchable
                  onPress={() => sheetActions.openActions(item)}
                  style={styles.more}
                  ripple="borderless"
                  accessibilityLabel={`More for ${item.title}`}
                >
                  <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
                </Touchable>
              </Touchable>
            </FoldAway>
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
      {sheetActions.element}
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
    practiceChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      height: 32,
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    practiceChipText: {
      ...typography.caption,
      fontFamily: fonts.semibold,
      color: c.text,
    },
    practiceChipDivider: {
      width: 1,
      height: 12,
      backgroundColor: c.border,
      marginHorizontal: 2,
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
    /** The row whose actions are open: a faint tint under the sheet, so it is plain which piece they act on. */
    recentRowActive: {
      backgroundColor: c.surfaceAlt,
      marginHorizontal: -spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.md,
    },
    /** The ⋯ at the row's end: a 44 px target, flush with the screen's edge. */
    more: {
      width: 44,
      height: 44,
      marginRight: -12,
      alignItems: 'center',
      justifyContent: 'center',
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
