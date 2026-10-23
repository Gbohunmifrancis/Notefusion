import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Icon } from "../components/Icon";
import { useFocusEffect, useIsFocused, useNavigation, useScrollToTop } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Touchable } from "../components/Touchable";
import { Button } from "../components/Button";
import { ProblemNote } from "../components/ProblemNote";
import { DohTip } from "../components/doh/DohTip";
import { Mark } from "../components/night/NightUI";
import { LibraryRow, LibraryRowSkeleton } from "../components/library/LibraryRow";
import { FoldAway } from "../components/FoldAway";
import { SelectionBar } from "../components/library/SelectionBar";
import { useColors, useThemedStyles } from "../lib/theme";
import { libraryApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { logAppEvent } from "../lib/appEvents";
import { showDialog } from "../lib/dialog";
import * as haptics from "../lib/haptics";
import { useSheetActions } from "../components/library/useSheetActions";
import { withoutHeldDeletes } from "../lib/sheetActions";
import { useSubscription } from "../lib/subscription";
import { loadLibraryList, loadSheet, useOfflineLibrary } from "../lib/offlineLibrary";
import { withBusy } from "../lib/busy";
import { exampleResult, savedSheetParams } from "../lib/openSheet";
import { useOpening } from "../lib/useOpening";
import { onTakeChange, removeTake, retryTake, useOutbox, useSendProgress } from "../lib/outbox";
import { REFRESH_FAILED, isUnopened } from "../lib/savedSheet";
import { parseUtc, sheetCount } from "../lib/sheetMeta";
import { EXAMPLE_HYMN, offerExample } from "../lib/exampleSheet";
import { matchesWords } from "../lib/hymnPack";
import { useReachability } from "../lib/connectivity";
import { isNetworkCode } from "../lib/reachability";
import { openTranscriptionFromNotification } from "../lib/notificationLink";
import { PendingSends } from "../components/library/PendingSends";
import { useSongOnItsWay } from "../lib/useSongOnItsWay";
import { useAuth } from "../lib/auth";
import { TabHeader } from "../components/TabHeader";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import type { SavedTranscription } from "../api/types";
import type { RootStackParams } from "../navigation/types";

/** The round search button, and the size the search pill grows from. */
const ICON_BTN = 40;
/** The open search pill, and every target in the header's rows: 44 px to a thumb (board m-ux-medium P2d). */
const TARGET = 44;

/**
 * LibraryScreen — the night board's "06 · Library": every tab's header (the count over "Library", search, the
 * avatar; board n-ux-low Q4d), folders as text tabs, the folder's one share link as a banner, and hairline rows
 * that each read by their doh. Each row's ⋯ opens its actions, as on Home (board m-ux-medium P2c); a long press, or
 * the actions' "Select several", starts select mode, and the floating bar then deletes, files or shares the chosen
 * sheets.
 */
export function LibraryScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { refresh: refreshSubscription, subscription } = useSubscription();
  // The choir this account is in while its plan runs: sheets can be shared with it, and its library is a tap away.
  const choirName = subscription?.choirName ?? null;

  const [items, setItems] = useState<SavedTranscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The API could not be reached and the list is the phone's copy (lib/offlineLibrary). */
  const [offline, setOffline] = useState(false);
  const offlineCopies = useOfflineLibrary();
  const reach = useReachability();
  // Takes still on their way (lib/outbox): shown above the sheets until each lands among them.
  const outbox = useOutbox();
  const sendProgress = useSendProgress();
  // A song sent from Song link, listed with them while it is written (board m-ux-medium P2e).
  const { user } = useAuth();

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  // Folders ("Sunday choir", "Easter service"): the tab chosen, and the sheets waiting for a new name.
  const [folder, setFolder] = useState<string | null>(null);
  const [sharingFolder, setSharingFolder] = useState(false);
  // A folder's link is only known once it has been asked for (asking makes it), so the
  // banner can say "shared" for the folders shared during this visit and no others.
  const [folderLinks, setFolderLinks] = useState<Record<string, string>>({});
  // Select mode is simply "something is selected": clearing the last tick leaves it.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const selecting = selected.size > 0;
  // Doh on the empty states idles only while the Library is on show; a scroll closes his tip.
  const focused = useIsFocused();
  const [scrolls, setScrolls] = useState(0);
  const song = useSongOnItsWay(user?.id, focused);

  // Share, file and delete the chosen sheets: the same actions as Home's recent rows (board a-core/11).
  const actions = useSheetActions({
    items,
    setItems,
    reload: () => load(),
    onDone: () => setSelected(new Set()),
    onSelectSeveral: (item) => {
      haptics.play("medium");
      setSelected(new Set([item.id]));
    },
  });
  const folders = actions.folders;
  const folderCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) if (i.folder) counts.set(i.folder, (counts.get(i.folder) ?? 0) + 1);
    return counts;
  }, [items]);

  function load(reconcile = false) {
    if (reconcile) {
      refreshSubscription(true).catch(() => undefined);
    }
    loadLibraryList()
      .then(({ items: data, offline: fromCopy }) => {
        // A sheet whose delete is still held behind its Undo stays out (lib/sheetActions).
        setItems(withoutHeldDeletes(data));
        setOffline(fromCopy);
        setLoadError(null);
      })
      .catch((e) => setLoadError(toApiError(e).message))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }

  // Read on every visit, quietly over the list shown: a sheet renamed or deleted from Home or the Result screen
  // shows as it is now, never as a stale row that fails to open.
  useFocusEffect(
    useCallback(() => {
      load();
    }, []),
  );

  // A take on its way finished: the server filed it, so it is a sheet in the list now.
  useEffect(
    () =>
      onTakeChange((_before, after) => {
        if (after.status === "done") load();
      }),
    [],
  );

  // The song is written: the server filed it, so it is a sheet in the list now.
  useEffect(() => {
    if (song.row?.state === "done") load();
  }, [song.row?.state]);

  // Back online while showing the phone's copies (or an error): read the list again, quietly.
  useEffect(() => {
    if (reach === "online" && (offline || loadError)) load();
  }, [reach]);

  // A folder emptied by a move or a delete no longer has a tab; fall back to All.
  useEffect(() => {
    if (folder !== null && !folders.includes(folder)) setFolder(null);
  }, [folder, folders]);

  // Android back leaves select mode, then closes the search, before it leaves the screen.
  useFocusEffect(
    useCallback(() => {
      if (!selecting && !searchOpen) return undefined;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (selecting) setSelected(new Set());
        else closeSearch();
        return true;
      });
      return () => sub.remove();
    }, [selecting, searchOpen]),
  );

  const filteredItems = items.filter((item) => {
    // Title or folder, as the hymn search reads words: "ave" finds "Avé Maria", "sunday" the Sunday choir folder.
    const matchesQuery = matchesWords(query, [item.title, item.folder]);
    const matchesFolder = folder === null || item.folder === folder;
    return matchesQuery && matchesFolder;
  });

  const sortedItems = React.useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const tA = parseUtc(a.createdAtUtc);
      const tB = parseUtc(b.createdAtUtc);
      return sortOrder === "newest" ? tB - tA : tA - tB;
    });
  }, [filteredItems, sortOrder]);

  const selectedItems = items.filter((i) => selected.has(i.id));

  // ── Search: the round icon grows into a pill across the tab's header ──────
  // The header is every tab's (TabHeader, board n-ux-low Q4d); the search button's place in it is measured, so the
  // pill sits exactly on it closed and spans the header's row open.
  const [rowWidth, setRowWidth] = useState(0);
  const headerRef = useRef<View>(null);
  const searchSlotRef = useRef<View>(null);
  const [searchSlot, setSearchSlot] = useState<{ x: number; y: number } | null>(null);
  function measureSearchSlot() {
    const header = headerRef.current;
    if (!header) return;
    searchSlotRef.current?.measureLayout(header, (x, y) => setSearchSlot({ x, y }), () => undefined);
  }
  const slotX = searchSlot?.x ?? 0;
  const slotY = searchSlot?.y ?? 0;
  const searchProgress = useSharedValue(0);
  useEffect(() => {
    searchProgress.value = withTiming(searchOpen ? 1 : 0, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [searchOpen, searchProgress]);
  const pillStyle = useAnimatedStyle(() => ({
    width: interpolate(searchProgress.value, [0, 1], [ICON_BTN, Math.max(rowWidth, ICON_BTN)]),
    // Closed, the pill is the search button beside the avatar; open, it spans the row, 44 tall, on the same centre.
    left: interpolate(searchProgress.value, [0, 1], [slotX, 0]),
    height: interpolate(searchProgress.value, [0, 1], [ICON_BTN, TARGET]),
    top: interpolate(searchProgress.value, [0, 1], [slotY, slotY + (ICON_BTN - TARGET) / 2]),
    borderRadius: interpolate(searchProgress.value, [0, 1], [ICON_BTN / 2, TARGET / 2]),
  }));
  const fadeWithSearch = useAnimatedStyle(() => ({ opacity: 1 - searchProgress.value }));

  /** The sheet loading (`openItem`): its row says "Opening…" after 300 ms. */
  const opening = useOpening();
  // Tapping Library again while on it scrolls back to the top.
  const listRef = useRef<FlatList<SavedTranscription>>(null);
  useScrollToTop(listRef);

  function closeSearch() {
    setQuery("");
    setSearchOpen(false);
  }

  /**
   * Opens a sheet with its notes: the list route omits them. An unchanged copy on the phone opens
   * at once with no download; offline, any copy does (lib/offlineLibrary).
   */
  async function openItem(item: SavedTranscription) {
    // A second tap while the sheet loads would push a second Result.
    if (!opening.begin(item.id)) return;
    // Opened: a sheet the server filed stops being marked unopened, here and on the server.
    if (isUnopened(item)) {
      const openedAtUtc = new Date().toISOString();
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, openedAtUtc } : i)));
      void libraryApi.markOpened(item.id).catch(() => undefined);
    }
    try {
      // A sheet not on the phone yet comes over the network: the card says so after 250 ms, as Home's does.
      const { sheet } = await withBusy("Opening…", () => loadSheet(item));
      nav.navigate("Result", savedSheetParams(sheet));
    } catch (e) {
      const err = toApiError(e);
      showDialog({
        title: isNetworkCode(err.code) ? "Not on this phone yet" : "Could not open",
        message: isNetworkCode(err.code)
          ? "You're offline and this sheet hasn't been opened on this phone. Open it once online — or choose Keep offline on it — and it will open anywhere."
          : err.message,
        icon: isNetworkCode(err.code) ? "offline" : "problem",
        tone: isNetworkCode(err.code) ? undefined : "danger",
      });
    } finally {
      opening.end();
    }
  }

  function toggle(item: SavedTranscription) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }

  /** Long press starts select mode with that sheet ticked; in select mode it just toggles. */
  function startSelecting(item: SavedTranscription) {
    if (!selecting) haptics.play("medium");
    toggle(item);
  }

  async function shareFolder() {
    if (!folder) return;
    setSharingFolder(true);
    try {
      const link = await libraryApi.shareFolder(folder);
      setFolderLinks((prev) => ({ ...prev, [folder]: link.url }));
      await Share.share({ message: `${folder} — songs on NoteFusion: ${link.url}` });
      logAppEvent("folder_shared");
    } catch (e) {
      showDialog({ title: "Could not share the folder", message: toApiError(e).message, icon: "problem", tone: "danger" });
    } finally {
      setSharingFolder(false);
    }
  }

  function chooseSort() {
    showDialog({
      kind: "options",
      title: "Sort library",
      actions: [
        {
          label: "Newest first",
          icon: "arrow-down",
          // The active order is marked with a tick rather than by
          // appending " ✓" to the label, as the OS sheet had to.
          selected: sortOrder === "newest",
          onPress: () => setSortOrder("newest"),
        },
        {
          label: "Oldest first",
          icon: "arrow-up",
          selected: sortOrder === "oldest",
          onPress: () => setSortOrder("oldest"),
        },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  const folderLink = folder ? folderLinks[folder] : undefined;

  /** "No sheets yet" said only once the list has answered: "Your sheets" while it is read, or when it failed. */
  const countLine = loading || (loadError && items.length === 0) ? "Your sheets" : sheetCount(items.length);

  /** "See an example" (board n-ux-low Q4j): the bundled Amazing Grace on Result, not filed and nothing spent. */
  function openExample() {
    nav.navigate("Result", { result: exampleResult(), title: EXAMPLE_HYMN.title, example: true });
  }

  const header = (
    <View style={styles.headerArea}>
      {/* ── Every tab's header: the count over "Library", search, the avatar. Search grows over the row. Record is
          the tab bar's centre, one tap away, so the header has no "+" of its own (board n-ux-low Q4h). ── */}
      <View
        ref={headerRef}
        collapsable={false}
        onLayout={(e) => {
          setRowWidth(e.nativeEvent.layout.width);
          // The header grew or narrowed (larger text, a turned phone): the search button's place moved with it.
          measureSearchSlot();
        }}
      >
        <Animated.View style={fadeWithSearch} pointerEvents={searchOpen ? "none" : "box-none"}>
          <TabHeader title="Library" eyebrow={countLine}>
            {/* The search button's place: the pill below sits on it. */}
            <View ref={searchSlotRef} collapsable={false} style={styles.searchSlot} onLayout={measureSearchSlot} />
          </TabHeader>
        </Animated.View>
        {searchSlot ? (
          <Animated.View style={[styles.searchPill, pillStyle]}>
            {searchOpen ? (
              <>
                <Icon name="search" size={18} color={colors.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search your sheets"
                  accessibilityLabel="Search your sheets"
                  placeholderTextColor={colors.textFaint}
                  value={query}
                  onChangeText={setQuery}
                  autoFocus
                  autoCorrect={false}
                  returnKeyType="search"
                  textAlignVertical="center"
                />
                {/* A 44 px button at the pill's end, not an icon leaning on slop past the row. */}
                <Touchable onPress={closeSearch} style={styles.searchClear} ripple="borderless" accessibilityLabel="Close search">
                  <Icon name="clear" size={18} color={colors.textFaint} />
                </Touchable>
              </>
            ) : (
              <Touchable onPress={() => setSearchOpen(true)} style={styles.searchBtn} radius={radii.pill} hitSlop={4} accessibilityLabel="Search library">
                <Icon name="search" size={20} color={colors.text} />
              </Touchable>
            )}
          </Animated.View>
        ) : null}
      </View>

      {/* ── Folders as text tabs, counts set small beside each name ───────────── */}
      <View style={styles.tabsRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={styles.tabsScroll}>
          {[null, ...folders].map((f) => {
            const active = folder === f;
            const count = f === null ? items.length : folderCounts.get(f) ?? 0;
            return (
              <Touchable
                key={f ?? "__all"}
                onPress={() => setFolder(f)}
                style={styles.tab}
                ripple={false}
                // 44 tall; wider to a thumb by half the 22 px gap to the next tab on each side.
                hitSlop={{ top: 0, bottom: 0, left: 11, right: 11 }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${f ? `Folder: ${f}` : "All sheets"}, ${count}`}
              >
                <View style={styles.tabLabelArea}>
                  <View style={styles.tabLabelRow}>
                    <Text style={[styles.tabText, active && styles.tabTextActive]}>{f ?? "All"}</Text>
                    {count > 0 && <Text style={[styles.tabCount, active && styles.tabCountActive]}>{count}</Text>}
                  </View>
                </View>
                <View style={[styles.tabUnderline, active && styles.tabUnderlineActive]} />
              </Touchable>
            );
          })}
        </ScrollView>
        <Touchable style={styles.sortBtn} ripple="borderless" accessibilityLabel="Sort library" onPress={chooseSort}>
          <Icon name="sort" size={18} color={colors.textMuted} />
        </Touchable>
      </View>

      {/* ── Offline: the phone's copies, said calmly ───────────────────────────── */}
      {offline && (
        <View style={styles.offlineBanner} accessibilityRole="text">
          <Icon name="offline" size={18} color={colors.textMuted} />
          <Text style={styles.offlineText}>Offline — showing saved copies</Text>
        </View>
      )}

      {/* A read that failed over rows already shown: said, so they are not taken for the latest. */}
      {loadError && items.length > 0 ? <ProblemNote style={styles.refreshNote}>{REFRESH_FAILED}</ProblemNote> : null}

      {/* ── Recordings waiting to send (record now, send later) ──────────────── */}
      <PendingSends
        items={outbox}
        progress={sendProgress}
        song={song.row}
        onOpenSong={() => {
          const jobId = song.jobId;
          if (!jobId) return;
          void openTranscriptionFromNotification(jobId).then((opened) => opened && song.forget());
        }}
        onDismissSong={song.forget}
        onRetry={(t) => retryTake(t.id)}
        onOpen={(t) => {
          if (!t.jobId) return;
          void openTranscriptionFromNotification(t.jobId).then((opened) => opened && removeTake(t.id));
        }}
        onDelete={(t) =>
          t.status === "done"
            ? removeTake(t.id)
            : showDialog({
                title: "Delete this recording?",
                message: "It hasn't been sent, so nothing is used up — but the audio is gone for good.",
                icon: "delete",
                tone: "danger",
                actions: [
                  { label: "Delete", style: "destructive", onPress: () => removeTake(t.id) },
                  { label: "Keep it", style: "cancel" },
                ],
              })
        }
      />

      {/* ── The choir's shared library, on "All", for someone in a running choir ─── */}
      {folder === null && choirName && (
        <Touchable
          onPress={() => nav.navigate("Choir")}
          style={styles.banner}
          radius={18}
          accessibilityLabel={`Open the choir library of ${choirName}`}
        >
          <Icon name="choir" size={22} color={colors.choir} />
          <View style={styles.bannerText}>
            <Text style={styles.bannerTitle} numberOfLines={1}>
              Choir library
            </Text>
            <Text style={styles.bannerSub} numberOfLines={1}>
              {choirName} · sheets shared with the whole choir
            </Text>
          </View>
          <Text style={styles.bannerAction}>Open</Text>
        </Touchable>
      )}

      {/* ── The open folder's one public link ─────────────────────────────────── */}
      {folder !== null && (
        <Touchable
          onPress={() => void shareFolder()}
          disabled={sharingFolder}
          style={styles.banner}
          radius={18}
          accessibilityLabel={folderLink ? `Share the link to ${folder} again` : `Share ${folder} with one link`}
        >
          <Icon name="link" size={20} color={colors.icon} />
          <View style={styles.bannerText}>
            <Text style={styles.bannerTitle} numberOfLines={1}>
              {folderLink ? "Shared with a link" : "Share this folder"}
            </Text>
            <Text style={styles.bannerSub} numberOfLines={1}>
              {folderLink ? "One link · sheets you file here join it" : "One link for every sheet in it, and any you add"}
            </Text>
          </View>
          {sharingFolder ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={styles.bannerAction}>Share</Text>
          )}
        </Touchable>
      )}

      {/* Below "On its way", the sheets themselves, so the two lists read apart (board 13). */}
      {(outbox.length > 0 || song.row) && sortedItems.length > 0 ? (
        <Text style={styles.sheetsEyebrow} accessibilityRole="header">
          All sheets
        </Text>
      ) : null}
    </View>
  );

  const empty = loading ? (
    <View>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={i > 0 && styles.skeletonDivider}>
          <LibraryRowSkeleton />
        </View>
      ))}
    </View>
  ) : loadError ? (
    // A problem stays plain words: no Doh on errors.
    <View style={styles.emptyContainer}>
      <Mark height={40} color={colors.textFaint} />
      <ProblemNote center>{loadError}</ProblemNote>
      <Button
        label="Try again"
        variant="secondary"
        onPress={() => {
          setLoading(true);
          load();
        }}
      />
    </View>
  ) : (
    // Nothing here yet: Doh holding a blank sheet, a tip when tapped (board c-practice/8b).
    <View style={styles.dohEmpty}>
      <DohTip active={focused} closeSignal={scrolls} />
      <Text style={styles.emptyTitle}>
        {query.trim()
          ? `Nothing here matches “${query.trim()}”`
          : folder !== null
            ? "Nothing in this folder yet"
            : "Your sheets will live here"}
      </Text>
      {!query.trim() && folder === null ? (
        <Text style={styles.emptyText}>Hum a line and I'll write it in solfa. It lands here, ready to sing, share or print.</Text>
      ) : null}
      {query.trim() ? (
        <Button label="Clear search" variant="secondary" onPress={closeSearch} style={styles.emptyButton} />
      ) : folder !== null ? (
        <Button label="Show all" variant="secondary" onPress={() => setFolder(null)} style={styles.emptyButton} />
      ) : (
        // The way on from an empty Library: the screen's one primary (board n-ux-low Q4i), and an example to look at
        // until the first sheet exists (Q4j).
        <>
          <Button
            label="Record a tune"
            icon="mic"
            onPress={() => nav.navigate("Tabs", { screen: "Record" })}
            style={styles.emptyButton}
          />
          {offerExample(items.length) ? (
            <Button label="See an example" variant="text" size="sm" onPress={openExample} style={styles.exampleButton} />
          ) : null}
        </>
      )}
    </View>
  );

  return (
    <Screen edges={["top"]}>
      <FlatList
        ref={listRef}
        data={sortedItems}
        extraData={[selected, actions.folding, opening.opening, actions.actionsFor]}
        keyExtractor={(t) => t.id}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => setScrolls((n) => n + 1)}
        contentContainerStyle={[styles.listContent, selecting && styles.listContentSelecting]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(true);
            }}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          // A deleted row folds away, and unfolds where it was on Undo (board m-ux-medium P2a).
          <FoldAway {...actions.foldProps(item.id)}>
            <LibraryRow
              item={item}
              withFolder={folder === null}
              selecting={selecting}
              selected={selected.has(item.id)}
              onPress={() => (selecting ? toggle(item) : void openItem(item))}
              onLongPress={() => startSelecting(item)}
              opening={opening.opening === item.id}
              active={actions.actionsFor?.id === item.id}
              onMore={() => actions.openActions(item)}
              offline={
                offline && !offlineCopies.cached.has(item.id)
                  ? "missing"
                  : offlineCopies.keepAll || offlineCopies.pinned.has(item.id)
                    ? "kept"
                    : null
              }
            />
          </FoldAway>
        )}
        ItemSeparatorComponent={() => <View style={styles.itemDivider} />}
        ListEmptyComponent={empty}
      />
      {selecting && (
        <SelectionBar
          count={selected.size}
          sharing={actions.sharing}
          onClose={() => setSelected(new Set())}
          onDelete={() => actions.confirmDelete(selectedItems)}
          onMove={() => actions.chooseFolder(selectedItems)}
          onShare={() => actions.chooseShare(selectedItems)}
        />
      )}
      {actions.element}
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    listContent: {
      paddingBottom: 120,
    },
    /** Room for the selection bar, which floats above the tab bar. */
    listContentSelecting: {
      paddingBottom: 200,
    },
    // The header sits where Practice's and Hymns' do (TabHeader's own margin above it).
    headerArea: {
      marginBottom: 6,
    },

    // ── Search, in the tab's header ─────────────────────────────────────────────
    /** The search button's place beside the avatar; the pill is drawn over it. */
    searchSlot: {
      width: ICON_BTN,
      height: ICON_BTN,
    },
    searchPill: {
      position: "absolute",
      height: ICON_BTN,
      borderRadius: ICON_BTN / 2,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: 11,
      overflow: "hidden",
    },
    // Fills the closed pill edge to edge (cancelling its padding) so the whole circle is the target.
    searchBtn: {
      width: ICON_BTN,
      height: ICON_BTN,
      marginHorizontal: -11,
      alignItems: "center",
      justifyContent: "center",
    },
    /** The close: 44 × 44 at the open pill's end (its padding cancelled). */
    searchClear: {
      width: TARGET,
      height: TARGET,
      marginRight: -11,
      alignItems: "center",
      justifyContent: "center",
    },
    searchInput: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: c.text,
      height: "100%",
      paddingVertical: 0,
    },

    // ── Folder tabs ───────────────────────────────────────────────────────────
    // 18 under the name, as under the old title: TabHeader keeps 16 below its row.
    tabsRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    tabsScroll: { flex: 1 },
    tabs: {
      gap: 22,
      paddingRight: spacing.md,
    },
    /** 44 px tall: the label centred, the underline at the row's foot. */
    tab: {
      height: TARGET,
    },
    tabLabelArea: {
      flex: 1,
      justifyContent: "center",
    },
    tabLabelRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 3,
    },
    tabText: {
      fontFamily: fonts.medium,
      fontSize: 15,
      color: c.textFaint,
    },
    tabTextActive: {
      fontFamily: fonts.semibold,
      color: c.text,
    },
    tabCount: {
      fontFamily: typography.mono.fontFamily,
      fontSize: 11,
      color: c.textFaint,
      marginTop: 1,
    },
    tabCountActive: {
      color: c.accent,
    },
    tabUnderline: {
      height: 2,
      borderRadius: 1,
    },
    tabUnderlineActive: {
      backgroundColor: c.ink,
    },
    /** A 44 × 44 button at the row's end, its icon flush with the screen's edge. */
    sortBtn: {
      width: TARGET,
      height: TARGET,
      marginRight: -12,
      alignItems: "center",
      justifyContent: "center",
    },

    // ── Offline banner: calm, not an error ──────────────────────────────────
    offlineBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.lg,
      paddingVertical: 10,
      paddingHorizontal: spacing.lg,
      borderRadius: 14,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    refreshNote: {
      marginTop: spacing.md,
    },
    sheetsEyebrow: {
      fontFamily: fonts.medium,
      fontSize: 12,
      color: c.textFaint,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginTop: spacing.lg,
    },
    offlineText: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: c.textMuted,
    },

    // ── Folder share banner ──────────────────────────────────────────────────
    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      marginTop: spacing.lg,
      paddingVertical: 14,
      paddingHorizontal: spacing.lg,
      borderRadius: 18,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentGlow,
    },
    bannerText: { flex: 1 },
    bannerTitle: {
      fontFamily: fonts.medium,
      fontSize: 14,
      color: c.text,
    },
    // The banner is a blue notice on its tint: its words take the notice tokens, ≥5:1 there in Day.
    bannerSub: {
      fontFamily: fonts.regular,
      fontSize: 12,
      color: c.noticeMuted,
      marginTop: 2,
    },
    bannerAction: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: c.noticeText,
    },

    // ── Rows ───────────────────────────────────────────────────────────────────
    itemDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
    },
    skeletonDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },

    // ── Empty / error ─────────────────────────────────────────────────────────
    emptyContainer: {
      alignItems: "center",
      paddingTop: spacing.xxxl,
      paddingHorizontal: spacing.xl,
      gap: spacing.lg,
    },
    dohEmpty: {
      alignItems: "center",
      // Room above Doh for his tip's bubble.
      paddingTop: 150,
      paddingHorizontal: spacing.xl,
    },
    emptyTitle: {
      fontFamily: fonts.semibold,
      fontSize: 19,
      lineHeight: 25,
      color: c.text,
      textAlign: "center",
      marginTop: 10,
    },
    emptyText: {
      fontFamily: fonts.regular,
      fontSize: 14.5,
      lineHeight: 21,
      color: c.textMuted,
      textAlign: "center",
      marginTop: 6,
      maxWidth: 320,
    },
    emptyButton: {
      marginTop: 18,
    },
    exampleButton: {
      marginTop: spacing.xs,
    },
  });
