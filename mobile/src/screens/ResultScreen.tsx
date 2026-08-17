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
import { StaffNotation } from "../components/StaffNotation";
import { libraryApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { deriveSolfa, KEY_CHOICES, sameKey } from "../lib/solfa";
import { exportMusicXml } from "../lib/export";
import {
  confidenceColor,
  fonts,
  gradients,
  radii,
  spacing,
  typography,
  type Palette,
} from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { RootStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "Result">;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ResultScreen — light blue transcription result.
 *
 * Layout (top → bottom):
 *   • Back arrow + "Transcription Complete" title row.
 *   • Summary glass card: Key, Tempo, Meter chips + ConfidenceBadge + warn row.
 *   • Hero Solfa white card:
 *       – Gradient header bar ("TONIC SOLFA" label).
 *       – Large monospace solfa lines in Ink Navy.
 *       – Confidence pill badge (green / amber / red) inside the card.
 *   • Horizontal notes grid: each chip shows the solfa symbol, MIDI number,
 *     and a coloured confidence bar at the bottom.
 *   • Export row: hands the engraved MusicXML to the OS share sheet.
 *   • Save block: TextField + gradient "Save to Library" button.
 *   • Saved state: blue-glowing checkmark row.
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

  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [title, setTitle] = useState(
    initialTitle ?? `${result.key} · ${new Date().toLocaleDateString()}`,
  );
  const [committedTitle, setCommittedTitle] = useState(initialTitle);
  const [savedId, setSavedId] = useState<string | undefined>(initialSavedId);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── Key override (F-03) ────────────────────────────────────────────────────
  // Solfa is movable-do, so a key change re-labels the existing notes — it
  // never re-transcribes. The syllables update locally the instant the user
  // taps, and the choice is persisted only for transcriptions already saved.
  const [key, setKey] = useState(result.key);
  const [pickingKey, setPickingKey] = useState(false);
  const [rekeying, setRekeying] = useState(false);

  // Solfa is the product's headline output; the stave is the familiar cross-check.
  // Both read from the same `view.notes`, so a key change relabels one and
  // re-places the other from the identical data.
  const [notationView, setNotationView] = useState<"solfa" | "staff">("solfa");

  // The server already labelled the original key, so trust its output until
  // the user actually overrides — that keeps the fresh-transcription path
  // byte-identical to what the worker produced.
  const view = useMemo(
    () =>
      key === result.key
        ? { notes: result.notes, solfaLines: result.solfaLines }
        : deriveSolfa(result.notes, key, result.timeSignature),
    [key, result.key, result.notes, result.solfaLines, result.timeSignature],
  );

  const lowCount = useMemo(
    () => view.notes.filter((n) => n.conf < 0.5).length,
    [view.notes],
  );

  async function save() {
    setSaving(true);
    try {
      const saved = await libraryApi.save({
        title: title.trim() || `${key} transcription`,
        key,
        tempoBpm: result.tempo,
        timeSignature: result.timeSignature,
        musicXml: result.musicXml,
        notes: view.notes,
        overallConfidence: result.overallConfidence,
        sourceJobId,
      });
      setSavedId(saved.id);
      setCommittedTitle(saved.title);
      Alert.alert("Saved ✓", "Added to your library.");
    } catch (e) {
      Alert.alert("Could not save", toApiError(e).message);
    } finally {
      setSaving(false);
    }
  }

  async function applyKey(next: string) {
    setPickingKey(false);
    if (sameKey(next, key)) return;

    const previous = key;
    setKey(next); // re-label immediately — no round-trip needed to read solfa

    if (!savedId) return; // unsaved: the key travels with the save payload
    setRekeying(true);
    try {
      await libraryApi.updateKey(savedId, next);
    } catch (e) {
      setKey(previous); // the label would otherwise disagree with the server
      Alert.alert("Could not change key", toApiError(e).message);
    } finally {
      setRekeying(false);
    }
  }

  async function rename() {
    if (!savedId) return;
    setRenaming(true);
    try {
      const updated = await libraryApi.rename(savedId, title.trim());
      setCommittedTitle(updated.title);
      Alert.alert("Renamed ✓", "The title has been updated.");
    } catch (e) {
      Alert.alert("Could not rename", toApiError(e).message);
    } finally {
      setRenaming(false);
    }
  }

  // ── Export (MusicXML) ──────────────────────────────────────────────────────
  // The worker engraved a full score, so this screen owns the "send it to
  // Sibelius / MuseScore" moment; library items reach the same button with the
  // score fetched in the detail read. No success alert — the OS share sheet is
  // its own confirmation, and it has already closed by the time this resolves.
  async function exportScore() {
    setExporting(true);
    try {
      const outcome = await exportMusicXml(result.musicXml, title);
      if (!outcome.ok) Alert.alert("Could not export", outcome.message);
    } finally {
      setExporting(false);
    }
  }

  const hasScore = Boolean(result.musicXml?.trim());

  const confColor = confidenceColor(result.overallConfidence, colors);
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
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>

        <Text style={styles.pageTitle}>Preview</Text>

        <TouchableOpacity
          onPress={() => {
            const options = [
              {
                text: "Export MusicXML",
                onPress: () => exportMusicXml(result.musicXml, committedTitle || title),
              },
            ];
            if (savedId) {
              options.push({
                text: "Delete from Library",
                style: "destructive" as const,
                onPress: async () => {
                  try {
                    await libraryApi.remove(savedId);
                    navigation.goBack();
                  } catch (e) {
                    Alert.alert("Could not delete", toApiError(e).message);
                  }
                },
              } as any);
            }
            options.push({ text: "Cancel", style: "cancel" as const } as any);

            Alert.alert("Transcription Options", "Choose an action:", options);
          }}
          style={styles.optionsBtn}
          hitSlop={8}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* ── Summary card ─────────────────────────────────────────────────── */}
      <Card style={styles.summaryCard}>
        {/* Three stat chips */}
        <View style={styles.summaryRow}>
          <SummaryStat
            icon="key-outline"
            label={rekeying ? "Saving…" : "Key · tap to change"}
            value={key}
            accent={colors.purple}
            onPress={() => setPickingKey((p) => !p)}
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
            accent={colors.success}
          />
        </View>

        {/* ── Key picker (F-03) ────────────────────────────────────────────
            Movable-do means this is a re-labelling, not a re-transcription:
            the notes never move, only the syllables above them. */}
        {pickingKey && (
          <View style={styles.keyPicker}>
            <Text style={styles.keyPickerHint}>
              Change the Doh — your notes stay put, only the labels move.
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.keyPickerScroll}
            >
              {KEY_CHOICES.map((k) =>
                sameKey(k, key) ? (
                  <LinearGradient
                    key={k}
                    colors={gradients.brand}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.keyChip, styles.keyChipActive]}
                  >
                    <Text style={styles.keyChipTextActive}>{k}</Text>
                  </LinearGradient>
                ) : (
                  <TouchableOpacity
                    key={k}
                    style={styles.keyChip}
                    onPress={() => applyKey(k)}
                    disabled={rekeying}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.keyChipText}>{k}</Text>
                  </TouchableOpacity>
                ),
              )}
            </ScrollView>
          </View>
        )}

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

      {/* ── Hero notation card ───────────────────────────────────────────── */}
      <View style={styles.solfaCardWrap}>
        {/* Gradient header strip */}
        <LinearGradient
          colors={gradients.brand}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.solfaHeader}
        >
          <Ionicons name="musical-notes" size={14} color="#FFFFFF" />
          <Text style={styles.solfaHeaderLabel}>
            {notationView === "solfa" ? "TONIC SOLFA" : "STAFF NOTATION"}
          </Text>

          {/* Solfa / Staff segmented toggle */}
          <View style={styles.viewToggle}>
            {(["solfa", "staff"] as const).map((v) => (
              <TouchableOpacity
                key={v}
                onPress={() => setNotationView(v)}
                activeOpacity={0.8}
                style={[
                  styles.viewToggleBtn,
                  notationView === v && styles.viewToggleBtnActive,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: notationView === v }}
                accessibilityLabel={v === "solfa" ? "Show tonic solfa" : "Show staff notation"}
              >
                <Ionicons
                  name={v === "solfa" ? "text" : "musical-note"}
                  size={12}
                  color="#FFFFFF"
                />
                <Text style={styles.viewToggleText}>
                  {v === "solfa" ? "Solfa" : "Staff"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </LinearGradient>

        {/* Body — solfa lines or the engraved stave, from the same note data */}
        <View style={styles.solfaBody}>
          {notationView === "solfa" ? (
            view.solfaLines.length === 0 ? (
              <Text style={styles.solfaMuted}>No solfa lines produced.</Text>
            ) : (
              <>
                {view.solfaLines.map((line, i) => (
                  <View key={i} style={styles.solfaLineWrap}>
                    {/* Line number chip */}
                    {view.solfaLines.length > 1 && (
                      <Text style={styles.solfaLineNum}>{i + 1}</Text>
                    )}
                    <Text
                      style={[styles.solfaLine, i === 0 && styles.solfaLineFirst]}
                    >
                      {line}
                    </Text>
                  </View>
                ))}

                {/* Decorative watermark */}
                <Text style={styles.solfaWatermark}>♪</Text>
              </>
            )
          ) : (
            <StaffNotation
              notes={view.notes}
              timeSignature={result.timeSignature}
            />
          )}
        </View>
      </View>

      {/* ── Playback: hear the transcribed melody ───────────────────────── */}
      {result.audioPreviewBase64 ? (
        <NotePlayer
          audioPreviewBase64={result.audioPreviewBase64}
          notes={view.notes}
          tempoBpm={result.tempo}
          title="Play back"
          style={styles.playerCard}
        />
      ) : null}

      {/* ── Notes grid ───────────────────────────────────────────────────── */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>
          Notes <Text style={styles.sectionCount}>({view.notes.length})</Text>
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.notesScroll}
        contentContainerStyle={styles.notesContent}
      >
        {view.notes.map((n, i) => {
          const cc = confidenceColor(n.conf, colors);
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

      {/* ── Export ───────────────────────────────────────────────────────── */}
      {/* Offered whether or not the transcription is saved — the score exists
          as soon as the worker engraves it, and saving is a separate choice. */}
      <View style={styles.exportBlock}>
        <View style={styles.exportHeaderRow}>
          <Ionicons
            name="document-text-outline"
            size={16}
            color={colors.textMuted}
          />
          <Text style={styles.exportTitle}>Sheet music</Text>
        </View>
        <Text style={styles.exportHint}>
          {hasScore
            ? "Export as MusicXML to open in Sibelius, MuseScore, or Finale."
            : "No score is attached to this transcription."}
        </Text>
        <Button
          label="Export MusicXML"
          variant="secondary"
          icon="share-outline"
          onPress={exportScore}
          loading={exporting}
          disabled={!hasScore}
        />
      </View>

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
        </View>
      ) : (
        /* ── Saved state ─────────────────────────────────────────────────── */
        <View style={styles.saveBlock}>
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

          {/* Rename */}
          <TextField
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Name this transcription…"
          />
          <Button
            label="Rename"
            variant="secondary"
            onPress={rename}
            loading={renaming}
            disabled={!title.trim() || title.trim() === committedTitle}
          />
        </View>
      )}

      {/* ── 3-Button Action Row (Image 2 Screen 3) ────────────────────── */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionBtnOutline}
          onPress={() => setPickingKey((p) => !p)}
        >
          <Text style={styles.actionBtnOutlineText}>Re-key</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtnOutline}
          onPress={() => Alert.alert("Edit Notes", "Edit pitches and durations.")}
        >
          <Text style={styles.actionBtnOutlineText}>Edit</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtnSolid}
          onPress={save}
          disabled={saving}
        >
          <Text style={styles.actionBtnSolidText}>{saving ? "Saving…" : "Save"}</Text>
        </TouchableOpacity>
      </View>
    </Screen>
  );
}

// ─── SummaryStat sub-component ────────────────────────────────────────────────

function SummaryStat({
  icon,
  label,
  value,
  accent,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  accent: string;
  onPress?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  const body = (
    <>
      {/* Tinted icon circle */}
      <View style={[styles.statIconCircle, { backgroundColor: `${accent}18` }]}>
        <Ionicons name={icon} size={14} color={accent} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );

  // Only the interactive stat (Key) gets a touch target, so the other two
  // don't advertise an affordance they don't have.
  return onPress ? (
    <TouchableOpacity
      style={styles.statItem}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {body}
    </TouchableOpacity>
  ) : (
    <View style={styles.statItem}>{body}</View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  // ── Header ────────────────────────────────────────────────────────────────

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },

  pageTitle: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: c.text,
  },

  optionsBtn: {
    padding: spacing.xs,
  },

  backBtn: {
    padding: spacing.xs,
  },

  actionRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },

  actionBtnOutline: {
    flex: 1,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: c.surface,
    borderWidth: 1.5,
    borderColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },

  actionBtnOutlineText: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: "#2563EB",
  },

  actionBtnSolid: {
    flex: 1,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },

  actionBtnSolidText: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: "#FFFFFF",
  },

  /** Glass circle back button. */
  backCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },

  titleBlock: {
    flex: 1,
    marginHorizontal: spacing.md,
  },

  titleLabel: {
    ...typography.caption,
    color: c.textFaint,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontSize: 10,
  },

  titleMain: {
    ...typography.title,
    color: c.text,
    fontSize: 22,
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
    fontFamily: fonts.bold,
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
    borderBottomColor: c.border,
  },

  /** Vertical divider between stat chips. */
  summaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: c.border,
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
    color: c.text,
    fontSize: 14,
    fontFamily: fonts.bold,
    textAlign: "center",
  },

  statLabel: {
    ...typography.caption,
    color: c.textFaint,
    fontSize: 10,
    textAlign: "center",
  },

  confRow: {
    paddingTop: spacing.md,
    alignItems: "center",
  },

  // ── Key picker (F-03 re-key) ───────────────────────────────────────────────

  keyPicker: {
    paddingTop: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    paddingBottom: spacing.md,
  },

  keyPickerHint: {
    ...typography.caption,
    color: c.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },

  keyPickerScroll: {
    gap: spacing.xs,
    paddingRight: spacing.md,
  },

  keyChip: {
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
  },

  keyChipActive: {
    overflow: "hidden",
    borderWidth: 0,
    shadowColor: c.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },

  keyChipText: {
    ...typography.caption,
    color: c.textMuted,
    fontSize: 12,
  },

  keyChipTextActive: {
    ...typography.caption,
    color: "#FFFFFF", // sits on the brand gradient
    fontSize: 12,
    fontFamily: fonts.bold,
  },

  /** Warning row — shown when some notes are < 50 % confidence. */
  warnRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.accentGlow,
  },

  warnDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.warning,
    marginRight: spacing.sm,
    marginTop: 3,
    shadowColor: c.warning,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 3,
  },

  warnText: {
    ...typography.caption,
    color: c.warning,
    flex: 1,
    lineHeight: 18,
    fontSize: 12,
  },

  // ── Solfa hero card ────────────────────────────────────────────────────────

  solfaCardWrap: {
    borderRadius: radii.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: spacing.xl,
    // Blue glow
    shadowColor: c.purple,
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

  // The header strip and its badge sit on the brand gradient — white in both modes.
  solfaHeaderLabel: {
    ...typography.caption,
    color: "#FFFFFF",
    fontSize: 11,
    fontFamily: fonts.bold,
    letterSpacing: 1.5,
    flex: 1,
    marginLeft: 2,
  },

  /** Solfa / Staff segmented toggle inside the gradient header. */
  viewToggle: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: radii.pill,
    padding: 2,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
  },

  viewToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
  },

  viewToggleBtnActive: {
    backgroundColor: "rgba(255,255,255,0.28)",
  },

  viewToggleText: {
    ...typography.caption,
    color: "#FFFFFF",
    fontSize: 11,
    fontFamily: fonts.bold,
  },

  /** Glass card body — the main solfa display area. */
  solfaBody: {
    backgroundColor: c.accentSoft,
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
    color: c.textFaint,
    fontSize: 11,
    marginRight: spacing.sm,
    marginTop: 3,
    width: 14,
    textAlign: "right",
  },

  solfaLine: {
    ...typography.mono,
    color: c.textMuted,
    fontSize: 16,
    lineHeight: 26,
    flex: 1,
    letterSpacing: 1,
  },

  /** First line gets full Ink Navy — it's the primary solfa sequence.
   *
   *  Keeps `fontWeight` rather than a Poppins family: this overlays `solfaLine`,
   *  which is monospaced so the syllables stay in columns. A proportional face
   *  here would break that alignment, and monospace has no Poppins equivalent —
   *  so the weight is still the only way to bold it, and still honoured. */
  solfaLineFirst: {
    color: c.text,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 2,
    lineHeight: 30,
    // Subtle blue text-shadow glow
    textShadowColor: "rgba(37, 99, 235, 0.6)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },

  solfaMuted: {
    ...typography.body,
    color: c.textFaint,
    fontStyle: "italic",
  },

  /** Decorative ghost note — bottom-right watermark inside the card.
   *
   *  Left on the system font: the glyph is ♪, which Poppins doesn't carry, so
   *  naming a family would only force a silent fallback. No family means the
   *  weight below is honoured. */
  solfaWatermark: {
    position: "absolute",
    right: spacing.xl,
    bottom: -8,
    fontSize: 80,
    color: c.accentSoft,
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
    color: c.text,
    fontSize: 16,
    fontFamily: fonts.bold,
  },

  /** The "(12)" nested inside sectionTitle. It inherits the parent's family, so
   *  lightening it takes an explicit regular face — a weight alone was dropped. */
  sectionCount: {
    color: c.textFaint,
    fontFamily: fonts.regular,
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
    backgroundColor: c.surface,
    alignItems: "center",
    paddingTop: spacing.sm,
    paddingBottom: 0,
    overflow: "hidden",
  },

  noteSolfa: {
    ...typography.label,
    color: c.text,
    fontSize: 15,
    fontFamily: fonts.bold,
  },

  noteMidi: {
    ...typography.caption,
    color: c.textFaint,
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

  // ── Export block ───────────────────────────────────────────────────────────

  exportBlock: {
    marginBottom: spacing.xl,
    gap: spacing.xs,
  },

  exportHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },

  exportTitle: {
    ...typography.heading,
    color: c.text,
    fontSize: 16,
    fontFamily: fonts.bold,
  },

  exportHint: {
    ...typography.body,
    color: c.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },

  // ── Save block ─────────────────────────────────────────────────────────────

  saveBlock: {
    marginTop: spacing.xs,
    paddingBottom: spacing.xxl,
  },

  divider: {
    height: 1,
    backgroundColor: c.border,
    marginBottom: spacing.xl,
  },

  saveLabel: {
    ...typography.heading,
    color: c.text,
    fontSize: 18,
    fontFamily: fonts.bold,
    marginBottom: spacing.xs,
  },

  saveHint: {
    ...typography.body,
    color: c.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },

  // ── Saved state ────────────────────────────────────────────────────────────

  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xl,
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentGlow,
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
    // Light-blue glow
    shadowColor: c.gold,
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
    color: c.text,
    fontSize: 15,
    fontFamily: fonts.bold,
  },

  savedSub: {
    ...typography.caption,
    color: c.textMuted,
    marginTop: 2,
    fontSize: 12,
  },
});
