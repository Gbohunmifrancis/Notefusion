import React, { useCallback, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
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
import { deriveSolfa } from "../lib/solfa";
import {
  gradients,
  radii,
  spacing,
  typography,
  type Palette,
} from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { appIcons } from "../design/icons";
import type { SavedTranscription } from "../api/types";
import type { RootStackParams } from "../navigation/types";

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * LibraryScreen — light blue saved transcriptions list.
 *
 * Design language:
 *   • Mist canvas with ambient blue glow orb behind the title.
 *   • Each transcription row is a white card:
 *       – Gradient note icon bubble (purple → gold, varying per item).
 *       – Title in Ink Navy, metadata in Slate.
 *       – Confidence badge (traffic-light coloured).
 *       – Right chevron as a subtle navigation affordance.
 *   • Pull-to-refresh with a blue tint colour.
 *   • Long-press to delete (with confirmation alert).
 *   • Empty state: ambient orb + ghost icon + Slate copy.
 *   • Section count chip below the title.
 */
export function LibraryScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const [items, setItems] = useState<SavedTranscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

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
      // The library DTO carries pitches but no syllables, so solfa is
      // re-derived here rather than shipped — same engine, movable do.
      const derived = deriveSolfa(
        full.notes ?? [],
        full.key,
        full.timeSignature,
      );
      nav.navigate("Result", {
        result: {
          key: full.key,
          keyConfidence: 1,
          tempo: full.tempoBpm,
          timeSignature: full.timeSignature,
          // The detail read carries the engraved score, so a saved item is
          // exportable; the list read omits it, hence the detail fetch above.
          musicXml: full.musicXml ?? "",
          midiBase64: "",
          notes: derived.notes,
          solfaLines: derived.solfaLines,
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
    ["#2563EB", "#3B82F6"], // deep blue → bright blue  (The Fusion)
    ["#0EA5E9", "#2563EB"], // sky → blue
    ["#2563EB", "#1D4ED8"], // blue → deep blue
    ["#3B82F6", "#60A5FA"], // bright blue → light blue
    ["#16A34A", "#16A34A"], // green (high confidence vibe)
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
          colors={["transparent", "rgba(37,99,235,0.35)", "transparent"]}
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
            <Image source={appIcons.songbook} style={styles.emptyBubbleImg} />
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
                    <Image source={appIcons.music} style={styles.noteIconImg} />
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
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.metaChip}>
      <Ionicons name={icon} size={10} color={colors.textFaint} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
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

  /** Soft blue glow orb — bleeds behind the title from the top-left. */
  ambientOrb: {
    position: "absolute",
    top: -40,
    left: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: c.accentSoft,
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },

  title: {
    ...typography.display,
    color: c.text,
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.5,
  },

  /** Tinted count chip — shows the total number of saved items. */
  countChip: {
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentGlow,
    borderRadius: radii.pill,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm + 2,
    // Blue glow
    shadowColor: c.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 3,
  },

  countText: {
    ...typography.caption,
    color: c.purple,
    fontSize: 12,
    fontWeight: "700",
  },

  subtitle: {
    ...typography.body,
    color: c.textFaint,
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
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    // Faint blue shadow per card
    shadowColor: c.purple,
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
    shadowColor: c.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },

  /** Frosted inner disc inside the bubble. */
  noteIconImg: { width: 22, height: 22 },

  noteIconInner: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
  },

  // ── Card text ───────────────────────────────────────────────────────────────

  cardInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },

  cardTitle: {
    ...typography.label,
    color: c.text,
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
    color: c.textFaint,
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
    // Blue glow
    shadowColor: c.purple,
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

  emptyBubbleImg: { width: 34, height: 34 },

  emptyBubbleInner: {
    width: 76,
    height: 76,
    borderRadius: radii.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
  },

  emptyTitle: {
    ...typography.heading,
    color: c.textMuted,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: spacing.sm,
  },

  emptyBody: {
    ...typography.body,
    color: c.textFaint,
    textAlign: "center",
    fontSize: 14,
    lineHeight: 22,
    maxWidth: 280,
  },
});
