import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Icon } from "../../components/Icon";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../../components/Screen";
import { Touchable } from "../../components/Touchable";
import { adminApi } from "../../api/endpoints";
import {
  fonts,
  motion,
  radii,
  spacing,
  typography,
  type Palette,
} from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import {
  AdminHeader,
  Chip,
  ListState,
  SearchField,
  StatusPill,
  ago,
  useDebounced,
  usePagedList,
} from "./parts";
import type { AdminUserRow } from "../../api/types";
import type { RootStackParams } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "AdminUsers">;

/**
 * Active state is the only filter here.
 *
 * Pro and gifted are on every row, but the server pages before anything sees
 * them, so a chip for either could only filter the page already loaded — which
 * would show "3 of 214" and mean neither number. Search is the tool for finding a
 * specific account; this is just the two states an operator puts an account into.
 */
const FILTERS: { label: string; isActive?: boolean }[] = [
  { label: "All" },
  { label: "Active", isActive: true },
  { label: "Suspended", isActive: false },
];

const PAGE_SIZE = 25;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Find an account. Split from `AdminUser` because that screen needs a `userId`,
 * and the support case this exists for starts from an email in an inbox.
 */
export function AdminUsersScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [query, setQuery] = useState("");
  const search = useDebounced(query);
  const [filter, setFilter] = useState(0);

  const active = FILTERS[filter];
  const list = usePagedList<AdminUserRow>(
    (page) =>
      adminApi.users({
        page,
        pageSize: PAGE_SIZE,
        search: search.trim() || undefined,
        isActive: active.isActive,
      }),
    [search, filter],
  );

  return (
    <Screen>
      <AdminHeader
        label="Operations"
        title="Accounts"
        onBack={() =>
          navigation.canGoBack()
            ? navigation.goBack()
            : navigation.navigate("AdminHome")
        }
      />

      <FlatList
        data={list.items}
        keyExtractor={(u) => u.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={list.loadMore}
        refreshControl={
          <RefreshControl
            refreshing={list.refreshing}
            onRefresh={list.refresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Name or email"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {FILTERS.map((f, i) => (
                <Chip
                  key={f.label}
                  label={f.label}
                  active={filter === i}
                  onPress={() => setFilter(i)}
                />
              ))}
            </ScrollView>
            {list.items.length > 0 ? (
              <Text style={styles.count}>
                {list.items.length} of {list.total}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <Touchable
            onPress={() => navigation.navigate("AdminUser", { userId: item.id })}
            style={styles.row}
            scaleTo={motion.scale.row}
            accessibilityLabel={`${item.fullName}, ${item.email}`}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(item.fullName.trim()[0] ?? item.email[0] ?? "?").toUpperCase()}
              </Text>
            </View>

            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.fullName}
              </Text>
              <Text style={styles.rowEmail} numberOfLines={1}>
                {item.email}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {item.transcriptionCount} transcription
                {item.transcriptionCount === 1 ? "" : "s"} ·{" "}
                {item.lastLoginAt ? `seen ${ago(item.lastLoginAt)} ago` : "never signed in"}
                {/* Which sign-in methods exist decides whether a password reset
                    is even the right suggestion. */}
                {item.hasGoogle ? " · Google" : ""}
              </Text>
            </View>

            <View style={styles.rowRight}>
              {item.role === "Admin" ? (
                <StatusPill label="Admin" tone="info" />
              ) : null}
              {item.isGiftedPro ? (
                <StatusPill label="Gift" tone="warn" />
              ) : item.hasProAccess ? (
                <StatusPill label="Pro" tone="good" />
              ) : null}
              {!item.isActive ? (
                <StatusPill label="Suspended" tone="bad" />
              ) : null}
              <Icon
                name="chevron"
                size={16}
                color={colors.textFaint}
              />
            </View>
          </Touchable>
        )}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        ListEmptyComponent={
          <ListState
            loading={list.loading}
            error={list.error}
            emptyIcon="users"
            emptyTitle="No accounts"
            emptyHint="Nothing matches that search."
          />
        }
        ListFooterComponent={
          list.loadingMore ? (
            <ActivityIndicator style={styles.footer} color={colors.accent} />
          ) : null
        }
      />
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    listContent: {
      paddingBottom: spacing.xxxl,
    },
    header: {
      gap: spacing.md,
      marginBottom: spacing.sm,
    },
    chipRow: {
      gap: spacing.xs,
      paddingRight: spacing.lg,
    },
    count: {
      ...typography.caption,
      color: c.textFaint,
      fontSize: 11,
    },

    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      backgroundColor: c.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontSize: 16,
      fontFamily: fonts.bold,
      color: c.accent,
    },
    rowMain: {
      flex: 1,
    },
    rowTitle: {
      fontSize: 14.5,
      fontFamily: fonts.semibold,
      color: c.text,
    },
    rowEmail: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: c.textMuted,
      marginTop: 1,
    },
    rowMeta: {
      fontSize: 11,
      fontFamily: fonts.regular,
      color: c.textFaint,
      marginTop: 2,
    },
    rowRight: {
      alignItems: "flex-end",
      gap: spacing.xs,
    },
    divider: {
      height: 1,
      backgroundColor: c.border,
    },
    footer: {
      paddingVertical: spacing.lg,
    },
  });
