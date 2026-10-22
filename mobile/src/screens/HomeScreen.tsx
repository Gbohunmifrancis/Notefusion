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
import { useFocusEffect, useIsFocused, useNavigation, useScrollToTop } from '@react-navigation/native';
import { Icon } from '../components/Icon';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useReducedMotion } from 'react-native-reanimated';
import { Screen } from '../components/Screen';
import { HeaderAvatar } from '../components/HeaderAvatar';
import { Touchable } from '../components/Touchable';
import { Button } from '../components/Button';
import { ProblemNote } from '../components/ProblemNote';
import { Mark, Wordmark } from '../components/night/NightUI';
import { DohCard } from '../components/doh/DohCard';
import { FoldAway } from '../components/FoldAway';
import { useSheetActions } from '../components/library/useSheetActions';
import { LibraryRow, LibraryRowSkeleton } from '../components/library/LibraryRow';
import { libraryApi, practiceApi } from '../api/endpoints';
import { toApiError } from '../api/client';
import { loadLibraryList, loadSheet } from '../lib/offlineLibrary';
import { withoutHeldDeletes } from '../lib/sheetActions';
import { exampleResult, savedSheetParams } from '../lib/openSheet';
import { EXAMPLE_HYMN, offerExample } from '../lib/exampleSheet';
import { useOpening } from '../lib/useOpening';
import { useAuth } from '../lib/auth';
import { showDialog } from '../lib/dialog';
import { withBusy } from '../lib/busy';
import * as haptics from '../lib/haptics';
import { useSubscription } from '../lib/subscription';
import { fonts, motion, radii, spacing, typography, type Palette, type Shadows } from '../design/theme';
import { useThemedStyles, useColors } from '../lib/theme';
import type { PracticeProgress, SavedTranscription } from '../api/types';
import { streakSnapshot, xpAmount } from '../lib/practiceProgress';
import { rememberStreak } from '../lib/practiceReminder';
import { refreshProfilePicture, useAccountJoinedAt } from '../lib/profilePicture';
import { useBreath } from '../lib/breath';
import type { RootStackParams, TabParams } from '../navigation/types';
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
import { REFRESH_FAILED, isUnopened } from '../lib/savedSheet';
import { PROGRESS_WAIT_MS, recentReveal, type RecentReveal } from '../lib/homeReveal';
import { useSeason } from '../lib/seasonStore';
import { activeSeason, costumeOf, homeTitle, seasonTint, seasonWords } from '../lib/season';
import { Snowfall } from '../components/season/Snowfall';
import { Bats } from '../components/season/Bats';

/**
 * Home's few flakes or bats play once a session (Home stays mounted as a tab; coming back to it is not a new
 * snowfall or a new flight).
 */
