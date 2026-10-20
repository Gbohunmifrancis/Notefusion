import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, FlatList, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import {
  filterHalloween,
  formatBytes,
  hymnSheet,
  isAllSaints,
  keyAndTime,
  needsDownload,
  openingLine,
  searchHymns,
  seasonShelf,
  type HalloweenFilter,
  type HymnPack,
  type PackHymn,
  type PackMeta,
} from "../lib/hymnPack";
import { checkRemotePack, downloadPack, installedPack, remotePackMeta, removePack, usePackState } from "../lib/hymnPackStore";
import { resultFromHymn } from "../lib/openSheet";
import { deriveSolfa } from "../lib/solfa";
import { useDataSaver } from "../lib/dataSaver";
import { useSeason } from "../lib/seasonStore";
import { activeSeason, seasonTint, seasonWords } from "../lib/season";
import { showDialog } from "../lib/dialog";
import { showToast } from "../lib/toast";
import { logAnalyticsEvent } from "../lib/analytics";
import type { RootStackParams, TabParams } from "../navigation/types";

/**
 * Hymns — the website's public-domain hymns and tunes, from the offline pack: download once, then
 * browse, search and open any of them as a sheet (play, solfa, staff, practise) with no connection.
 * Until the pack is on the phone the screen offers the download and its size; once it is, a newer
 * version is looked for weekly (off data saver) or when "Check for updates" is tapped. A tab (board a-core/04):
 * the offline book people come back to; "Remove from this phone" is at the foot of the list.
 */
