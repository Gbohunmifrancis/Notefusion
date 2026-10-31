/**
 * "Which hymn is it?": the hymns we hold sung to the tune a sheet matched (a page's words are not read, and a tune like
 * OLD HUNDREDTH carries a hundred and more), typed to find; the one picked brings its words and its credit. Mirrors the
 * web's picker in app.js `hymnPicker`.
 */

import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "../Icon";
import { Sheet } from "../Sheet";
import { findSettings } from "../../lib/hymnbook";
import { fonts, radii, spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import type { HymnMatch, HymnSetting } from "../../api/types";

export function HymnSettingSheet({
  match,
  visible,
  onClose,
  onPick,
}: {
  match: HymnMatch;
  visible: boolean;
  onClose: () => void;
  onPick: (setting: HymnSetting) => void;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [query, setQuery] = useState("");
  const shown = findSettings(match, query);
  const total = match.settingsTotal ?? match.settings?.length ?? 0;
  const listed = match.settings?.length ?? 0;

  return (
    <Sheet visible={visible} onClose={onClose} avoidKeyboard style={styles.sheet}>
      <Text style={styles.title} accessibilityRole="header">Which hymn is it?</Text>
      <Text style={styles.hint}>
        {total > 1 ? `${total} hymns we hold are sung to ${match.title}. Its words come with the one you pick.` : "Its words come with the hymn you pick."}
      </Text>
      <View style={styles.search}>
        <Icon name="search" size={18} color={c.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Type the hymn's title"
          placeholderTextColor={c.textMuted}
          style={styles.input}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search the hymns sung to this tune"
        />
      </View>
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {shown.map((s) => (
          <Pressable
            key={s.slug}
            onPress={() => onPick(s)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Use the words of ${s.title}`}
          >
            <Text style={styles.rowTitle} numberOfLines={2}>{s.title}</Text>
          </Pressable>
        ))}
        {shown.length === 0 ? <Text style={styles.empty}>No hymn sung to this tune has that title.</Text> : null}
        {total > listed ? (
          <Text style={styles.empty}>{total - listed} more are on the tune's page on notefusion.studio.</Text>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    sheet: { maxHeight: "85%" },
    title: { ...typography.heading, color: p.text, marginBottom: spacing.xs },
    hint: { ...typography.body, color: p.textMuted, marginBottom: spacing.md },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: 48,
      paddingHorizontal: spacing.md,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      marginBottom: spacing.sm,
    },
    input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: p.text, paddingVertical: spacing.sm },
    list: { flexGrow: 0 },
    row: { minHeight: 48, justifyContent: "center", paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.border },
    rowPressed: { opacity: 0.6 },
    rowTitle: { ...typography.body, color: p.text },
    empty: { ...typography.caption, color: p.textMuted, paddingVertical: spacing.md },
  });
