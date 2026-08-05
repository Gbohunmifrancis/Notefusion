import React, { useCallback, useState } from "react";
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { libraryApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { colors, gradients, radii, spacing, typography } from "../design/theme";
import type { SavedTranscription } from "../api/types";
import type { RootStackParams } from "../navigation/types";

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * LibraryScreen — luxury dark-mode saved transcriptions list.
 *
 * Design language:
 *   • Pitch Black canvas with ambient purple glow orb behind the title.
 *   • Each transcription row is a glassmorphism card:
 *       – Gradient note icon bubble (purple → gold, varying per item).
 *       – Title in Crisp White, metadata in Soft Ash.
 *       – Confidence badge (traffic-light coloured).
 *       – Right chevron as a subtle navigation affordance.
 *   • Pull-to-refresh with a purple tint color.
 *   • Long-press to delete (with confirmation alert).
 *   • Empty state: ambient orb + ghost icon + Soft Ash copy.
 *   • Section count chip below the title.
 */
export function LibraryScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const [items, setItems] = useState<SavedTranscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      setItems(await libraryApi.list());
    } catch {
      /* silent — user can pull-to-refresh */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // ── Open transcription ──────────────────────────────────────────────────────

  async function open(item: SavedTranscription) {
    try {
      const full = await libraryApi.get(item.id);
      nav.navigate("Result", {
        result: {
          key: full.key,
          keyConfidence: 1,
          tempo: full.tempoBpm,
          timeSignature: full.timeSignature,
          musicXml: "",
          midiBase64: "",
          notes: full.notes ?? [],
          solfaLines: [],
          overallConfidence: full.overallConfidence,
        },
        savedId: full.id,
        title: full.title,
      });
    } catch (e) {
      Alert.alert("Could not open", toApiError(e).message);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

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
            // Optimistic removal
            setItems((prev) => prev.filter((t) => t.id !== item.id));
            try {
              await libraryApi.remove(item.id);
            } catch (e) {
              Alert.alert("Could not delete", toApiError(e).message);
              load(); // re-fetch to restore correct state
            }
          },
        },
      ],
    );
  }

  // ── Gradient cycle for note icons (each item gets a different accent) ───────

  const ICON_GRADIENTS: readonly (readonly [string, string])[] = [
    ["#A855F7", "#F59E0B"], // purple → gold  (The Fusion)
    ["#D946EF", "#A855F7"], // pink → purple
    ["#A855F7", "#7C3AED"], // purple → deep violet
    ["#F59E0B", "#D97706"], // gold → amber
    ["#22C55E", "#16A34A"], // green (high confidence vibe)
  ] as const;

  // ── List header ─────────────────────────────────────────────────────────────

  const ListHeader = (
    <View style={styles.listHeader}>
      {/* Ambient orb behind title */}
      <View style={styles.ambientOrb} />

      {/* Title row */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>Library</Text>

        {/* Count chip */}
        {items.length > 0 && (
          <View style={styles.countChip}>
            <Text style={styles.countText}>{items.length}</Text>
          </View>
        )}
      </View>

      <Text style={styles.subtitle}>
        {items.length === 0
          ? "Your saved transcriptions will appear here."
          : "Tap to open · Long-press to delete"}
      </Text>

      {/* Gradient divider */}
      {items.length > 0 && (
        <LinearGradient
          colors={["transparent", "rgba(168,85,247,0.35)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.headerDivider}
        />
      )}
    </View>
  );

  // ── Empty state ─────────────────────────────────────────────────────────────

  const EmptyState = !loading ? (
    <View style={styles.empty}>
      {/* Ghost icon bubble */}
      <View style={styles.emptyBubbleWrap}>
        <LinearGradient
          colors={gradients.brandDim}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.emptyBubble}
        >
          <View style={styles.emptyBubbleInner}>
            <Ionicons
              name="folder-open-outline"
              size={36}
              color={colors.textFaint}
            />
          </View>
        </LinearGradient>
      </View>

      <Text style={styles.emptyTitle}>Nothing saved yet</Text>
      <Text style={styles.emptyBody}>
        Transcribe a melody in the Listen tab and tap "Save to Library" to start
        building your collection.
      </Text>
    </View>
  ) : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Screen edges={["top"]}>
      <FlatList
        data={items}
        keyExtractor={(t) => t.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          items.length === 0 ? styles.emptyContainer : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.purple}
            colors={[colors.purple]}
          />
        }
        ListHeaderComponent={ListHeader}
        renderItem={({ item, index }) => {
          const gradPair =
            ICON_GRADIENTS[index % ICON_GRADIENTS.length] ?? ICON_GRADIENTS[0];
          const date = new Date(item.createdAtUtc).toLocaleDateString("en", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });

          return (
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => open(item)}
              onLongPress={() => confirmDelete(item)}
            >
              <View style={styles.card}>
                {/* ── Note icon bubble ─────────────────────────────────── */}
                <LinearGradient
                  colors={gradPair}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.noteIconBubble}
                >
                  <View style={styles.noteIconInner}>
                    <Ionicons name="musical-note" size={18} color="#FFFFFF" />
                  </View>
                </LinearGradient>

                {/* ── Text block ───────────────────────────────────────── */}
                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.title}
                  </Text>

                  {/* Metadata row */}
                  <View style={styles.metaRow}>
                    <MetaChip icon="key-outline" text={item.key} />
                    <MetaChip
                      icon="speedometer-outline"
                      text={`${item.tempoBpm} BPM`}
                    />
                    <MetaChip icon="calendar-outline" text={date} />
                  </View>
                </View>

                {/* ── Right side: badge + chevron ──────────────────────── */}
                <View style={styles.cardRight}>
                  <ConfidenceBadge value={item.overallConfidence} compact />
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.textFaint}
                    style={styles.chevron}
                  />
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={EmptyState}
      />
    </Screen>
  );
}

