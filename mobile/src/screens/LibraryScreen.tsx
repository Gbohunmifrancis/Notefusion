import React, { useEffect, useState } from "react";
import {
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
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Touchable } from "../components/Touchable";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { TranscriptionRowSkeleton } from "../components/Skeleton";
import { useColors, useThemedStyles } from "../lib/theme";
import { libraryApi, meApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { showDialog } from "../lib/dialog";
import * as haptics from "../lib/haptics";
import { useSubscription } from "../lib/subscription";
import { deriveSolfa } from "../lib/solfa";
import { synthesizeMelodyWavBase64 } from "../lib/synth";
import { fonts, motion, radii, spacing, typography, type Palette } from "../design/theme";
import type { NoteEvent, SavedTranscription, TranscriptionResult } from "../api/types";
import type { RootStackParams } from "../navigation/types";

const FILTERS = ["All", "Tonic Solfa", "Staff Notation"] as const;
type FilterType = typeof FILTERS[number];

/**
 * LibraryScreen — 100% aligned with Image 1 design sheet:
 * 1. Centered "Library" page header
 * 2. Rounded pill search input with search icon
 * 3. Pill filter tabs (All, Tonic Solfa, Staff Notation) + options filter icon
 * 4. Card items with blue note icon, date/time subtitle, and notation type badge (Tonic Solfa / Staff)
 */
export function LibraryScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { isPro, refresh: refreshSubscription } = useSubscription();

  const [items, setItems] = useState<SavedTranscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  // Folders ("Sunday choir", "Easter service"): the chip chosen, and the sheet waiting for a new name.
  const [folder, setFolder] = useState<string | null>(null);
  const [naming, setNaming] = useState<SavedTranscription | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [sharingFolder, setSharingFolder] = useState(false);
  const folders = React.useMemo(
    () => [...new Set(items.map((i) => i.folder).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b)),
    [items],
  );

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

  // Filter & sort items based on search query, active tab, and sort order
  const filteredItems = items.filter((item) => {
    const matchesQuery =
      query.trim() === "" ||
      item.title.toLowerCase().includes(query.trim().toLowerCase());
    const matchesFilter =
      activeFilter === "All"
        ? true
        : activeFilter === "Tonic Solfa"
          ? (item.notes?.length ?? 0) > 0
          : Boolean(item.musicXml);
    const matchesFolder = folder === null || item.folder === folder;
    return matchesQuery && matchesFilter && matchesFolder;
  });

  const sortedItems = React.useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const tA = new Date(a.createdAtUtc).getTime();
      const tB = new Date(b.createdAtUtc).getTime();
      return sortOrder === "newest" ? tB - tA : tA - tB;
    });
  }, [filteredItems, sortOrder]);

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



  /** Files a sheet; the list updates in place, so the chips follow at once. */
  async function fileIn(item: SavedTranscription, name: string | null) {
    try {
      await libraryApi.setFolder(item.id, name);
      setItems((prev) => prev.map((t) => (t.id === item.id ? { ...t, folder: name } : t)));
      haptics.play("success");
    } catch (e) {
      showDialog({ title: "Could not move the sheet", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
    }
  }

  function chooseFolder(item: SavedTranscription) {
    showDialog({
      title: "Move to folder",
      message: `Where should “${item.title}” go?`,
      icon: "folder-outline",
      actions: [
        ...folders.slice(0, 6).map((f) => ({
          label: f,
          icon: (item.folder === f ? "checkmark" : undefined) as "checkmark" | undefined,
          onPress: () => void fileIn(item, f),
        })),
        { label: "New folder…", onPress: () => { setNewFolder(""); setNaming(item); } },
        ...(item.folder ? [{ label: "Take out of folder", onPress: () => void fileIn(item, null) }] : []),
        { label: "Cancel", style: "cancel" as const },
      ],
    });
  }

  /** Long press: the sheet's actions, filing first because it is the everyday one. */
  function itemActions(item: SavedTranscription) {
    haptics.play("light");
    showDialog({
      title: item.title,
      message: item.folder ? `In “${item.folder}”.` : "Not in a folder.",
      icon: "musical-notes-outline",
      actions: [
        { label: "Move to folder…", icon: "folder-outline", onPress: () => chooseFolder(item) },
        { label: "Delete", icon: "trash-outline", onPress: () => confirmDelete(item) },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  async function shareFolder() {
    if (!folder) return;
    setSharingFolder(true);
    try {
      const link = await libraryApi.shareFolder(folder);
      await Share.share({ message: `${folder} — songs on NoteFusion: ${link.url}` });
    } catch (e) {
      showDialog({ title: "Could not share the folder", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
    } finally {
      setSharingFolder(false);
    }
  }

  function confirmDelete(item: SavedTranscription) {
    // Reached by long-pressing a row, so the dialog is the first sign anything
    // happened — the warning pattern is what makes the long press land.
    haptics.play("warning");
    showDialog({
      title: "Delete transcription",
      message: `Remove "${item.title}"? This cannot be undone.`,
      icon: "trash-outline",
      tone: "danger",
      actions: [
        {
          label: "Delete",
          style: "destructive",
          onPress: async () => {
            setItems((prev) => prev.filter((t) => t.id !== item.id));
            try {
              await libraryApi.remove(item.id);
            } catch (e) {
              showDialog({
                title: "Could not delete",
                message: toApiError(e).message,
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

  return (
    <Screen edges={["top"]}>
      <FlatList
        data={sortedItems}
        keyExtractor={(t) => t.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
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
        ListHeaderComponent={
          <View style={styles.headerArea}>
            {/* ── Page Title ────────────────────────────────────────────── */}
            <Text style={styles.pageTitle}>Library</Text>

            {/* ── Search Bar ────────────────────────────────────────────── */}
            <View style={styles.searchBar}>
              <Ionicons
                name="search-outline"
                size={18}
                color={colors.textFaint}
                style={styles.searchIcon}
              />
              <TextInput
                style={styles.searchInput}
                placeholder="Search notes..."
                placeholderTextColor={colors.textFaint}
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
                clearButtonMode="while-editing"
                textAlignVertical="center"
              />
              {query.length > 0 && (
                <Touchable
                  onPress={() => setQuery("")}
                  hitSlop={8}
                  ripple="borderless"
                  accessibilityLabel="Clear search"
                  style={styles.clearSearchBtn}
                >
                  <Ionicons name="close-circle" size={18} color={colors.textFaint} />
                </Touchable>
              )}
            </View>

            {/* Filter Tabs + Options Icon Row */}
            <View style={styles.filterRow}>
              <View style={styles.filterTabs}>
                {FILTERS.map((f) => {
                  const isActive = activeFilter === f;
                  return (
                    <Touchable
                      key={f}
                      onPress={() => setActiveFilter(f)}
                      style={[
                        styles.filterTab,
                        isActive && styles.filterTabActive,
                      ]}
                      radius={radii.pill}
                      accessibilityState={{ selected: isActive }}
                      accessibilityLabel={`Filter: ${f}`}
                    >
                      <Text
                        style={[
                          styles.filterTabText,
                          isActive && styles.filterTabTextActive,
                        ]}
                      >
                        {f}
                      </Text>
                    </Touchable>
                  );
                })}
              </View>

              {/* Filter controls icon */}
              <Touchable
                style={styles.optionsBtn}
                hitSlop={8}
                ripple="borderless"
                accessibilityLabel="Sort library"
                onPress={() => {
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
                }}
              >
                <Ionicons
                  name="options-outline"
                  size={20}
                  color={colors.text}
                />
              </Touchable>
            </View>

            {folders.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.folderChips}>
                {[null, ...folders].map((f) => {
                  const active = folder === f;
                  return (
                    <Touchable
                      key={f ?? "__all"}
                      onPress={() => setFolder(f)}
                      style={[styles.filterTab, active && styles.filterTabActive]}
                      radius={radii.pill}
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={f ? `Folder: ${f}` : "All folders"}
                    >
                      <Text style={[styles.filterTabText, active && styles.filterTabTextActive]}>
                        {f ?? "All folders"}
                      </Text>
                    </Touchable>
                  );
                })}
              </ScrollView>
            )}
            {folder !== null && (
              <Button
                label="Share the folder"
                icon="share-outline"
                variant="secondary"
                loading={sharingFolder}
                onPress={() => void shareFolder()}
                style={styles.folderShare}
              />
            )}
          </View>
        }
        renderItem={({ item }) => {
          const dateStr = new Date(item.createdAtUtc).toLocaleDateString(
            "en-US",
            { month: "short", day: "numeric", year: "numeric" }
          );
          const timeStr = new Date(item.createdAtUtc).toLocaleTimeString(
            "en-US",
            { hour: "2-digit", minute: "2-digit" }
          );

          const isStaff = Boolean(item.musicXml);

          return (
            <Touchable
              onPress={() => openItem(item)}
              onLongPress={() => itemActions(item)}
              style={styles.itemRow}
              // Full-bleed row: a deeper press pulls it off both screen edges.
              scaleTo={motion.scale.row}
              accessibilityLabel={`${item.title}${item.folder ? `, in ${item.folder}` : ""}. Long press to move or delete.`}
            >
              {/* Note icon badge — gold for Pro accounts, the same premium accent the
                  avatar ring and the Home chip use. It is the row's visual anchor, so
                  it carries the signal without adding chrome the rows don't have. */}
              <View
                style={[styles.noteIconBadge, isPro && styles.noteIconBadgePremium]}
              >
                <Ionicons
                  name="musical-notes-outline"
                  size={22}
                  color={isPro ? colors.premium : colors.accent}
                />
              </View>

              {/* Item Info */}
              <View style={styles.itemInfo}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.itemDate}>
                  {dateStr} • {timeStr}
                </Text>
              </View>

              {/* Notation Type Pill Badge */}
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>
                  {isStaff ? "Staff" : "Tonic Solfa"}
                </Text>
              </View>

            </Touchable>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.itemDivider} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.skeletonContainer}>
              <TranscriptionRowSkeleton />
              <TranscriptionRowSkeleton />
              <TranscriptionRowSkeleton />
              <TranscriptionRowSkeleton />
              <TranscriptionRowSkeleton />
            </View>
          ) : loadError ? (
            <View style={styles.emptyContainer}>
              <Ionicons
                name="cloud-offline-outline"
                size={40}
                color={colors.danger}
              />
              <Text style={styles.emptyTitle}>Could not load library</Text>
              <Text style={styles.emptySub}>{loadError}</Text>
              <Touchable
                onPress={load}
                style={styles.retryBtn}
                radius={radii.pill}
                accessibilityLabel="Try loading library again"
              >
                <Text style={styles.retryLabel}>Try again</Text>
              </Touchable>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons
                name={
                  query.trim() || activeFilter !== "All"
                    ? "search-outline"
                    : "folder-open-outline"
                }
                size={40}
                color={colors.textFaint}
              />
              <Text style={styles.emptyTitle}>
                {query.trim() || activeFilter !== "All"
                  ? "No matching notes"
                  : "No saved notes"}
              </Text>
              <Text style={styles.emptySub}>
                {query.trim() || activeFilter !== "All"
                  ? `No transcriptions found matching your filter.`
                  : "Recorded transcriptions will appear here."}
              </Text>
              {(query.trim() || activeFilter !== "All") && (
                <Touchable
                  onPress={() => {
                    setQuery("");
                    setActiveFilter("All");
                  }}
                  style={styles.clearFiltersBtn}
                  radius={radii.pill}
                  accessibilityLabel="Clear search and filter"
                >
                  <Text style={styles.clearFiltersLabel}>Clear filters</Text>
                </Touchable>
              )}
            </View>
          )
        }
      />
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
                  const item = naming;
                  setNaming(null);
                  if (item) void fileIn(item, newFolder.trim());
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
    headerArea: {
      paddingTop: spacing.xs,
      marginBottom: spacing.md,
    },
    pageTitle: {
      fontSize: 20,
      fontFamily: fonts.bold,
      color: c.text,
      textAlign: "center",
      marginBottom: spacing.md,
    },

    // ── Search Bar ────────────────────────────────────────────────────────────
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surface,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.lg,
      height: 46,
      marginBottom: spacing.md,
    },
    searchIcon: {
      marginRight: spacing.sm,
    },
    searchInput: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: c.text,
      height: "100%",
      paddingVertical: 0,
    },

    // ── Filter Row ────────────────────────────────────────────────────────────
    filterRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.sm,
    },
    filterTabs: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    filterTab: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: radii.pill,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    /** `ink`, not `accent`: this is a fill carrying white text, so it has to stay
     *  dark in both modes — the lifted dark-mode accent fails AA at this size. */
    filterTabActive: {
      backgroundColor: c.ink,
      borderColor: c.ink,
    },
    filterTabText: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: c.textMuted,
    },
    filterTabTextActive: {
      color: c.onInk,
      fontFamily: fonts.bold,
    },
    optionsBtn: {
      padding: spacing.xs,
    },
    folderChips: {
      flexDirection: "row",
      gap: spacing.xs,
      paddingTop: spacing.sm,
    },
    folderShare: {
      marginTop: spacing.sm,
      alignSelf: "flex-start",
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "center",
      padding: spacing.lg,
    },
    modalCard: {
      backgroundColor: c.surface,
      borderRadius: radii.lg,
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

    // ── List Item ─────────────────────────────────────────────────────────────
    itemRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing.md,
    },
    playButton: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: spacing.xs,
    },
    noteIconBadge: {
      width: 44,
      height: 44,
      borderRadius: radii.md,
      backgroundColor: c.accentSoft,
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.md,
    },
    noteIconBadgePremium: {
      backgroundColor: c.premiumSoft,
      borderWidth: 1,
      borderColor: c.premiumBorder,
    },
    itemInfo: {
      flex: 1,
    },
    itemTitle: {
      fontSize: 16,
      fontFamily: fonts.bold,
      color: c.text,
      marginBottom: 2,
    },
    itemDate: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: c.textMuted,
    },
    typeBadge: {
      backgroundColor: c.accentSoft,
      borderRadius: radii.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
    },
    typeBadgeText: {
      fontSize: 12,
      fontFamily: fonts.semibold,
      color: c.accent,
    },
    itemDivider: {
      height: 1,
      backgroundColor: c.border,
    },

    emptyContainer: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.xxl,
    },
    emptyTitle: {
      fontSize: 16,
      fontFamily: fonts.bold,
      color: c.text,
      marginTop: spacing.md,
    },
    emptySub: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: c.textMuted,
      marginTop: 2,
    },
    clearSearchBtn: {
      padding: spacing.xs,
    },
    skeletonContainer: {
      paddingVertical: spacing.sm,
    },
    retryBtn: {
      marginTop: spacing.md,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    retryLabel: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: c.text,
    },
    clearFiltersBtn: {
      marginTop: spacing.md,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    clearFiltersLabel: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: c.accent,
    },
  });
