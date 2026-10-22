import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  FlatList,
  PixelRatio,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type SectionListData,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../components/Icon";
import { useFocusEffect, useNavigation, useRoute, useScrollToTop, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Button } from "../components/Button";
import { Sheet, SheetActions, SheetTitle } from "../components/Sheet";
import { Card } from "../components/Card";
import { Touchable } from "../components/Touchable";
import { Skeleton } from "../components/Skeleton";
import { TabHeader } from "../components/TabHeader";
import { LetterRail, RAIL_WIDTH } from "../components/LetterRail";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import {
  filterHalloween,
  fold,
  formatBytes,
  hymnSheet,
  isAllSaints,
  keyAndTime,
  needsDownload,
  openingLine,
  searchHymns,
  seasonShelf,
  titleKey,
  type HalloweenFilter,
  type HymnPack,
  type PackHymn,
  type PackMeta,
} from "../lib/hymnPack";
import { letterSections, sectionCellLayouts, type LetterSection } from "../lib/letterIndex";
import { checkRemotePack, downloadPack, installedPack, remotePackMeta, removePack, usePackState } from "../lib/hymnPackStore";
import { resultFromHymn } from "../lib/openSheet";
import { HYMN_PREVIEW, previewOpacity } from "../lib/hymnPreview";
import { deriveSolfa } from "../lib/solfa";
import { useDataSaver } from "../lib/dataSaver";
import { useSeason } from "../lib/seasonStore";
import { activeSeason, seasonTint, seasonWords } from "../lib/season";
import { showDialog } from "../lib/dialog";
import { withBusy } from "../lib/busy";
import { showToast } from "../lib/toast";
import { logAnalyticsEvent } from "../lib/analytics";
import type { RootStackParams, TabParams } from "../navigation/types";

/** The letter rail's gap from the screen's edge, and the room the list leaves it (the rows end 3 px short of it). */
const RAIL_INSET = 10;
const RAIL_ROOM = RAIL_INSET + RAIL_WIDTH + 3;
/**
 * The rail's foot over the list's: clear of the floating tab bar (64 tall, 4 over the bottom inset) with 8 to spare,
 * less the 24 the screen keeps under the list. The inset is added where it is known.
 */
const RAIL_BOTTOM = 64 + spacing.xs + spacing.sm - spacing.xl;

/** A hymn's group: its letter (none for a search's matches) and its rows. */
type HymnSection = SectionListData<PackHymn, LetterSection<PackHymn>>;

/**
 * Hymns — the website's public-domain hymns and tunes, from the offline pack: download once, then
 * browse, search and open any of them as a sheet (play, solfa, staff, practise) with no connection.
 * Until the pack is on the phone the screen offers the download and its size; once it is, a newer
 * version is looked for weekly (off data saver) or when "Check for updates" is tapped. A tab (board a-core/04):
 * the offline book people come back to; "Remove from this phone" is at the foot of the list. With nothing typed the
 * book reads A to Z under sticky letters, with a letter rail down the right edge (board n-ux-low Q4l).
 */
