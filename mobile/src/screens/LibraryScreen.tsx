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
 * Saved Library screen: Minimalist list layout with pull-to-refresh and tap-to-open.
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
      /* silent load handling */
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
    Alert.alert('Delete transcription', `Remove "${item.title}"? This action cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setItems((prev) => prev.filter((t) => t.id !== item.id));
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
        contentContainerStyle={items.length === 0 ? styles.emptyContainer : styles.listContent}
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
                  <Ionicons name="musical-note" size={20} color={colors.ink} />
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
              <Ionicons name="folder-open-outline" size={40} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>Nothing saved yet</Text>
              <Text style={styles.emptyBody}>Transcribe audio to start building your library.</Text>
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginTop: spacing.xs, marginBottom: spacing.md },
  listContent: { paddingBottom: 120 },
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, marginHorizontal: spacing.md },
  name: { ...typography.label, color: colors.text, fontSize: 15 },
  meta: { ...typography.caption, color: colors.textFaint, marginTop: 2 },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.heading, color: colors.textMuted, marginTop: spacing.md, fontSize: 16 },
  emptyBody: { ...typography.body, color: colors.textFaint, marginTop: spacing.xs, textAlign: 'center', fontSize: 13 },
});
