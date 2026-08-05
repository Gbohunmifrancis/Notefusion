import React, { useMemo, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { NotePlayer } from "../components/NotePlayer";
import { libraryApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import {
  colors,
  confidenceColor,
  gradients,
  radii,
  spacing,
  typography,
} from "../design/theme";
import type { RootStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "Result">;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ResultScreen — luxury dark-mode transcription result.
 *
 * Layout (top → bottom):
 *   • Back arrow + "Transcription Complete" title row.
 *   • Summary glass card: Key, Tempo, Meter chips + ConfidenceBadge + warn row.
 *   • Hero Solfa glassmorphism card:
 *       – Gradient header bar ("TONIC SOLFA" label).
 *       – Large monospace solfa lines in Crisp White.
 *       – Confidence pill badge (green / amber / red) inside the card.
 *   • Horizontal notes grid: each chip shows the solfa symbol, MIDI number,
 *     and a coloured confidence bar at the bottom.
 *   • Save block: TextField + gradient "Save to Library" button.
 *   • Saved state: gold-glowing checkmark row.
 *
 * PRD honesty rule: overall-confidence banner is always visible; low-confidence
 * notes are outlined in red so users know to double-check.
 */
export function ResultScreen({ route, navigation }: Props) {
  const {
    result,
    sourceJobId,
    savedId: initialSavedId,
    title: initialTitle,
  } = route.params;

  const [title, setTitle] = useState(
    initialTitle ?? `${result.key} · ${new Date().toLocaleDateString()}`,
  );
  const [savedId, setSavedId] = useState<string | undefined>(initialSavedId);
  const [saving, setSaving] = useState(false);

  const lowCount = useMemo(
    () => result.notes.filter((n) => n.conf < 0.5).length,
    [result.notes],
  );

  async function save() {
    setSaving(true);
    try {
      const saved = await libraryApi.save({
        title: title.trim() || `${result.key} transcription`,
        key: result.key,
        tempoBpm: result.tempo,
        timeSignature: result.timeSignature,
        musicXml: result.musicXml,
        notes: result.notes,
        overallConfidence: result.overallConfidence,
        sourceJobId,
      });
      setSavedId(saved.id);
      Alert.alert("Saved ✓", "Added to your library.");
    } catch (e) {
      Alert.alert("Could not save", toApiError(e).message);
    } finally {
      setSaving(false);
    }
  }

  const confColor = confidenceColor(result.overallConfidence);
  const confPct = Math.round(result.overallConfidence * 100);

  return (
    <Screen scroll>
      {/* ── Header row ───────────────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          {/* Glass back button */}
          <View style={styles.backCircle}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </View>
        </TouchableOpacity>

        <View style={styles.titleBlock}>
          <Text style={styles.titleLabel}>Transcription</Text>
          <Text style={styles.titleMain}>Complete</Text>
        </View>

        {/* Compact confidence pill — top-right */}
        <View
          style={[
            styles.confPill,
            {
              backgroundColor: `${confColor}20`,
              borderColor: `${confColor}50`,
            },
          ]}
        >
          {/* Glowing dot */}
          <View
            style={[
              styles.confDot,
              {
                backgroundColor: confColor,
                shadowColor: confColor,
              },
            ]}
          />
          <Text style={[styles.confPillText, { color: confColor }]}>
            {confPct}%
          </Text>
        </View>
      </View>

      {/* ── Summary card ─────────────────────────────────────────────────── */}
      <Card style={styles.summaryCard}>
        {/* Three stat chips */}
        <View style={styles.summaryRow}>
          <SummaryStat
            icon="key-outline"
            label="Key"
            value={result.key}
            accent={colors.purple}
          />
          <View style={styles.summaryDivider} />
          <SummaryStat
            icon="speedometer-outline"
            label="Tempo"
            value={`${result.tempo} BPM`}
            accent={colors.gold}
          />
          <View style={styles.summaryDivider} />
          <SummaryStat
            icon="grid-outline"
            label="Meter"
            value={result.timeSignature}
            accent="#22C55E"
          />
        </View>

        {/* Full confidence badge */}
        <View style={styles.confRow}>
          <ConfidenceBadge value={result.overallConfidence} />
        </View>

        {/* Low-confidence warning */}
        {lowCount > 0 && (
          <View style={styles.warnRow}>
            <View style={styles.warnDot} />
            <Text style={styles.warnText}>
              {lowCount} note{lowCount > 1 ? "s" : ""} below 50% confidence —
              worth a quick review.
            </Text>
          </View>
        )}
      </Card>

      {/* ── Hero Solfa card ──────────────────────────────────────────────── */}
      <View style={styles.solfaCardWrap}>
        {/* Gradient header strip */}
        <LinearGradient
          colors={gradients.brand}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.solfaHeader}
        >
          <Ionicons name="musical-notes" size={14} color="#FFFFFF" />
          <Text style={styles.solfaHeaderLabel}>TONIC SOLFA</Text>

          {/* Confidence badge inside header */}
          <View style={styles.solfaHeaderBadge}>
            <Text style={styles.solfaHeaderBadgeText}>{confPct}% Match</Text>
          </View>
        </LinearGradient>

        {/* Glass card body */}
        <View style={styles.solfaBody}>
          {result.solfaLines.length === 0 ? (
            <Text style={styles.solfaMuted}>No solfa lines produced.</Text>
          ) : (
            result.solfaLines.map((line, i) => (
              <View key={i} style={styles.solfaLineWrap}>
                {/* Line number chip */}
                {result.solfaLines.length > 1 && (
                  <Text style={styles.solfaLineNum}>{i + 1}</Text>
                )}
                <Text
                  style={[styles.solfaLine, i === 0 && styles.solfaLineFirst]}
                >
                  {line}
                </Text>
              </View>
            ))
          )}

          {/* Decorative watermark */}
          <Text style={styles.solfaWatermark}>♪</Text>
        </View>
      </View>

      {/* ── Playback: hear the transcribed melody ───────────────────────── */}
      {result.audioPreviewBase64 ? (
        <NotePlayer
          audioPreviewBase64={result.audioPreviewBase64}
          notes={result.notes}
          tempoBpm={result.tempo}
          title="Play back"
          style={styles.playerCard}
        />
      ) : null}

      {/* ── Notes grid ───────────────────────────────────────────────────── */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>
          Notes <Text style={styles.sectionCount}>({result.notes.length})</Text>
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.notesScroll}
        contentContainerStyle={styles.notesContent}
      >
        {result.notes.map((n, i) => {
          const cc = confidenceColor(n.conf);
          return (
            <View
              key={i}
              style={[
                styles.noteChip,
                {
                  borderColor: `${cc}55`,
                  // Low confidence gets a more visible warning border
                  borderWidth: n.conf < 0.5 ? 1.5 : 1,
                },
              ]}
            >
              {/* Solfa syllable */}
              <Text style={styles.noteSolfa}>
                {n.solfa}
                {n.octaveMark}
              </Text>

              {/* MIDI number */}
              <Text style={styles.noteMidi}>{n.pitchMidi}</Text>

              {/* Confidence colour bar at the bottom */}
              <View
                style={[
                  styles.noteConfBar,
                  {
                    backgroundColor: cc,
                    shadowColor: cc,
                  },
                ]}
              />
            </View>
          );
        })}
      </ScrollView>

      {/* ── Save block ───────────────────────────────────────────────────── */}
      {!savedId ? (
        <View style={styles.saveBlock}>
          {/* Divider */}
          <View style={styles.divider} />

          <Text style={styles.saveLabel}>Save to Library</Text>
          <Text style={styles.saveHint}>
            Give this transcription a name so you can find it later.
          </Text>

          <TextField
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Name this transcription…"
          />

          {/* Gradient primary save button */}
          <Button
            label="Save to Library"
            icon="bookmark"
            onPress={save}
            loading={saving}
            disabled={!title.trim()}
          />

          {/* Ghost edit notes — placeholder for future edit flow */}
          <Button
            label="Edit Notes"
            variant="ghost"
            icon="create-outline"
            style={styles.editBtn}
          />
        </View>
      ) : (
        /* ── Saved state ─────────────────────────────────────────────────── */
        <View style={styles.savedRow}>
          <LinearGradient
            colors={gradients.gold}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.savedIconCircle}
          >
            <Ionicons name="checkmark" size={18} color="#FFFFFF" />
          </LinearGradient>
          <View style={styles.savedTextBlock}>
            <Text style={styles.savedTitle}>Saved to Library</Text>
            <Text style={styles.savedSub}>
              You can find it in the Library tab.
            </Text>
          </View>
        </View>
      )}
    </Screen>
  );
}

// ─── SummaryStat sub-component ────────────────────────────────────────────────

function SummaryStat({
  icon,
  label,
  value,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <View style={styles.statItem}>
      {/* Tinted icon circle */}
      <View style={[styles.statIconCircle, { backgroundColor: `${accent}18` }]}>
        <Ionicons name={icon} size={14} color={accent} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Header ────────────────────────────────────────────────────────────────

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },

  backBtn: {
    // Generous touch target
  },

  /** Glass circle back button. */
  backCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },

  titleBlock: {
    flex: 1,
    marginHorizontal: spacing.md,
  },

  titleLabel: {
    ...typography.caption,
    color: colors.textFaint,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontSize: 10,
  },

  titleMain: {
    ...typography.title,
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.4,
    marginTop: 1,
  },

  /** Compact confidence pill — top-right corner of the header. */
  confPill: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
  },

  confDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 5,
    // Glow via shadow (set inline)
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 5,
    elevation: 3,
  },

  confPillText: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: "700",
  },

  // ── Summary card ──────────────────────────────────────────────────────────

  summaryCard: {
    marginBottom: spacing.xl,
  },

  playerCard: {
    marginBottom: spacing.xl,
  },

  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },

  /** Vertical divider between stat chips. */
  summaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  statItem: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },

  statIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },

  statValue: {
    ...typography.label,
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },

  statLabel: {
    ...typography.caption,
    color: colors.textFaint,
    fontSize: 10,
    textAlign: "center",
  },

  confRow: {
    paddingTop: spacing.md,
    alignItems: "center",
  },

  /** Warning row — shown when some notes are < 50 % confidence. */
  warnRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(245,158,11,0.15)",
  },

  warnDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.warning,
    marginRight: spacing.sm,
    marginTop: 3,
    shadowColor: colors.warning,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 3,
  },

  warnText: {
    ...typography.caption,
    color: colors.warning,
    flex: 1,
    lineHeight: 18,
    fontSize: 12,
  },

  // ── Solfa hero card ────────────────────────────────────────────────────────

  solfaCardWrap: {
    borderRadius: radii.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    marginBottom: spacing.xl,
    // Purple glow
    shadowColor: colors.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 8,
  },

  /** Gradient strip at the top of the solfa card. */
  solfaHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    gap: spacing.xs,
  },

  solfaHeaderLabel: {
    ...typography.caption,
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    flex: 1,
    marginLeft: 2,
  },

  /** Small pill badge inside the gradient header. */
  solfaHeaderBadge: {
    backgroundColor: "rgba(255,255,255,0.20)",
    borderRadius: radii.pill,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.30)",
  },

  solfaHeaderBadgeText: {
    ...typography.caption,
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },

  /** Glass card body — the main solfa display area. */
  solfaBody: {
    backgroundColor: "rgba(168, 85, 247, 0.06)",
    padding: spacing.xl,
    minHeight: 120,
    position: "relative",
    overflow: "hidden",
  },

  solfaLineWrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },

  /** Optional line-number prefix for multi-line results. */
  solfaLineNum: {
    ...typography.caption,
    color: colors.textFaint,
    fontSize: 11,
    marginRight: spacing.sm,
    marginTop: 3,
    width: 14,
    textAlign: "right",
  },

  solfaLine: {
    ...typography.mono,
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 26,
    flex: 1,
    letterSpacing: 1,
  },

  /** First line gets full Crisp White — it's the primary solfa sequence. */
  solfaLineFirst: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 2,
    lineHeight: 30,
    // Subtle purple text-shadow glow
    textShadowColor: "rgba(168, 85, 247, 0.6)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },

  solfaMuted: {
    ...typography.body,
    color: colors.textFaint,
    fontStyle: "italic",
  },

  /** Decorative ghost note — bottom-right watermark inside the card. */
  solfaWatermark: {
    position: "absolute",
    right: spacing.xl,
    bottom: -8,
    fontSize: 80,
    color: "rgba(168, 85, 247, 0.06)",
    fontWeight: "700",
    lineHeight: 90,
  },

  // ── Section header ─────────────────────────────────────────────────────────

  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },

  sectionTitle: {
    ...typography.heading,
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },

  sectionCount: {
    color: colors.textFaint,
    fontWeight: "400",
    fontSize: 14,
  },

  // ── Notes grid ─────────────────────────────────────────────────────────────

  notesScroll: {
    marginHorizontal: -spacing.xl,
    marginBottom: spacing.xl,
  },

  notesContent: {
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },

  /** Individual note chip — coloured border signals confidence level. */
  noteChip: {
    width: 60,
    borderRadius: radii.md,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    paddingTop: spacing.sm,
    paddingBottom: 0,
    overflow: "hidden",
  },

  noteSolfa: {
    ...typography.label,
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },

  noteMidi: {
    ...typography.caption,
    color: colors.textFaint,
    marginVertical: spacing.xs,
    fontSize: 10,
  },

  /** Coloured bar at the very bottom of the chip — glows to match confidence. */
  noteConfBar: {
    height: 3,
    width: "100%",
    // Shadow set inline via shadowColor
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 4,
    elevation: 2,
  },

  // ── Save block ─────────────────────────────────────────────────────────────

  saveBlock: {
    marginTop: spacing.xs,
    paddingBottom: spacing.xxl,
  },

  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.07)",
    marginBottom: spacing.xl,
  },

  saveLabel: {
    ...typography.heading,
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },

  saveHint: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },

  editBtn: {
    marginTop: spacing.xs,
  },

  // ── Saved state ────────────────────────────────────────────────────────────

  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xxl,
    marginBottom: spacing.xxl,
    backgroundColor: "rgba(245, 158, 11, 0.07)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.20)",
    borderRadius: radii.lg,
    padding: spacing.lg,
  },

  savedIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
    // Gold glow
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 6,
  },

  savedTextBlock: {
    flex: 1,
  },

  savedTitle: {
    ...typography.label,
    color: colors.gold,
    fontSize: 15,
    fontWeight: "700",
  },

  savedSub: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    fontSize: 12,
  },
});
