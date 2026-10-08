import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Touchable } from "../components/Touchable";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { Mark } from "../components/night/NightUI";
import { LibraryRow, LibraryRowSkeleton } from "../components/library/LibraryRow";
import { SelectionBar } from "../components/library/SelectionBar";
import { useColors, useThemedStyles } from "../lib/theme";
import { libraryApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { showDialog } from "../lib/dialog";
import * as haptics from "../lib/haptics";
import { useSubscription } from "../lib/subscription";
import { deriveSolfa } from "../lib/solfa";
import { synthesizeMelodyWavBase64 } from "../lib/synth";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import type { SavedTranscription, TranscriptionResult } from "../api/types";
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
  const { refresh: refreshSubscription } = useSubscription();

  const [items, setItems] = useState<SavedTranscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  // Folders ("Sunday choir", "Easter service"): the tab chosen, and the sheets waiting for a new name.
  const [folder, setFolder] = useState<string | null>(null);
  const [naming, setNaming] = useState<SavedTranscription[] | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [sharingFolder, setSharingFolder] = useState(false);
  // A folder's link is only known once it has been asked for (asking makes it), so the
  // banner can say "shared" for the folders shared during this visit and no others.
  const [folderLinks, setFolderLinks] = useState<Record<string, string>>({});
  // Select mode is simply "something is selected": clearing the last tick leaves it.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sharingSelection, setSharingSelection] = useState(false);
  const selecting = selected.size > 0;

  const folders = React.useMemo(
    () => [...new Set(items.map((i) => i.folder).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const folderCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) if (i.folder) counts.set(i.folder, (counts.get(i.folder) ?? 0) + 1);
    return counts;
  }, [items]);

  function load(reconcile = false) {
    if (reconcile) {
      refreshSubscription(true).catch(() => undefined);
    }
    libraryApi
      .list()
      .then((data) => {
        setItems(data);
        setLoadError(null);
      })
      .catch((e) => setLoadError(toApiError(e).message))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }

  useEffect(() => {
    load();
  }, []);

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
    const matchesQuery =
      query.trim() === "" ||
      item.title.toLowerCase().includes(query.trim().toLowerCase());
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
    // Closed, the pill is the search button beside "+"; open, it spans the row.
    right: interpolate(searchProgress.value, [0, 1], [ICON_BTN + spacing.sm, 0]),
  }));
  const fadeWithSearch = useAnimatedStyle(() => ({ opacity: 1 - searchProgress.value }));

  function closeSearch() {
    setQuery("");
    setSearchOpen(false);
  }

  /**
   * Fetches the full item and re-derives its solfa. The list route omits `notes`,
   * so every use of a saved item starts here — opening it and playing it both need
   * the notes, and neither has them until this runs.
   */
  async function hydrate(item: SavedTranscription) {
    const full = await libraryApi.get(item.id);
    const derived = deriveSolfa(full.notes ?? [], full.key, full.timeSignature);
    return { full, derived };
  }

  async function openItem(item: SavedTranscription) {
    try {
      const { full, derived } = await hydrate(item);
      const audioPreviewBase64 = synthesizeMelodyWavBase64(
        derived.notes,
        full.tempoBpm,
      );

      nav.navigate("Result", {
        result: {
          key: full.key,
          keyConfidence: 1,
          tempo: full.tempoBpm,
          timeSignature: full.timeSignature,
          musicXml: full.musicXml ?? "",
          midiBase64: "",
          notes: derived.notes,
          solfaLines: derived.solfaLines,
          overallConfidence: full.overallConfidence,
          audioPreviewBase64,
          lyrics: full.lyrics ?? "",
          parts: (full.parts as TranscriptionResult["parts"]) ?? null,
          partsMusicXml: full.partsMusicXml ?? "",
          shareToken: full.shareToken ?? null,
          chords: full.chords ?? null,
        },
        savedId: full.id,
        title: full.title,
      });
    } catch (e) {
      showDialog({
        title: "Could not open",
        message: toApiError(e).message,
        icon: "alert-circle-outline",
        tone: "danger",
      });
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

  /** Files sheets; the list updates in place, so the tabs follow at once. */
  async function fileIn(targets: SavedTranscription[], name: string | null) {
    const results = await Promise.allSettled(targets.map((t) => libraryApi.setFolder(t.id, name)));
    const moved = new Set(targets.filter((_, i) => results[i]!.status === "fulfilled").map((t) => t.id));
    setItems((prev) => prev.map((t) => (moved.has(t.id) ? { ...t, folder: name } : t)));
    const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failure) {
      showDialog({ title: "Could not move the sheet", message: toApiError(failure.reason).message, icon: "alert-circle-outline", tone: "danger" });
    } else {
      haptics.play("success");
      setSelected(new Set());
    }
  }

  function chooseFolder(targets: SavedTranscription[]) {
    if (targets.length === 0) return;
    const one = targets.length === 1 ? targets[0]! : null;
    showDialog({
      title: "Move to folder",
      message: one ? `Where should “${one.title}” go?` : `Where should these ${targets.length} sheets go?`,
      icon: "folder-outline",
      actions: [
        ...folders.slice(0, 6).map((f) => ({
          label: f,
          icon: (targets.every((t) => t.folder === f) ? "checkmark" : undefined) as "checkmark" | undefined,
          onPress: () => void fileIn(targets, f),
        })),
        { label: "New folder…", onPress: () => { setNewFolder(""); setNaming(targets); } },
        ...(targets.some((t) => t.folder) ? [{ label: "Take out of folder", onPress: () => void fileIn(targets, null) }] : []),
        { label: "Cancel", style: "cancel" as const },
      ],
    });
  }

  async function shareFolder() {
    if (!folder) return;
    setSharingFolder(true);
    try {
      const link = await libraryApi.shareFolder(folder);
      setFolderLinks((prev) => ({ ...prev, [folder]: link.url }));
      await Share.share({ message: `${folder} — songs on NoteFusion: ${link.url}` });
    } catch (e) {
      showDialog({ title: "Could not share the folder", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
    } finally {
      setSharingFolder(false);
    }
  }

  /** Each selected sheet's public link, made if needed, sent in one message. */
  async function shareSelected(targets: SavedTranscription[]) {
    if (targets.length === 0) return;
    setSharingSelection(true);
    try {
      const links = await Promise.all(targets.map((t) => libraryApi.share(t.id)));
      const tokens = new Map(targets.map((t, i) => [t.id, links[i]!.token]));
      setItems((prev) => prev.map((t) => (tokens.has(t.id) ? { ...t, shareToken: tokens.get(t.id) } : t)));
      const message =
        targets.length === 1
          ? `${targets[0]!.title} — Tonic Solfa on NoteFusion\n${links[0]!.url}`
          : ["Tonic Solfa on NoteFusion", ...targets.map((t, i) => `${t.title}\n${links[i]!.url}`)].join("\n\n");
      await Share.share({ message });
      setSelected(new Set());
    } catch (e) {
      showDialog({ title: "Could not share", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
    } finally {
      setSharingSelection(false);
    }
  }

  function confirmDelete(targets: SavedTranscription[]) {
    if (targets.length === 0) return;
    // The bar's trash is one tap from losing work, so the dialog leads with the warning buzz.
    haptics.play("warning");
    const one = targets.length === 1 ? targets[0]! : null;
    showDialog({
      title: one ? "Delete transcription" : `Delete ${targets.length} transcriptions`,
      message: one ? `Remove "${one.title}"? This cannot be undone.` : `Remove these ${targets.length} sheets? This cannot be undone.`,
      icon: "trash-outline",
      tone: "danger",
      actions: [
        {
          label: "Delete",
          style: "destructive",
          onPress: async () => {
            const ids = new Set(targets.map((t) => t.id));
            setItems((prev) => prev.filter((t) => !ids.has(t.id)));
            setSelected(new Set());
            const results = await Promise.allSettled(targets.map((t) => libraryApi.remove(t.id)));
            const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
            if (failure) {
              showDialog({
                title: "Could not delete",
                message: toApiError(failure.reason).message,
                icon: "alert-circle-outline",
                tone: "danger",
              });
              load();
            }
          },
        },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  function chooseSort() {
    showDialog({
      title: "Sort library",
      message: "Choose how transcriptions are ordered.",
      icon: "swap-vertical-outline",
      actions: [
        {
          label: "Newest first",
          // The active order is marked with a tick rather than by
          // appending " ✓" to the label, as the OS sheet had to.
          icon: sortOrder === "newest" ? "checkmark" : undefined,
          onPress: () => setSortOrder("newest"),
        },
        {
          label: "Oldest first",
          icon: sortOrder === "oldest" ? "checkmark" : undefined,
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
        <Animated.View style={fadeWithSearch} pointerEvents={searchOpen ? "none" : "auto"}>
          <Touchable
            onPress={() => nav.navigate("Tabs", { screen: "Record" })}
            style={styles.iconBtn}
            radius={radii.pill}
            accessibilityLabel="New transcription"
          >
            <Ionicons name="add" size={22} color={colors.text} />
          </Touchable>
        </Animated.View>
        <Animated.View style={[styles.searchPill, pillStyle]}>
          {searchOpen ? (
            <>
              <Ionicons name="search-outline" size={18} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search your sheets"
                placeholderTextColor={colors.textFaint}
                value={query}
                onChangeText={setQuery}
                autoFocus
                returnKeyType="search"
                textAlignVertical="center"
              />
              <Touchable onPress={closeSearch} hitSlop={8} ripple="borderless" accessibilityLabel="Close search">
                <Ionicons name="close-circle" size={18} color={colors.textFaint} />
              </Touchable>
            </>
          ) : (
            <Touchable onPress={() => setSearchOpen(true)} style={styles.searchBtn} radius={radii.pill} accessibilityLabel="Search library">
              <Ionicons name="search-outline" size={19} color={colors.text} />
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
        <Touchable style={styles.sortBtn} hitSlop={8} ripple="borderless" accessibilityLabel="Sort library" onPress={chooseSort}>
          <Ionicons name="swap-vertical" size={18} color={colors.textMuted} />
        </Touchable>
      </View>

      {/* ── The open folder's one public link ─────────────────────────────────── */}
      {folder !== null && (
        <Touchable
          onPress={() => void shareFolder()}
          disabled={sharingFolder}
          style={styles.banner}
          radius={18}
          accessibilityLabel={folderLink ? `Share the link to ${folder} again` : `Share ${folder} with one link`}
        >
          <Ionicons name="link" size={20} color={colors.accent} />
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
  ) : (
    <View style={styles.emptyContainer}>
      <Mark height={40} color={loadError ? colors.danger : colors.textFaint} />
      <Text style={styles.emptyLine}>
        {loadError
          ? loadError
          : query.trim()
            ? `Nothing here matches “${query.trim()}”.`
            : folder !== null
              ? "Nothing in this folder yet."
              : "Your sheets will live here."}
      </Text>
      {loadError
        ? emptyAction("Try again", () => {
            setLoading(true);
            load();
          })
        : query.trim()
          ? emptyAction("Clear search", closeSearch)
          : folder !== null
            ? emptyAction("Show all", () => setFolder(null))
            : emptyAction("Record a tune", () => nav.navigate("Tabs", { screen: "Record" }))}
    </View>
  );

  return (
    <Screen edges={["top"]}>
      <FlatList
        data={sortedItems}
        extraData={selected}
        keyExtractor={(t) => t.id}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
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
          <LibraryRow
            item={item}
            subtitle={subtitleFor(item)}
            selecting={selecting}
            selected={selected.has(item.id)}
            onPress={() => (selecting ? toggle(item) : void openItem(item))}
            onLongPress={() => startSelecting(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.itemDivider} />}
        ListEmptyComponent={empty}
      />
      {selecting && (
        <SelectionBar
          count={selected.size}
          sharing={sharingSelection}
          onClose={() => setSelected(new Set())}
          onDelete={() => confirmDelete(selectedItems)}
          onMove={() => chooseFolder(selectedItems)}
          onShare={() => void shareSelected(selectedItems)}
        />
      )}
      <Modal visible={naming !== null} transparent animationType="fade" onRequestClose={() => setNaming(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New folder</Text>
            <TextField
              label="Folder name"
              placeholder="Sunday choir, Easter service…"
              value={newFolder}
              onChangeText={setNewFolder}
              autoFocus
              maxLength={80}
            />
            <View style={styles.modalActions}>
              <Button label="Cancel" variant="secondary" onPress={() => setNaming(null)} />
              <Button
                label="Move here"
                disabled={newFolder.trim().length === 0}
                onPress={() => {
                  const targets = naming;
                  setNaming(null);
                  if (targets) void fileIn(targets, newFolder.trim());
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
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
    emptyLine: {
      fontFamily: fonts.regular,
      fontSize: 15,
      color: c.textMuted,
      textAlign: "center",
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

    // ── New folder sheet ──────────────────────────────────────────────────────
    modalBackdrop: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: "center",
      padding: spacing.lg,
    },
    modalCard: {
      backgroundColor: c.surface,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.lg,
      gap: spacing.md,
    },
    modalTitle: {
      ...typography.heading,
      color: c.text,
    },
    modalActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: spacing.sm,
    },
  });
