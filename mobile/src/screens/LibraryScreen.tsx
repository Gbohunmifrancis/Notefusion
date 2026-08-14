import React, { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { useColors, useThemedStyles } from "../lib/theme";
import { libraryApi, meApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { deriveSolfa } from "../lib/solfa";
import { synthesizeMelodyWavBase64 } from "../lib/synth";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
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

  const [items, setItems] = useState<SavedTranscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");

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

  // Filter items based on search query & active tab
  const filteredItems = items.filter((item) => {
    const matchesQuery =
      query.trim() === "" ||
      item.title.toLowerCase().includes(query.trim().toLowerCase());

    if (!matchesQuery) return false;

    if (activeFilter === "Tonic Solfa") {
      return (item.notes?.length ?? 0) > 0;
    }
    if (activeFilter === "Staff Notation") {
      return Boolean(item.musicXml);
    }
    return true;
  });

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
      Alert.alert("Could not open", toApiError(e).message);
    }
  }

  function confirmDelete(item: SavedTranscription) {
    Alert.alert(
      "Delete transcription",
      `Remove "${item.title}"?\nThis cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setItems((prev) => prev.filter((t) => t.id !== item.id));
            try {
              await libraryApi.remove(item.id);
            } catch (e) {
              Alert.alert("Could not delete", toApiError(e).message);
              load();
            }
          },
        },
      ]
    );
  }

  return (
    <Screen edges={["top"]}>
      <FlatList
        data={filteredItems}
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
            {/* Centered Page Title */}
            <Text style={styles.pageTitle}>Library</Text>

            {/* Pill Search Input */}
            <View style={styles.searchBar}>
              <Ionicons
                name="search-outline"
                size={18}
                color={colors.textFaint}
                style={styles.searchIcon}
              />
              <TextInput
                style={styles.searchInput}
                placeholder="Search your notes"
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
                    <TouchableOpacity
                      key={f}
                      onPress={() => setActiveFilter(f)}
                      style={[
                        styles.filterTab,
                        isActive && styles.filterTabActive,
                      ]}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.filterTabText,
                          isActive && styles.filterTabTextActive,
                        ]}
                      >
                        {f}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Filter controls icon */}
              <TouchableOpacity style={styles.optionsBtn} hitSlop={8}>
                <Ionicons
                  name="options-outline"
                  size={20}
                  color={colors.text}
                />
              </TouchableOpacity>
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
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => openItem(item)}
              onLongPress={() => confirmDelete(item)}
              style={styles.itemRow}
            >
              {/* Blue note icon badge */}
              <View style={styles.noteIconBadge}>
                <Ionicons name="musical-notes-outline" size={22} color="#2563EB" />
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
            </TouchableOpacity>
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
    filterTabActive: {
      backgroundColor: "#2563EB",
      borderColor: "#2563EB",
    },
    filterTabText: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: c.textMuted,
    },
    filterTabTextActive: {
      color: "#FFFFFF",
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
      backgroundColor: "#EFF6FF",
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.md,
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
      backgroundColor: "#EFF6FF",
      borderRadius: radii.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
    },
    typeBadgeText: {
      fontSize: 12,
      fontFamily: fonts.semibold,
      color: "#2563EB",
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