let homeSkyPlayed = false;

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
 * (board c-practice/8a), which arrives with Recent's rows and never after them
 * (board m-ux-medium P2f, lib/homeReveal).
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
  /** The list has answered at least once, rows or an error: Recent's skeleton waits for it. */
  const [listIn, setListIn] = useState(false);
  /** The practice progress has answered at least once (Doh's card is chosen from it). */
  const [progressIn, setProgressIn] = useState(false);
  /** 1.5 s since Home first asked: the rows stop waiting for the progress, and show without the card. */
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), PROGRESS_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  const recent = all.slice(0, RECENT_COUNT);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [greeting, setGreeting] = useState(currentGreeting);
  /** The streak/XP chip's numbers; null hides the chip (not loaded, or the read failed). */
  const [practice, setPractice] = useState<PracticeProgress | null>(null);
  const styles = useThemedStyles(makeStyles);
  const colors = useColors();

  // ── The season (boards d-christmas/02, j-halloween/02), only while one is on: its costume on the header's mark (the
  // cap, the witch hat), the question, one chip (Carols, Spooky songs) and a few flakes or bats over the top third,
  // once a session. Off, Home is exactly as it was.
  const seasonFlag = useSeason();
  const season = activeSeason(seasonFlag);
  const costume = costumeOf(season);
  const tint = season ? seasonTint(colors, season) : null;
  const [skyNow, setSkyNow] = useState(false);
  useEffect(() => {
    if (!season || !focused || homeSkyPlayed) return;
    homeSkyPlayed = true;
    setSkyNow(true);
  }, [season, focused]);

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
    // Reduce Motion: no ring growing out of the circle; the press itself and its tick still answer the finger.
    if (reduceMotion) return;
    ring.setValue(0);
    Animated.timing(ring, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [ring, reduceMotion]);

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
    // A sheet whose delete is still held behind its Undo stays out (lib/sheetActions).
    setAll(withoutHeldDeletes(items));
    setLoadError(null);
    setListReady(true);
    setListIn(true);
  }, []);

  /** The list could not be read: Recent says so (it has answered). */
  const listFailed = useCallback((e: unknown) => {
    setLoadError(toApiError(e).message);
    setListIn(true);
  }, []);

  const reload = useCallback(() => {
    setLoadingRecent(true);
    loadLibraryList()
      .then(({ items }) => listRead(items))
      .catch(listFailed)
      .finally(() => setLoadingRecent(false));
  }, [listRead, listFailed]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        loadLibraryList()
          .then(({ items }) => listRead(items))
          .catch(listFailed),
        user ? refreshProfilePicture(user.id, true) : undefined,
        refreshSubscription(true).catch(() => undefined),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [listRead, listFailed, refreshSubscription, user]);

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
        .catch(() => undefined)
        .finally(() => {
          if (active) setProgressIn(true);
        });
      setLoadingRecent(true);
      loadLibraryList()
        .then(({ items }) => {
          if (active) listRead(items);
        })
        .catch((e) => {
          if (active) listFailed(e);
        })
        .finally(() => {
          if (active) setLoadingRecent(false);
        });
      return () => {
        active = false;
      };
    }, [listRead, listFailed]),
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

  // ── Recent and the card arrive together (board m-ux-medium P2f) ───────────
  // Recent keeps its skeleton until the list and what the card is chosen from have both answered, then the rows and
  // the card fade in together; a progress that has not answered in 1.5 s lets the rows show alone.
  const phase = recentReveal({
    listIn,
    cardIn: !dohOn || !user || (progressIn && memoryFor === user.id),
    timedOut,
  });
  /** Latched: once Recent has shown its rows it never goes back to the skeleton. */
  const [revealed, setRevealed] = useState<Exclude<RecentReveal, 'wait'> | null>(null);
  /** The visit the rows were shown on. */
  const revealVisit = useRef(0);
  useEffect(() => {
    if (revealed || phase === 'wait') return;
    revealVisit.current = visit;
    setRevealed(phase);
  }, [phase, revealed, visit]);
  /** 0 → 1 over 200 ms as the rows and the card arrive; no movement, so Reduce Motion keeps it. */
  const revealFade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!revealed) return;
    Animated.timing(revealFade, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [revealed, revealFade]);

  /**
   * The visit Doh's card was last chosen for. It is chosen once a visit — as the rows arrive on the first, on
   * arriving (from what was read before) on every later one — and never once the rows are on screen, so it never
   * pushes them down under a thumb.
   */
  const cardVisit = useRef(0);
  useEffect(() => {
    if (!revealed || cardVisit.current === visit) return;
    cardVisit.current = visit;
    // The rows came without it (the progress was late): it waits for the next visit.
    const late = revealed === 'rows' && revealVisit.current === visit;
    if (late || !dohOn || !user || memoryFor !== user.id || !listReady || !practice) {
      setCard(null);
      return;
    }
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
    // Read when `revealed` or `visit` changes: every return to Home chooses again, once.
  }, [revealed, visit, dohOn, user, memoryFor, listReady, practice, all, joinedAt, freeLeft, canTranscribe]);

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
  // The Library's own actions on one sheet; a deleted row folds away, held behind its Undo (board m-ux-medium P2a).
  const sheetActions = useSheetActions({
    items: all,
    setItems: setAll,
    reload,
  });

  /** The sheet loading: a second tap meanwhile would push a second Result; its row says "Opening…" after 300 ms. */
  const opening = useOpening();
  // Tapping Home again while on it scrolls back to the top.
  const listRef = useRef<FlatList<SavedTranscription>>(null);
  useScrollToTop(listRef);

  async function openRecent(item: SavedTranscription, opts: { practise?: boolean } = {}) {
    if (!opening.begin(item.id)) return;
    // Opened: a sheet the server filed loses its blue dot here and on the server, as it does from the Library.
    if (isUnopened(item)) {
      const openedAtUtc = new Date().toISOString();
      setAll((list) => list.map((i) => (i.id === item.id ? { ...i, openedAtUtc } : i)));
      void libraryApi.markOpened(item.id).catch(() => undefined);
    }
    try {
      // The phone's copy when it is current or the API is out of reach (lib/offlineLibrary).
      // A row says "Opening…" itself; a sheet opened from Doh's card may have no row on Home, and gets the card.
      const onHome = recent.some((r) => r.id === item.id);
      const { sheet } = await (onHome ? loadSheet(item) : withBusy('Opening…', () => loadSheet(item)));
      rootNav.navigate('Result', { ...savedSheetParams(sheet), practise: opts.practise });
    } catch (e) {
      showDialog({
        title: 'Could not open',
        message: toApiError(e).message,
        icon: 'problem',
        tone: 'danger',
      });
    } finally {
      opening.end();
    }
  }

  /** "See an example" (board n-ux-low Q4j): the bundled Amazing Grace on Result, not filed and nothing spent. */
  function openExample() {
    rootNav.navigate('Result', { result: exampleResult(), title: EXAMPLE_HYMN.title, example: true });
  }

  const firstName = user?.fullName?.split(' ')[0] ?? 'there';

  return (
    <Screen>
      <FlatList
        ref={listRef}
        data={revealed ? recent : []}
        extraData={[sheetActions.folding, sheetActions.actionsFor, opening.opening]}
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
            {skyNow && season === 'christmas' ? <Snowfall run seed={7} color={colors.snow} style={styles.sky} /> : null}
            {skyNow && season === 'halloween' ? <Bats run seed={7} color={colors.bat} style={styles.sky} /> : null}
            {/* ── Top bar: the lock-up left, the account right ───────────── */}
            <View style={styles.topHeader}>
              <View style={styles.lockup} accessible accessibilityLabel="Notefusion">
                <Mark height={24} color={colors.text} costume={costume} />
                <Wordmark size={19} style={{ color: colors.text }} />
              </View>

              <View style={styles.headerActions}>
                {/* Practice: the streak and XP, a tap from the Practice tab. */}
                {practice ? (
                  <Touchable
                    onPress={() => navigation.navigate('Practice')}
                    style={styles.practiceChip}
                    radius={radii.pill}
                    // A 32 px chip, 48 tall to a thumb; less to the sides, where the avatar is.
                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                    accessibilityLabel={`Practice: ${practice.streak.current}-day streak, ${xpAmount(practice.xp)}, level ${practice.level.name}`}
                  >
                    <Icon
                      name="streak"
                      size={15}
                      color={practice.streak.current > 0 ? colors.play : colors.textMuted}
                    />
                    <Text style={styles.practiceChipText}>{practice.streak.current}</Text>
                    <View style={styles.practiceChipDivider} />
                    <Text style={styles.practiceChipText}>{xpAmount(practice.xp)}</Text>
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
                    <Icon name="pro" size={11} color={colors.premiumDeep} />
                    <Text style={styles.proChipText}>PRO</Text>
                  </View>
                )}
              </View>
              <Text style={styles.title} accessibilityRole="header">
                {homeTitle(seasonFlag)}
              </Text>

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
                  // 40 px chips 8 apart: half the gap each way makes every one a 48 dp target.
                  hitSlop={4}
                  accessibilityLabel="Import audio file"
                >
                  <Icon name="import" size={18} color={colors.icon} />
                  <Text style={styles.chipLabel}>Import</Text>
                </Touchable>
                <Touchable
                  onPress={() => rootNav.navigate('Link')}
                  style={styles.chip}
                  radius={radii.pill}
                  hitSlop={4}
                  accessibilityLabel="Paste a song link"
                >
                  <Icon name="link" size={18} color={colors.icon} />
                  <Text style={styles.chipLabel}>Paste link</Text>
                </Touchable>
                {/* The season's one chip: its songs on top of Hymns (a pine or pumpkin tint, never a second accent). */}
                {season && tint ? (
                  <Touchable
                    onPress={() => navigation.navigate('Hymns', { shelf: true })}
                    style={[styles.chip, { backgroundColor: tint.soft, borderColor: tint.line }]}
                    radius={radii.pill}
                    hitSlop={4}
                    accessibilityLabel={seasonWords(season).chipLabel}
                  >
                    <Icon name={seasonWords(season).icon} size={18} color={tint.label} />
                    <Text style={[styles.chipLabel, { color: tint.label }]}>{seasonWords(season).chip}</Text>
                  </Touchable>
                ) : null}
                <Touchable
                  onPress={() => rootNav.navigate('Listen')}
                  style={styles.chip}
                  radius={radii.pill}
                  hitSlop={4}
                  accessibilityLabel="Find the key of a song that is playing"
                >
                  <Icon name="find-key" size={18} color={colors.icon} />
                  <Text style={styles.chipLabel}>Find key</Text>
                </Touchable>
              </View>

              {/* ── Doh's one suggestion, under the ways in: the record button stays the hero ── */}
              {dohOn && card ? (
                <Animated.View style={{ opacity: revealFade }}>
                  <FoldAway key={card.key} gone={cardGoing} onGone={() => putCardAway(card)}>
                    <DohCard
                      card={card}
                      hop
                      active={focused}
                      onAction={() => actOnCard(card)}
                      onClose={() => setCardGoing(true)}
                    />
                  </FoldAway>
                </Animated.View>
              ) : null}

              {/* ── Recent ────────────────────────────────────────────── */}
              <View style={styles.recentSectionHeader}>
                <Text style={styles.recentSectionTitle} accessibilityRole="header">
                  Recent
                </Text>
                {/* The app's text button, as Hymns' "See all" (board n-ux-low Q4e). */}
                <Button
                  label="See all"
                  variant="text"
                  size="sm"
                  onPress={() => navigation.navigate('Library')}
                  style={styles.seeAll}
                  accessibilityLabel="See all your sheets"
                />
              </View>
              {/* A read that failed over rows already shown: said, so they are not taken for the latest. */}
              {loadError && revealed && recent.length > 0 ? (
                <ProblemNote style={styles.refreshNote}>{REFRESH_FAILED}</ProblemNote>
              ) : null}
            </Animated.View>
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          // The Library's own row, brief: the title and its opening, the ⋯ (also a long press), "Opening…" while it
          // loads (board n-ux-low Q4d).
          <Animated.View style={{ opacity: revealFade }}>
            <FoldAway {...sheetActions.foldProps(item.id)}>
              <LibraryRow
                item={item}
                brief
                selecting={false}
                selected={false}
                onPress={() => void openRecent(item)}
                onLongPress={() => {
                  haptics.play('light');
                  sheetActions.openActions(item);
                }}
                opening={opening.opening === item.id}
                active={sheetActions.actionsFor?.id === item.id}
                onMore={() => sheetActions.openActions(item)}
              />
            </FoldAway>
          </Animated.View>
        )}
        ListEmptyComponent={
          !revealed || loadingRecent ? (
            <View>
              {[0, 1, 2].map((i) => (
                <LibraryRowSkeleton key={i} brief />
              ))}
            </View>
          ) : loadError ? (
            <View style={styles.empty}>
              <Icon name="offline" size={26} color={colors.textMuted} />
              <Text style={styles.emptyText}>{loadError}</Text>
              <Button label="Try again" variant="secondary" onPress={reload} style={styles.emptyButton} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Mark height={34} color={colors.textFaint} />
              <Text style={styles.emptyText}>
                Your sheets land here. Hum a line and see it in solfa.
              </Text>
              <Button
                label="Record your first tune"
                variant="secondary"
                onPress={() => navigation.navigate('Record')}
                style={styles.emptyButton}
              />
              {/* What the app makes, before the first sheet (board n-ux-low Q4j): Amazing Grace, nothing filed. */}
              {offerExample(all.length) ? (
                <Button label="See an example" variant="text" size="sm" onPress={openExample} style={styles.exampleButton} />
              ) : null}
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
      // The app's smallest words: 12, never under (it was 9.5), the size of the greeting beside it.
      fontSize: 12,
      fontFamily: fonts.bold,
      color: c.premiumText,
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
    /** The season's flakes or bats over the top third of Home, behind the content and never touchable. */
    sky: { top: -spacing.lg, left: -spacing.lg, right: -spacing.lg, height: 300 },

    // ── Recent ────────────────────────────────────────────────────────────────
    // "Recent" and its "See all", whose 40 px text button sets the row's height (it was a 22 px word with slop).
    recentSectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 19,
    },
    /** The text button's own padding stepped out to the gutter, so "See all" ends where the rows do. */
    seeAll: {
      marginRight: -12,
    },
    refreshNote: {
      marginTop: 0,
      marginBottom: spacing.sm,
    },
    recentSectionTitle: {
      fontSize: 17,
      fontFamily: fonts.semibold,
      letterSpacing: -0.3,
      color: c.text,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
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
    emptyButton: {
      marginTop: spacing.lg,
    },
    exampleButton: {
      marginTop: spacing.xs,
    },
  });
