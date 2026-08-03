import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { ConfidenceBadge } from '../components/ConfidenceBadge';
import { libraryApi } from '../api/endpoints';
import { toApiError } from '../api/client';
import { colors, confidenceColor, radii, spacing, typography } from '../design/theme';
import type { RootStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParams, 'Result'>;

/**
 * The transcription result: solfa lines, a per-note grid colored by confidence,
 * and a save flow. The PRD's honesty rule drives the UI — the overall-confidence
 * banner is always visible, and low-confidence notes are visually flagged.
 */
export function ResultScreen({ route, navigation }: Props) {
  const { result, sourceJobId, savedId: initialSavedId, title: initialTitle } = route.params;
  const [title, setTitle] = useState(initialTitle ?? `${result.key} · ${new Date().toLocaleDateString()}`);
  const [savedId, setSavedId] = useState<string | undefined>(initialSavedId);
  const [saving, setSaving] = useState(false);

  const lowCount = useMemo(() => result.notes.filter((n) => n.conf < 0.5).length, [result.notes]);

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
      Alert.alert('Saved', 'Added to your library.');
    } catch (e) {
      Alert.alert('Could not save', toApiError(e).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Result</Text>
        <View style={styles.back} />
      </View>

      {/* Key / tempo summary */}
      <Card style={styles.summary}>
        <View style={styles.summaryRow}>
          <Summary icon="key" label="Key" value={result.key} />
          <Summary icon="speedometer" label="Tempo" value={`${result.tempo} BPM`} />
          <Summary icon="grid" label="Meter" value={result.timeSignature} />
        </View>
        <View style={styles.confRow}>
          <ConfidenceBadge value={result.overallConfidence} />
        </View>
        {lowCount > 0 && (
          <View style={styles.warnRow}>
            <Ionicons name="alert-circle-outline" size={15} color={colors.warning} />
            <Text style={styles.warnText}>
              {lowCount} note{lowCount > 1 ? 's' : ''} below 50% — worth a quick review.
            </Text>
          </View>
        )}
      </Card>

      {/* Solfa */}
      <Text style={styles.sectionTitle}>Tonic Solfa</Text>
      <Card style={styles.solfaCard}>
        {result.solfaLines.length === 0 ? (
          <Text style={styles.muted}>No solfa lines produced.</Text>
        ) : (
          result.solfaLines.map((line, i) => (
            <Text key={i} style={[styles.solfaLine, i === 0 && styles.solfaHeader]}>
              {line}
            </Text>
          ))
        )}
      </Card>

      {/* Notes grid */}
      <Text style={styles.sectionTitle}>Notes ({result.notes.length})</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.notesScroll}>
        <View style={styles.notesRow}>
          {result.notes.map((n, i) => (
            <View key={i} style={[styles.noteChip, { borderColor: confidenceColor(n.conf) }]}>
              <Text style={styles.noteSolfa}>
                {n.solfa}
                {n.octaveMark}
              </Text>
              <Text style={styles.noteMidi}>{n.pitchMidi}</Text>
              <View style={[styles.confBar, { backgroundColor: confidenceColor(n.conf) }]} />
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Save */}
      {!savedId ? (
        <View style={styles.saveBlock}>
          <TextField label="Title" value={title} onChangeText={setTitle} placeholder="Name this transcription" />
          <Button label="Save to library" icon="bookmark" onPress={save} loading={saving} />
        </View>
      ) : (
        <View style={styles.savedRow}>
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          <Text style={styles.savedText}>Saved to your library</Text>
        </View>
      )}
    </Screen>
  );
}

function Summary({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.summaryItem}>
      <Ionicons name={icon} size={18} color={colors.accent} />
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.title, color: colors.text },
  summary: { marginTop: spacing.lg },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryItem: { alignItems: 'center', flex: 1 },
  summaryValue: { ...typography.heading, color: colors.text, marginTop: spacing.sm },
  summaryLabel: { ...typography.caption, color: colors.textFaint, marginTop: 2 },
  confRow: { marginTop: spacing.lg, alignItems: 'center' },
  warnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  warnText: { ...typography.caption, color: colors.warning, marginLeft: spacing.xs },
  sectionTitle: { ...typography.heading, color: colors.text, marginTop: spacing.xxl, marginBottom: spacing.md },
  solfaCard: { backgroundColor: colors.bgElevated },
  solfaLine: { ...typography.mono, color: colors.text, marginVertical: 3 },
  solfaHeader: { color: colors.accentAlt, fontWeight: '700' },
  muted: { ...typography.body, color: colors.textFaint },
  notesScroll: { marginHorizontal: -spacing.xl, paddingHorizontal: spacing.xl },
  notesRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  noteChip: {
    width: 58,
    borderWidth: 1.5,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    paddingTop: spacing.sm,
    overflow: 'hidden',
  },
  noteSolfa: { ...typography.label, color: colors.text, fontSize: 16 },
  noteMidi: { ...typography.caption, color: colors.textFaint, marginVertical: spacing.xs },
  confBar: { height: 4, width: '100%' },
  saveBlock: { marginTop: spacing.xxl },
  savedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.xxl },
  savedText: { ...typography.label, color: colors.success, marginLeft: spacing.sm },
});
