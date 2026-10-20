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
import { showDialog } from "../lib/dialog";
import * as haptics from "../lib/haptics";
import { useSheetActions } from "../components/library/useSheetActions";
import { withoutHeldDeletes } from "../lib/sheetActions";
import { useSubscription } from "../lib/subscription";
import { loadLibraryList, loadSheet, useOfflineLibrary } from "../lib/offlineLibrary";
import { resultFromSaved } from "../lib/openSheet";
import { useOpening } from "../lib/useOpening";
import { onTakeChange, removeTake, retryTake, useOutbox, useSendProgress } from "../lib/outbox";
import { isUnopened } from "../lib/savedSheet";
import { matchesWords } from "../lib/hymnPack";
import { useReachability } from "../lib/connectivity";
import { isNetworkCode } from "../lib/reachability";
import { openTranscriptionFromNotification } from "../lib/notificationLink";
import { PendingSends } from "../components/library/PendingSends";
import { HEADER_AVATAR, HeaderAvatar } from "../components/HeaderAvatar";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import type { SavedTranscription } from "../api/types";
import type { RootStackParams } from "../navigation/types";

/** The circular header buttons, and the size the search pill grows from. */
const ICON_BTN = 40;

/**
 * LibraryScreen — the night board's "06 · Library": a big title with search and new,
 * folders as text tabs, the folder's one share link as a banner, and hairline rows
 * that each read by their doh. Long press starts select mode; the floating bar then
 * deletes, files or shares the chosen sheets.
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

  // Share, file and delete the chosen sheets: the same actions as Home's recent rows (board a-core/11).
  const actions = useSheetActions({
    items,
    setItems,
    reload: () => load(),
    onDone: () => setSelected(new Set()),
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

  // Back online while showing the phone's copies (or an error): read the list again, quietly.
  useEffect(() => {
    if (reach === "online" && (offline || loadError)) load();
  }, [reach]);

  // A folder emptied by a move or a delete no longer has a tab; fall back to All.
  useEffect(() => {
    if (folder !== null && !folders.includes(folder)) setFolder(null);
  }, [folder, folders]);

  // Android back leaves select mode before it leaves the screen.
  useFocusEffect(
    useCallback(() => {
      if (!selecting) return undefined;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        setSelected(new Set());
        return true;
      });
      return () => sub.remove();
    }, [selecting]),
  );

  const filteredItems = items.filter((item) => {
    // Title or folder, as the hymn search reads words: "ave" finds "Avé Maria", "sunday" the Sunday choir folder.
    const matchesQuery = matchesWords(query, [item.title, item.folder]);
    const matchesFolder = folder === null || item.folder === folder;
    return matchesQuery && matchesFolder;
  });

  const sortedItems = React.useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const tA = new Date(a.createdAtUtc).getTime();
      const tB = new Date(b.createdAtUtc).getTime();
      return sortOrder === "newest" ? tB - tA : tA - tB;
    });
  }, [filteredItems, sortOrder]);

  const selectedItems = items.filter((i) => selected.has(i.id));

  // ── Search: the round icon grows into a pill across the title row ─────────
  const [rowWidth, setRowWidth] = useState(0);
  const searchProgress = useSharedValue(0);
  useEffect(() => {
    searchProgress.value = withTiming(searchOpen ? 1 : 0, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [searchOpen, searchProgress]);
  const pillStyle = useAnimatedStyle(() => ({
    width: interpolate(searchProgress.value, [0, 1], [ICON_BTN, Math.max(rowWidth, ICON_BTN)]),
    // Closed, the pill is the search button beside "+" (and the avatar after it); open, it spans the row.
    right: interpolate(searchProgress.value, [0, 1], [ICON_BTN + HEADER_AVATAR + 2 * spacing.sm, 0]),
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
      const { sheet } = await loadSheet(item);
      nav.navigate("Result", { result: resultFromSaved(sheet), savedId: sheet.id, title: sheet.title });
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

  function subtitleFor(item: SavedTranscription) {
    const date = new Date(item.createdAtUtc).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    // On "All" the folder says where a sheet lives; inside a folder it would repeat the tab.
    return [date, folder === null ? item.folder : null, `${Math.round(item.tempoBpm)} bpm`].filter(Boolean).join(" · ");
  }

  const folderLink = folder ? folderLinks[folder] : undefined;

  const header = (
    <View style={styles.headerArea}>
      {/* ── Title row: "Library", then search and new. Search grows over the row. ── */}
      <View style={styles.titleRow} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
        <Animated.Text style={[styles.pageTitle, fadeWithSearch]} accessibilityRole="header">
          Library
        </Animated.Text>
        <Animated.View style={[styles.titleActions, fadeWithSearch]} pointerEvents={searchOpen ? "none" : "auto"}>
          <Touchable
            onPress={() => nav.navigate("Tabs", { screen: "Record" })}
            style={styles.iconBtn}
            radius={radii.pill}
            // 40 px circles: the slop makes them 48 dp without moving them.
            hitSlop={4}
            accessibilityLabel="New transcription"
          >
            <Icon name="add" size={22} color={colors.text} />
          </Touchable>
          {/* The account, as on every tab: opens Profile. */}
          <HeaderAvatar />
        </Animated.View>
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
              <Touchable onPress={closeSearch} hitSlop={{ top: 11, bottom: 11, left: 12, right: 14 }} ripple="borderless" accessibilityLabel="Close search">
                <Icon name="clear" size={18} color={colors.textFaint} />
              </Touchable>
            </>
          ) : (
            <Touchable onPress={() => setSearchOpen(true)} style={styles.searchBtn} radius={radii.pill} hitSlop={4} accessibilityLabel="Search library">
              <Icon name="search" size={20} color={colors.text} />
            </Touchable>
          )}
        </Animated.View>
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
                // Wider to a thumb: half the 22 px gap to the next tab on each side.
                hitSlop={{ top: 0, bottom: 0, left: 11, right: 11 }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${f ? `Folder: ${f}` : "All sheets"}, ${count}`}
              >
                <View style={styles.tabLabelRow}>
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{f ?? "All"}</Text>
                  {count > 0 && <Text style={[styles.tabCount, active && styles.tabCountActive]}>{count}</Text>}
                </View>
                <View style={[styles.tabUnderline, active && styles.tabUnderlineActive]} />
              </Touchable>
            );
          })}
        </ScrollView>
        <Touchable style={styles.sortBtn} hitSlop={{ top: 12, bottom: 8, left: 12, right: 14 }} ripple="borderless" accessibilityLabel="Sort library" onPress={chooseSort}>
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

      {/* ── Recordings waiting to send (record now, send later) ──────────────── */}
      <PendingSends
        items={outbox}
        progress={sendProgress}
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
      {outbox.length > 0 && sortedItems.length > 0 ? <Text style={styles.sheetsEyebrow}>All sheets</Text> : null}
    </View>
  );

  const emptyAction = (label: string, onPress: () => void) => (
    <Touchable onPress={onPress} style={styles.emptyBtn} radius={radii.pill} accessibilityLabel={label}>
      <Text style={styles.emptyBtnLabel}>{label}</Text>
    </Touchable>
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
      {emptyAction("Try again", () => {
        setLoading(true);
        load();
      })}
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
        <Button
          label="Record a tune"
          variant="secondary"
          icon="mic"
          onPress={() => nav.navigate("Tabs", { screen: "Record" })}
          style={styles.emptyButton}
        />
      )}
    </View>
  );

  return (
    <Screen edges={["top"]}>
      <FlatList
        ref={listRef}
        data={sortedItems}
        extraData={[selected, actions.folding, opening.opening]}
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
              subtitle={subtitleFor(item)}
              selecting={selecting}
              selected={selected.has(item.id)}
              onPress={() => (selecting ? toggle(item) : void openItem(item))}
              onLongPress={() => startSelecting(item)}
              opening={opening.opening === item.id}
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
    headerArea: {
      paddingTop: 6,
      marginBottom: 6,
    },

    // ── Title row ──────────────────────────────────────────────────────────────
    titleRow: {
      height: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    pageTitle: {
      ...typography.display,
      color: c.text,
    },
    titleActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    iconBtn: {
      width: ICON_BTN,
      height: ICON_BTN,
      borderRadius: ICON_BTN / 2,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    searchPill: {
      position: "absolute",
      top: (48 - ICON_BTN) / 2,
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
    searchInput: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: c.text,
      height: "100%",
      paddingVertical: 0,
    },

    // ── Folder tabs ───────────────────────────────────────────────────────────
    tabsRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 18,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    tabsScroll: { flex: 1 },
    tabs: {
      gap: 22,
      paddingRight: spacing.md,
    },
    tab: {
      paddingTop: spacing.xs,
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
      marginTop: 8,
    },
    tabUnderlineActive: {
      backgroundColor: c.ink,
    },
    sortBtn: {
      paddingLeft: spacing.sm,
      paddingBottom: spacing.xs,
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
    bannerSub: {
      fontFamily: fonts.regular,
      fontSize: 12,
      color: c.textMuted,
      marginTop: 2,
    },
    bannerAction: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: c.accent,
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
    emptyBtn: {
      height: 44,
      paddingHorizontal: spacing.xl,
      borderRadius: radii.pill,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyBtnLabel: {
      fontFamily: fonts.medium,
      fontSize: 14,
      color: c.text,
    },
  });
