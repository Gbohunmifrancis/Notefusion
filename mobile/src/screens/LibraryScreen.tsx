import React, { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { ConfidenceBadge } from '../components/ConfidenceBadge';
import { libraryApi } from '../api/endpoints';
import { toApiError } from '../api/client';
import { colors, radii, spacing, typography } from '../design/theme';
import type { SavedTranscription } from '../api/types';
import type { RootStackParams } from '../navigation/types';

/**
 * The saved library (F-08). Pull-to-refresh, tap to open the full result,
 * long-press to delete. Opening an item fetches its notes (the list endpoint
 * omits them) before navigating to Result.
 */
export function LibraryScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const [items, setItems] = useState<SavedTranscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await libraryApi.list());
    } catch {
      /* toApiError surfaces on explicit actions; a silent list failure just shows empty */
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

  async function open(item: SavedTranscription) {
    try {
      const full = await libraryApi.get(item.id);
      nav.navigate('Result', {
        result: {
          key: full.key,
          keyConfidence: 1,
          tempo: full.tempoBpm,
          timeSignature: full.timeSignature,
          musicXml: '',
          midiBase64: '',
          notes: full.notes ?? [],
          solfaLines: [],
          overallConfidence: full.overallConfidence,
        },
        savedId: full.id,
        title: full.title,
      });
    } catch (e) {
      Alert.alert('Could not open', toApiError(e).message);
    }
  }

  function confirmDelete(item: SavedTranscription) {
    Alert.alert('Delete transcription', `Remove “${item.title}”? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setItems((prev) => prev.filter((t) => t.id !== item.id)); // optimistic
          try {
            await libraryApi.remove(item.id);
          } catch (e) {
            Alert.alert('Could not delete', toApiError(e).message);
            load();
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <Text style={styles.title}>Library</Text>
      <FlatList
        data={items}
        keyExtractor={(t) => t.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={items.length === 0 && styles.emptyContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={0.85} onPress={() => open(item)} onLongPress={() => confirmDelete(item)}>
            <Card style={styles.card} padded={false}>
              <View style={styles.row}>
                <View style={styles.iconWrap}>
                  <Ionicons name="musical-notes" size={20} color={colors.accent} />
                </View>
                <View style={styles.info}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.meta}>
                    {item.key} · {item.tempoBpm} BPM · {new Date(item.createdAtUtc).toLocaleDateString()}
                  </Text>
                </View>
                <ConfidenceBadge value={item.overallConfidence} compact />
              </View>
            </Card>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="folder-open-outline" size={44} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>Nothing saved yet</Text>
              <Text style={styles.emptyBody}>Record a melody and save it to see it here.</Text>
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginTop: spacing.sm, marginBottom: spacing.lg },
  card: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: radii.sm,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, marginHorizontal: spacing.md },
  name: { ...typography.label, color: colors.text, fontSize: 15 },
  meta: { ...typography.caption, color: colors.textFaint, marginTop: 3 },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.heading, color: colors.textMuted, marginTop: spacing.lg },
  emptyBody: { ...typography.body, color: colors.textFaint, marginTop: spacing.sm, textAlign: 'center' },
});
