import React, { useEffect, useState } from "react";
import {
  FlatList,
  RefreshControl,
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
import { useColors, useThemedStyles } from "../lib/theme";
import { libraryApi, meApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { showDialog } from "../lib/dialog";
import * as haptics from "../lib/haptics";
import { useSubscription } from "../lib/subscription";
import { deriveSolfa } from "../lib/solfa";
import { synthesizeMelodyWavBase64 } from "../lib/synth";
import { fonts, motion, radii, spacing, typography, type Palette } from "../design/theme";
import type { SavedTranscription } from "../api/types";
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
  const { isPro } = useSubscription();

  const [items, setItems] = useState<SavedTranscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  function load() {
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
    return matchesQuery && matchesFilter;
  });

  const sortedItems = React.useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const tA = new Date(a.createdAtUtc).getTime();
      const tB = new Date(b.createdAtUtc).getTime();
      return sortOrder === "newest" ? tB - tA : tA - tB;
    });
  }, [filteredItems, sortOrder]);

  async function openItem(item: SavedTranscription) {
    try {
      const full = await libraryApi.get(item.id);
      const derived = deriveSolfa(
        full.notes ?? [],
        full.key,
        full.timeSignature
      );
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
              load();
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
              onLongPress={() => confirmDelete(item)}
              style={styles.itemRow}
              // Full-bleed row: a deeper press pulls it off both screen edges.
              scaleTo={motion.scale.row}
              accessibilityLabel={`${item.title}. Long press to delete.`}
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
          !loading ? (
            <View style={styles.emptyContainer}>
              <Ionicons
                name="folder-open-outline"
                size={40}
                color={colors.textFaint}
              />
              <Text style={styles.emptyTitle}>
                {loadError ?? "No saved notes"}
              </Text>
              <Text style={styles.emptySub}>
                {loadError
                  ? "Couldn't load library"
                  : "Recorded transcriptions will appear here."}
              </Text>
            </View>
          ) : null
        }
      />
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

    // ── List Item ─────────────────────────────────────────────────────────────
    itemRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing.md,
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
  });