export function HymnsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const packState = usePackState();
  const dataSaver = useDataSaver();

  const [pack, setPack] = useState<HymnPack | null>(null);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<PackMeta | null>(null);
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
  const list = useRef<FlatList<PackHymn>>(null);
  // Tapping Hymns again while on it scrolls back to the top.
  useScrollToTop(list);
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
    list.current?.scrollToOffset({ offset: 0, animated: false });
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
      // Before a download, the size on the button comes from the website (130 bytes).
      if (!p) void remotePackMeta().then((m) => live && setMeta(m));
    });
    return () => {
      live = false;
    };
  }, []);

  // A tab stays mounted: follow the pack when it changes underneath (the weekly refresh, a removal).
  useEffect(() => {
    if (loading || (pack?.version ?? null) === packState.version) return undefined;
    let live = true;
    void installedPack().then((p) => {
      if (!live) return;
      setPack(p);
      if (!p) void remotePackMeta().then((m) => live && setMeta(m));
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
            void removePack().then(() => {
              setPack(null);
              setQuery("");
              void remotePackMeta().then(setMeta);
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
    const size = meta ? formatBytes(meta.bytes) : null;
    return (
      <Screen scroll contentStyle={styles.tabBarRoom}>
        {header}
        <Card style={styles.card}>
          <View style={styles.offerIcon}>
            <Icon name="hymns" size={24} color={colors.icon} />
          </View>
          <Text style={styles.offerTitle}>Hymns you can use anywhere</Text>
          <Text style={styles.offerBody}>
            {meta ? `${meta.count} public-domain hymns and tunes` : "Our public-domain hymns and tunes"} in Tonic Solfa and staff, with
            the words and a piano. Download them once and they work with no data at all.
          </Text>
          {progress !== null ? (
            <View style={styles.progressBlock} accessibilityLabel={`Downloading, ${Math.round(progress * 100)} percent`}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(4, Math.round(progress * 100))}%` }]} />
              </View>
              <Text style={styles.progressText}>Downloading… {Math.round(progress * 100)}%</Text>
            </View>
          ) : (
            <Button
              label={size ? `Download hymns for offline — ${size}` : "Download hymns for offline"}
              icon="keep-offline"
              onPress={() => void download()}
            />
          )}
          {dataSaver ? <Text style={styles.note}>Data saver is on: the hymns only update when you ask.</Text> : null}
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        key={grid ? "grid" : "list"}
        ref={list}
        data={results}
        numColumns={grid ? 2 : 1}
        columnWrapperStyle={grid ? styles.gridRow : undefined}
        keyExtractor={(h) => h.slug}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        initialNumToRender={20}
        windowSize={7}
        contentContainerStyle={styles.tabBarRoom}
        ListHeaderComponent={
          <View>
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

            {showShelf && words && tint ? (
              <View style={styles.shelf}>
                <View style={styles.shelfHead}>
                  <View style={[styles.shelfIcon, { backgroundColor: tint.soft }]}>
                    <Icon name={words.icon} size={18} color={tint.label} />
                  </View>
                  <Text style={styles.shelfTitle} accessibilityRole="header">{words.shelf}</Text>
                  <Touchable
                    onPress={() => setShelfOnly(true)}
                    ripple={false}
                    style={styles.shelfAll}
                    accessibilityLabel={`See all ${shelfList.length} ${season === "halloween" ? "songs for Halloween" : "carols"}`}
                  >
                    <Text style={styles.shelfAllText}>{shelfList.length} · See all</Text>
                  </Touchable>
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
                  <Touchable onPress={() => setShelfOnly(false)} ripple={false} style={styles.shelfAll} accessibilityLabel="Show all hymns">
                    <Text style={styles.shelfAllText}>All hymns</Text>
                  </Touchable>
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
                          <Text style={[styles.filterText, on && { color: colors.text }]}>{label} {n}</Text>
                        </Touchable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => grid ? (
          <ShelfCard h={item} solfa={openings.get(item.slug) ?? ""} saints={isAllSaints(item)} onOpen={() => setOpen(item)} styles={styles} grid />
        ) : (
          <Touchable onPress={() => setOpen(item)} style={styles.row} radius={radii.md} accessibilityLabel={`${item.title}, ${item.key}`}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {item.kind === "tune" ? `Tune · ${item.tune}` : item.firstLine}
              </Text>
            </View>
            <Text style={styles.rowKey}>{keyAndTime(item)}</Text>
          </Touchable>
        )}
        ItemSeparatorComponent={grid ? undefined : () => <View style={styles.divider} />}
        ListEmptyComponent={
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
          )
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {formatBytes(packState.bytes)} on this phone{dataSaver ? " · updates when you ask (data saver)" : " · checked weekly"}
            </Text>
            <View style={styles.footerLinks}>
              <Touchable onPress={() => void checkForUpdate()} disabled={checking || progress !== null} ripple={false} style={styles.footerAction} accessibilityLabel="Check for newer hymns">
                <Text style={styles.footerLink}>
                  {progress !== null ? `Downloading… ${Math.round(progress * 100)}%` : checking ? "Checking…" : "Check for updates"}
                </Text>
              </Touchable>
              <Text style={styles.footerText}>·</Text>
              <Touchable onPress={confirmRemove} disabled={progress !== null} ripple={false} style={styles.footerAction} accessibilityLabel="Remove the hymns from this phone">
                <Text style={styles.footerLink}>Remove from this phone</Text>
              </Touchable>
            </View>
          </View>
        }
      />

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
    note: { ...typography.caption, color: c.textFaint },
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
    shelfAll: { minHeight: 44, justifyContent: "center", paddingLeft: spacing.sm },
    shelfAllText: { fontFamily: fonts.medium, fontSize: 14, color: c.link },
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
      alignItems: "center",
      justifyContent: "center",
    },
    filterText: { fontFamily: fonts.medium, fontSize: 13.5, color: c.textMuted },
    allLabel: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted, marginTop: spacing.lg },

    row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: spacing.md },
    rowText: { flex: 1 },
    rowTitle: { fontFamily: fonts.medium, fontSize: 15, color: c.text },
    rowSub: { fontFamily: fonts.regular, fontSize: 12.5, color: c.textMuted, marginTop: 2 },
    rowKey: { fontFamily: typography.mono.fontFamily, fontSize: 12, color: c.textFaint },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border },
    empty: { ...typography.body, color: c.textMuted, textAlign: "center", marginTop: spacing.xl },
    emptyButton: { marginTop: 18, alignSelf: "center" },

    footer: { alignItems: "center", gap: spacing.xs, marginTop: spacing.xl },
    footerText: { ...typography.caption, color: c.textFaint, textAlign: "center" },
    footerLinks: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "center", gap: spacing.xs },
    footerAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.xs },
    footerLink: { fontFamily: fonts.medium, fontSize: 13, color: c.link },

    // The open hymn reads as words to sing (board m-ux-medium P2g): verses 16/25, the tune line and credit 13; the
    // labels (VERSE 1) stay 12 px caps. The sheet scrolls, so a longer hymn just scrolls further.
    sheetMeta: { ...typography.caption, fontSize: 13, color: c.textMuted },
    sheetScroll: { flexGrow: 0, marginTop: spacing.md, marginBottom: spacing.lg },
    verseLabel: { ...typography.caption, color: c.textFaint, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 },
    verse: { ...typography.body, fontSize: 16, lineHeight: 25, color: c.text },
    credit: { ...typography.caption, fontSize: 13, color: c.textFaint, lineHeight: 19 },
  });