export function HymnsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const packState = usePackState();
  const dataSaver = useDataSaver();
  const insets = useSafeAreaInsets();

  const [pack, setPack] = useState<HymnPack | null>(null);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<PackMeta | null>(null);
  /** The website has answered for the pack's size (or could not): the offer's size line stops waiting for it. */
  const [metaIn, setMetaIn] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<PackHymn | null>(null);

  // ── The season (boards d-christmas/02, j-halloween/02), only while one is on: a shelf above the list ("Carols for
  // Christmas", "Songs for Halloween"), each card opening with its first notes in solfa; "See all" narrows the list to
  // the shelf (Halloween's as a grid, with All / Spooky / All Saints). Home's season chip opens the screen at the top,
  // on the shelf.
  const route = useRoute<RouteProp<TabParams, "Hymns">>();
  const season = activeSeason(useSeason());
  const tint = season ? seasonTint(colors, season) : null;
  const words = season ? seasonWords(season) : null;
  const [shelfOnly, setShelfOnly] = useState(false);
  const [filter, setFilter] = useState<HalloweenFilter>("all");
  /** Halloween's "See all" grid, and every other list (the book, a search, the carols' "See all"). */
  const gridList = useRef<FlatList<PackHymn>>(null);
  const sectionList = useRef<SectionList<PackHymn, LetterSection<PackHymn>>>(null);
  function listToTop(animated: boolean) {
    gridList.current?.scrollToOffset({ offset: 0, animated });
    sectionList.current?.getScrollResponder()?.scrollTo({ y: 0, animated });
  }
  // Tapping Hymns again while on it scrolls back to the top, whichever list is showing.
  const toTop = useRef({ scrollToTop: () => listToTop(true) });
  useScrollToTop(toTop);
  const shelfList = useMemo(() => (pack && season ? seasonShelf(pack.hymns, season) : []), [pack, season]);
  const openings = useMemo(
    () => new Map(shelfList.map((h) => [h.slug, openingLine(deriveSolfa(hymnSheet(h).notes, h.key, h.time).notes)])),
    [shelfList],
  );
  const showShelf = !!season && !shelfOnly && !query && shelfList.length > 0;
  /** Halloween's "See all" is a two-column grid of cards. */
  const grid = season === "halloween" && shelfOnly;

  useEffect(() => {
    if (!route.params?.shelf) return;
    setQuery("");
    setShelfOnly(false);
    listToTop(false);
    navigation.setParams({ shelf: undefined } as never);
  }, [route.params?.shelf, navigation]);

  // Android back closes the season's "See all", then clears the search, before it leaves the tab.
  useFocusEffect(
    useCallback(() => {
      if (!shelfOnly && !query) return undefined;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (shelfOnly) setShelfOnly(false);
        else setQuery("");
        return true;
      });
      return () => sub.remove();
    }, [shelfOnly, query]),
  );

  // The season ending (or changing) mid-session takes its filter with it.
  useEffect(() => {
    setShelfOnly(false);
    setFilter("all");
  }, [season]);

  useEffect(() => {
    let live = true;
    void installedPack().then((p) => {
      if (!live) return;
      setPack(p);
      setLoading(false);
      // Before a download, the count and size under the button come from the website (130 bytes).
      if (!p) void askMeta(() => live);
    });
    return () => {
      live = false;
    };
  }, []);

  /** The pack's count and size from the website, for the offer's size line; `live` says the screen still wants it. */
  async function askMeta(live: () => boolean) {
    const m = await remotePackMeta();
    if (!live()) return;
    setMeta(m);
    setMetaIn(true);
  }

  // A tab stays mounted: follow the pack when it changes underneath (the weekly refresh, a removal).
  useEffect(() => {
    if (loading || (pack?.version ?? null) === packState.version) return undefined;
    let live = true;
    void installedPack().then((p) => {
      if (!live) return;
      setPack(p);
      if (!p) void askMeta(() => live);
    });
    return () => {
      live = false;
    };
    // `pack` is read, not followed: only a change in what is installed starts a re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packState.version, loading]);

  const results = useMemo(() => {
    if (!pack) return [];
    if (shelfOnly) {
      const shown = season === "halloween" ? filterHalloween(shelfList, filter) : shelfList;
      return query ? searchHymns(shown, query) : shown;
    }
    return searchHymns(pack.hymns, query);
  }, [pack, query, shelfOnly, shelfList, season, filter]);

  // ── A to Z (board n-ux-low Q4l) ───────────────────────────────────────────
  // The whole book with nothing typed: under sticky letters, with the rail. A search's matches, and a season's
  // "See all", are one group without a letter. The book's rows keep the rail's room while a search is typed, so they
  // do not shift as the first letter goes in.
  const book = !shelfOnly;
  const lettered = book && !fold(query);
  const sections = useMemo<HymnSection[]>(() => {
    if (results.length === 0) return [];
    if (!lettered) return [{ letter: "", data: results, key: "matches" }];
    return letterSections(results, (h) => titleKey(h.title)).map((s) => ({ ...s, key: s.letter }));
  }, [lettered, results]);

  // Every row is drawn the same height (its divider inside it, its lines a fixed height), and every letter's header
  // too, so the list knows where each letter starts before the rows on the way are drawn: measured once, then counted.
  // A row and a header are measured only until known (again when the text size changes): measuring every row as it
  // scrolled in let a fraction of a pixel's difference rebuild the whole layout mid-scroll, and the list jumped.
  const { fontScale } = useWindowDimensions();
  const [metrics, setMetrics] = useState({ top: 0, header: 0, row: 0 });
  useEffect(() => setMetrics((m) => (m.header || m.row ? { ...m, header: 0, row: 0 } : m)), [fontScale]);
  const measure = (key: keyof typeof metrics) => (e: LayoutChangeEvent) => {
    const h = PixelRatio.roundToNearestPixel(e.nativeEvent.layout.height);
    setMetrics((m) => (Math.abs(m[key] - h) < 0.5 ? m : { ...m, [key]: h }));
  };
  const cells = useMemo(
    () =>
      lettered && metrics.top > 0 && metrics.header > 0 && metrics.row > 0
        ? sectionCellLayouts(
            sections.map((s) => s.data.length),
            metrics,
          )
        : null,
    [lettered, sections, metrics],
  );
  /** Where the rail starts: under the header and the search, where the first letter sits before any scrolling. */
  const [railTop, setRailTop] = useState(0);

  function jumpTo(sectionIndex: number) {
    sectionList.current?.scrollToLocation({ sectionIndex, itemIndex: 0, viewOffset: 0, animated: false });
  }

  async function download(expected?: PackMeta | null) {
    setProgress(0);
    try {
      const next = await downloadPack(setProgress, expected?.bytes ?? meta?.bytes);
      setPack(next);
    } catch (e) {
      showDialog({
        title: "Couldn't download the hymns",
        message: e instanceof Error && /room|read/.test(e.message) ? e.message : "Check your connection and try again.",
        icon: "offline",
        tone: "danger",
      });
    } finally {
      setProgress(null);
    }
  }

  async function checkForUpdate() {
    setChecking(true);
    const check = await checkRemotePack();
    setChecking(false);
    if (!("meta" in check)) {
      showDialog(
        check.problem === "offline"
          ? { title: "You're offline", message: "The hymns on your phone still work. Check again when you're online.", icon: "offline" }
          : { title: "Couldn't check for new hymns", message: "The hymns on your phone still work. Please try again later.", icon: "problem" },
      );
      return;
    }
    const remote = check.meta;
    if (!needsDownload(packState.version, remote)) {
      showToast(`Up to date: every hymn we publish (${remote.count})`);
      return;
    }
    showDialog({
      title: "Newer hymns available",
      message: `Download the updated hymns (${formatBytes(remote.bytes)})?`,
      icon: "keep-offline",
      actions: [
        { label: "Download", icon: "keep-offline", onPress: () => void download(remote) },
        { label: "Not now", style: "cancel" },
      ],
    });
  }

  function confirmRemove() {
    showDialog({
      title: "Remove the hymns?",
      message: `Frees ${formatBytes(packState.bytes)}. You can download them again here at any time.`,
      // They download again, so nothing is lost: no red.
      actions: [
        {
          label: "Remove",
          onPress: () =>
            void withBusy("Removing…", () => removePack()).then(() => {
              setPack(null);
              setQuery("");
              void askMeta(() => true);
            }),
        },
        { label: "Keep them", style: "cancel" },
      ],
    });
  }

  function openSheet(h: PackHymn) {
    setOpen(null);
    void logAnalyticsEvent("hymn_opened", { slug: h.slug, kind: h.kind });
    navigation.navigate("Result", { result: resultFromHymn(h), title: h.title });
  }

  const header = <TabHeader title="Hymns" eyebrow={pack ? `${pack.count} hymns and tunes · offline` : "Hymnbook"} />;

  if (loading) {
    return (
      <Screen>
        {header}
        {/* The pack is read from the phone: the list's shape holds its place meanwhile, as the Library's rows do. */}
        <View accessible accessibilityLabel="Loading the hymns">
          <Skeleton height={44} radius={22} style={styles.searchSkeleton} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={styles.row}>
              <View style={styles.rowText}>
                <Skeleton width="62%" height={14} radius={radii.sm} />
                <Skeleton width="44%" height={11} radius={radii.sm} style={styles.skeletonGap} />
              </View>
              <Skeleton width={42} height={12} radius={radii.sm} />
            </View>
          ))}
        </View>
      </Screen>
    );
  }

  if (!pack) {
    // The sentence and the button never change (board n-ux-low Q4k): the count and the size arrive on a line of their
    // own under the button, its height held by a skeleton until the website answers, so nothing re-wraps or is cut.
    return (
      <Screen scroll contentStyle={styles.tabBarRoom}>
        {header}
        <Card style={styles.card}>
          <View style={styles.offerIcon}>
            <Icon name="hymns" size={24} color={colors.icon} />
          </View>
          <Text style={styles.offerTitle}>Hymns you can use anywhere</Text>
          <Text style={styles.offerBody}>
            Public-domain hymns and tunes in Tonic Solfa and staff, with the words and a piano. Download them once and
            they work with no data at all.
          </Text>
          {progress !== null ? (
            <View style={styles.progressBlock} accessibilityLabel={`Downloading, ${Math.round(progress * 100)} percent`}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(4, Math.round(progress * 100))}%` }]} />
              </View>
              <Text style={styles.progressText}>Downloading… {Math.round(progress * 100)}%</Text>
            </View>
          ) : (
            <Button label="Download hymns for offline" icon="keep-offline" onPress={() => void download()} />
          )}
          <View style={styles.sizeLine}>
            {meta ? (
              <Text style={styles.sizeText} numberOfLines={1}>
                {`${meta.count > 0 ? `${meta.count} hymns and tunes · ` : ""}${formatBytes(meta.bytes)}`}
              </Text>
            ) : metaIn ? null : (
              <Skeleton width={150} height={12} radius={radii.sm} />
            )}
          </View>
          {dataSaver ? <Text style={styles.note}>Data saver is on: the hymns only update when you ask.</Text> : null}
        </Card>
        {/* What the download holds, in the list's own rows, fading towards the tab bar: the page reads as the hymnbook
            it becomes instead of one card and an empty screen. Not tappable until the hymns are on the phone. */}
        <Text style={styles.previewHead}>In the hymnbook</Text>
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {HYMN_PREVIEW.map((h, i) => (
            <View
              key={h.slug}
              style={[styles.row, styles.rowDivided, { opacity: previewOpacity(i, HYMN_PREVIEW.length) }]}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{h.title}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {h.kind === "tune" ? `Tune · ${h.tune}` : h.firstLine}
                </Text>
              </View>
              <Text style={styles.rowKey}>{keyAndTime(h)}</Text>
            </View>
          ))}
        </View>
      </Screen>
    );
  }

  const listHeader = (
    <View onLayout={measure("top")}>
      <View onLayout={(e) => setRailTop(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
        {header}
        <View style={styles.searchPill}>
          <Icon name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Title, first line or tune"
            accessibilityLabel="Search hymns by title, first line or tune"
            placeholderTextColor={colors.textFaint}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          {query ? (
            <Touchable onPress={() => setQuery("")} hitSlop={8} ripple="borderless" accessibilityLabel="Clear search">
              <Icon name="clear" size={18} color={colors.textFaint} />
            </Touchable>
          ) : null}
        </View>
      </View>

      {showShelf && words && tint ? (
        <View style={[styles.shelf, styles.besideRail]}>
          <View style={styles.shelfHead}>
            <View style={[styles.shelfIcon, { backgroundColor: tint.soft }]}>
              <Icon name={words.icon} size={18} color={tint.label} />
            </View>
            <Text style={styles.shelfTitle} accessibilityRole="header">{words.shelf}</Text>
            {/* The app's text button, as Home's "See all" (board n-ux-low Q4e). */}
            <Button
              label={`${shelfList.length} · See all`}
              variant="text"
              size="sm"
              onPress={() => setShelfOnly(true)}
              style={styles.shelfAll}
              accessibilityLabel={`See all ${shelfList.length} ${season === "halloween" ? "songs for Halloween" : "carols"}`}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
            {shelfList.map((h) => (
              <ShelfCard key={h.slug} h={h} solfa={openings.get(h.slug) ?? ""} saints={season === "halloween" && isAllSaints(h)} onOpen={() => setOpen(h)} styles={styles} />
            ))}
          </ScrollView>
          <Text style={styles.allLabel}>All hymns</Text>
        </View>
      ) : null}

      {shelfOnly && words && tint ? (
        <View>
          <View style={styles.shelfHead}>
            <View style={[styles.shelfIcon, { backgroundColor: tint.soft }]}>
              <Icon name={words.icon} size={18} color={tint.label} />
            </View>
            <Text style={styles.shelfTitle} accessibilityRole="header">{words.shelf} · {shelfList.length}</Text>
            <Button
              label="All hymns"
              variant="text"
              size="sm"
              onPress={() => setShelfOnly(false)}
              style={styles.shelfAll}
              accessibilityLabel="Show all hymns"
            />
          </View>
          {season === "halloween" ? (
            <View style={styles.filters} accessibilityRole="tablist">
              {(
                [
                  ["all", "All"],
                  ["spooky", "Spooky"],
                  ["saints", "All Saints"],
                ] as const
              ).map(([key, label]) => {
                const n = filterHalloween(shelfList, key).length;
                const on = filter === key;
                return (
                  <Touchable
                    key={key}
                    onPress={() => setFilter(key)}
                    radius={radii.pill}
                    style={[styles.filter, on && { backgroundColor: tint.soft, borderColor: tint.line }]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${label}, ${n}`}
                  >
                    {/* The chosen one says so with a tick as well as its tint (board n-ux-low Q4b). */}
                    {on ? <Icon name="check" size={16} color={colors.text} /> : null}
                    <Text style={[styles.filterText, on && { color: colors.text }]}>{label} {n}</Text>
                  </Touchable>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const listEmpty =
    // Without a query the list is empty only under a season filter (Spooky, All Saints) with nothing in it. A
    // search that found nothing says what else to try, and clears in one tap (as the Library's does).
    query.trim() ? (
      <View>
        <Text style={styles.empty}>
          {`Nothing matches “${query.trim()}”. Try fewer words, the first line or the tune's name.`}
        </Text>
        <Button label="Clear search" variant="secondary" onPress={() => setQuery("")} style={styles.emptyButton} />
      </View>
    ) : (
      <Text style={styles.empty}>Nothing here yet.</Text>
    );

  // The foot's two quiet actions are the app's text button (board n-ux-low Q4e).
  const listFooter = (
    <View style={styles.footer}>
      <Text style={styles.footerText}>
        {formatBytes(packState.bytes)} on this phone{dataSaver ? " · updates when you ask (data saver)" : " · checked weekly"}
      </Text>
      <View style={styles.footerLinks}>
        <Button
          label={progress !== null ? `Downloading… ${Math.round(progress * 100)}%` : "Check for updates"}
          variant="text"
          size="sm"
          onPress={() => void checkForUpdate()}
          loading={checking}
          disabled={progress !== null}
          accessibilityLabel="Check for newer hymns"
        />
        <Button
          label="Remove from this phone"
          variant="text"
          size="sm"
          onPress={confirmRemove}
          disabled={progress !== null}
          accessibilityLabel="Remove the hymns from this phone"
        />
      </View>
    </View>
  );

  return (
    <Screen>
      {/* The lists run to the screen's edge, their own padding in place of the screen's, so the letter rail sits in
          the edge's gutter and takes its touches there. */}
      <View style={styles.listArea}>
        {grid ? (
          <FlatList
            key="grid"
            ref={gridList}
            data={results}
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            keyExtractor={(h) => h.slug}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            initialNumToRender={20}
            windowSize={7}
            contentContainerStyle={[styles.tabBarRoom, styles.listPad]}
            ListHeaderComponent={listHeader}
            renderItem={({ item }) => (
              <ShelfCard h={item} solfa={openings.get(item.slug) ?? ""} saints={isAllSaints(item)} onOpen={() => setOpen(item)} styles={styles} grid />
            )}
            ListEmptyComponent={listEmpty}
            ListFooterComponent={listFooter}
          />
        ) : (
          <SectionList
            key="list"
            ref={sectionList}
            sections={sections}
            keyExtractor={(h) => h.slug}
            stickySectionHeadersEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            initialNumToRender={20}
            windowSize={7}
            getItemLayout={cells ? (_data, index) => ({ ...(cells[index] ?? { length: 0, offset: 0 }), index }) : undefined}
            // Only before the rows' height is known: near the letter, then exact once drawn.
            onScrollToIndexFailed={(info) =>
              sectionList.current?.getScrollResponder()?.scrollTo({ y: info.averageItemLength * info.index, animated: false })
            }
            contentContainerStyle={[styles.tabBarRoom, styles.listPad]}
            ListHeaderComponent={listHeader}
            renderSectionHeader={({ section }) =>
              section.letter ? (
                <View style={[styles.letterHeader, styles.besideRail]} onLayout={metrics.header ? undefined : measure("header")}>
                  <Text style={styles.letterText} accessibilityRole="header">
                    {section.letter}
                  </Text>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <View style={book && styles.besideRail} onLayout={metrics.row ? undefined : measure("row")}>
                <Touchable onPress={() => setOpen(item)} style={[styles.row, styles.rowDivided]} radius={radii.md} accessibilityLabel={`${item.title}, ${item.key}`}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {item.kind === "tune" ? `Tune · ${item.tune}` : item.firstLine}
                    </Text>
                  </View>
                  <Text style={styles.rowKey}>{keyAndTime(item)}</Text>
                </Touchable>
              </View>
            )}
            ListEmptyComponent={listEmpty}
            ListFooterComponent={listFooter}
          />
        )}
        {/* A to Z down the right edge, under the search, clear of the floating tab bar. */}
        {lettered && sections.length > 1 && railTop > 0 ? (
          <LetterRail
            letters={sections.map((s) => s.letter)}
            onPick={jumpTo}
            style={[styles.rail, { top: railTop, bottom: Math.max(insets.bottom, spacing.sm) + RAIL_BOTTOM }]}
          />
        ) : null}
      </View>

      <Sheet visible={open !== null} onClose={() => setOpen(null)}>
        {open ? (
          <>
            <SheetTitle>{open.title}</SheetTitle>
            <Text style={styles.sheetMeta}>{[open.tune && `Tune ${open.tune}`, open.key, open.time].filter(Boolean).join(" · ")}</Text>
            <ScrollView style={styles.sheetScroll} contentContainerStyle={{ gap: spacing.md }}>
              {open.verses.map((v, i) => (
                <View key={i}>
                  {v.label ? <Text style={styles.verseLabel}>{v.label}</Text> : <Text style={styles.verseLabel}>{`Verse ${i + 1}`}</Text>}
                  <Text style={styles.verse}>{v.lines.join("\n")}</Text>
                </View>
              ))}
              {open.verses.length === 0 ? <Text style={styles.verse}>A hymn tune, without words.</Text> : null}
              <Text style={styles.credit}>{open.credit}</Text>
            </ScrollView>
            <SheetActions>
              <Button label="Open the sheet" onPress={() => openSheet(open)} />
            </SheetActions>
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

type Styles = ReturnType<typeof makeStyles>;

/**
 * One song on the season's shelf (or in Halloween's "See all" grid): its title, its first line or tune, its opening in
 * solfa as the engine labels it, its key and time, and for an All Saints tune a small "All Saints' Day, 1 Nov" tag.
 */
function ShelfCard({ h, solfa, saints, onOpen, styles, grid = false }: { h: PackHymn; solfa: string; saints: boolean; onOpen: () => void; styles: Styles; grid?: boolean }) {
  return (
    <Touchable onPress={onOpen} style={[styles.carol, grid && styles.carolGrid]} radius={radii.md} accessibilityLabel={`${h.title}, ${h.key}${saints ? ", for All Saints' Day" : ""}`}>
      <Text style={styles.carolTitle} numberOfLines={grid ? 2 : 1}>{h.title}</Text>
      <Text style={styles.carolLine} numberOfLines={1}>{h.firstLine || `Tune · ${h.tune}`}</Text>
      <Text style={styles.carolSolfa} numberOfLines={1}>{solfa}</Text>
      <View style={styles.carolFoot}>
        <Text style={styles.carolKey}>{keyAndTime(h)}</Text>
        {saints ? (
          <View style={styles.saints}>
            <Text style={styles.saintsText} numberOfLines={1}>All Saints' Day, 1 Nov</Text>
          </View>
        ) : null}
      </View>
    </Touchable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    /** Clears the floating tab bar. */
    tabBarRoom: { paddingBottom: 120 },

    card: { gap: spacing.md },
    offerIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.sheetTile,
      alignItems: "center",
      justifyContent: "center",
    },
    offerTitle: { ...typography.heading, color: c.text },
    offerBody: { ...typography.body, color: c.textMuted, lineHeight: 21 },
    /** The count and size under the download button: a 13 px line whose height is kept while it waits. */
    sizeLine: { minHeight: 18, justifyContent: "center" },
    sizeText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.textMuted },
    note: { ...typography.caption, color: c.textFaint },
    previewHead: {
      ...typography.caption,
      color: c.textMuted,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginTop: spacing.xl,
      marginBottom: spacing.xs,
    },
    progressBlock: { gap: spacing.sm },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: c.surfaceAlt, overflow: "hidden" },
    progressFill: { height: 6, borderRadius: 3, backgroundColor: c.accent },
    progressText: { ...typography.caption, color: c.textMuted },

    searchPill: {
      height: 44,
      borderRadius: 22,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: 14,
      marginBottom: spacing.md,
    },
    searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: c.text, height: "100%", paddingVertical: 0 },
    searchSkeleton: { marginBottom: spacing.md },
    skeletonGap: { marginTop: 7 },

    // The season's shelf (boards d-christmas/02, j-halloween/02): a pine or pumpkin tile, cards that open with their solfa.
    shelf: { marginBottom: spacing.xs },
    shelfHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, marginBottom: spacing.sm },
    shelfIcon: {
      width: 32,
      height: 32,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    shelfTitle: { ...typography.label, flex: 1, color: c.text, fontSize: 16, fontFamily: fonts.semibold },
    /** The text button's own padding stepped out to the edge, so its words end where the list does. */
    shelfAll: { marginRight: -12 },
    shelfRow: { gap: spacing.sm, paddingRight: spacing.lg },
    carol: {
      width: 220,
      padding: spacing.md,
      gap: 3,
      borderRadius: radii.md,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    carolTitle: { fontFamily: fonts.medium, fontSize: 15.5, color: c.text },
    carolLine: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted },
    carolSolfa: { ...typography.mono, fontSize: 15, color: c.accent, letterSpacing: 1.5, marginTop: spacing.sm },
    carolKey: { fontFamily: typography.mono.fontFamily, fontSize: 12, color: c.textFaint },
    carolFoot: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 2 },
    /** Halloween's "See all": two cards a row, sharing the width. */
    carolGrid: { width: "48.5%" },
    gridRow: { justifyContent: "space-between", marginBottom: spacing.sm },
    /** The All Saints tunes' small tag: moon cream on Night (pumpkin on Day), on a faint wash. */
    saints: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: c.pumpkinSoft },
    saintsText: { fontFamily: fonts.medium, fontSize: 11, color: c.moon },
    filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
    filter: {
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    filterText: { fontFamily: fonts.medium, fontSize: 13.5, color: c.textMuted },
    allLabel: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted, marginTop: spacing.lg },

    // The lists reach the screen's edge (the screen's 16 px padding cancelled) and pad themselves 16 on the right. In
    // the book, what sits beside the rail (the shelf, the letters, the rows) leaves it its room; the header and the
    // search above it keep every tab's width.
    listArea: { flex: 1, marginRight: -spacing.lg },
    listPad: { paddingRight: spacing.lg },
    besideRail: { marginRight: RAIL_ROOM - spacing.lg },
    rail: { position: "absolute", right: RAIL_INSET },
    /** A letter's header, 13 px, sticking to the top while its hymns scroll under it. */
    letterHeader: { backgroundColor: c.bg, paddingTop: spacing.md, paddingBottom: spacing.xs },
    letterText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: c.textMuted },

    row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: spacing.md },
    /** A list row's divider is its own, so every row is the same height and the rail can count its way to a letter. */
    rowDivided: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    rowText: { flex: 1 },
    // Fixed line heights: a title with a letter from a fallback font would otherwise draw its row taller.
    rowTitle: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, color: c.text },
    rowSub: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, color: c.textMuted, marginTop: 2 },
    rowKey: { fontFamily: typography.mono.fontFamily, fontSize: 12, lineHeight: 16, color: c.textFaint },
    empty: { ...typography.body, color: c.textMuted, textAlign: "center", marginTop: spacing.xl },
    emptyButton: { marginTop: 18, alignSelf: "center" },

    footer: { alignItems: "center", gap: spacing.xs, marginTop: spacing.xl },
    footerText: { ...typography.caption, color: c.textFaint, textAlign: "center" },
    footerLinks: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "center" },

    // The open hymn reads as words to sing (board m-ux-medium P2g): verses 16/25, the tune line and credit 13; the
    // labels (VERSE 1) stay 12 px caps. The sheet scrolls, so a longer hymn just scrolls further.
    sheetMeta: { ...typography.caption, fontSize: 13, color: c.textMuted },
    sheetScroll: { flexGrow: 0, marginTop: spacing.md, marginBottom: spacing.lg },
    verseLabel: { ...typography.caption, color: c.textFaint, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 },
    verse: { ...typography.body, fontSize: 16, lineHeight: 25, color: c.text },
    credit: { ...typography.caption, fontSize: 13, color: c.textFaint, lineHeight: 19 },
  });