// ─── MetaChip sub-component ───────────────────────────────────────────────────

function MetaChip({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.metaChip}>
      <Ionicons name={icon} size={10} color={colors.textFaint} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: 120, // clear the floating tab bar
  },

  emptyContainer: {
    flexGrow: 1,
    justifyContent: "center",
  },

  // ── List header ────────────────────────────────────────────────────────────

  listHeader: {
    paddingTop: spacing.sm,
    marginBottom: spacing.lg,
    position: "relative",
  },

  /** Soft purple glow orb — bleeds behind the title from the top-left. */
  ambientOrb: {
    position: "absolute",
    top: -40,
    left: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(168, 85, 247, 0.10)",
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },

  title: {
    ...typography.display,
    color: colors.text,
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.5,
  },

  /** Glass count chip — shows the total number of saved items. */
  countChip: {
    backgroundColor: "rgba(168, 85, 247, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.35)",
    borderRadius: radii.pill,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm + 2,
    // Purple glow
    shadowColor: colors.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 3,
  },

  countText: {
    ...typography.caption,
    color: colors.purple,
    fontSize: 12,
    fontWeight: "700",
  },

  subtitle: {
    ...typography.body,
    color: colors.textFaint,
    fontSize: 13,
    marginBottom: spacing.lg,
  },

  /** Horizontal gradient rule below the header. */
  headerDivider: {
    height: 1,
    marginBottom: spacing.xs,
  },

  // ── Card ───────────────────────────────────────────────────────────────────

  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    // Faint purple shadow per card
    shadowColor: colors.purple,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },

  // ── Note icon bubble ────────────────────────────────────────────────────────

  /** Gradient outer bubble — provides the coloured accent ring. */
  noteIconBubble: {
    width: 46,
    height: 46,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
    // Glow
    shadowColor: colors.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },

  /** Frosted inner disc inside the bubble. */
  noteIconInner: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.20)",
  },

  // ── Card text ───────────────────────────────────────────────────────────────

  cardInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },

  cardTitle: {
    ...typography.label,
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 5,
  },

  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },

  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },

  metaText: {
    ...typography.caption,
    color: colors.textFaint,
    fontSize: 11,
  },

  // ── Card right ──────────────────────────────────────────────────────────────

  cardRight: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },

  chevron: {
    marginTop: 2,
    opacity: 0.5,
  },

  // ── Empty state ─────────────────────────────────────────────────────────────

  empty: {
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxxl,
  },

  emptyBubbleWrap: {
    marginBottom: spacing.xl,
    borderRadius: radii.xl + spacing.md,
    overflow: "hidden",
    // Purple glow
    shadowColor: colors.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 6,
  },

  emptyBubble: {
    width: 100,
    height: 100,
    borderRadius: radii.xl + spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },

  emptyBubbleInner: {
    width: 76,
    height: 76,
    borderRadius: radii.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
  },

  emptyTitle: {
    ...typography.heading,
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: spacing.sm,
  },

  emptyBody: {
    ...typography.body,
    color: colors.textFaint,
    textAlign: "center",
    fontSize: 14,
    lineHeight: 22,
    maxWidth: 280,
  },
});
