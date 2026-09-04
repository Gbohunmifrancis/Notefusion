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
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../../components/Screen";
import { Button } from "../../components/Button";
import { Touchable } from "../../components/Touchable";
import { adminApi } from "../../api/endpoints";
import { toApiError } from "../../api/client";
import {
  fonts,
  motion,
  spacing,
  typography,
  type Palette,
} from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import {
  AdminHeader,
  Chip,
  Field,
  ListState,
  RawBlock,
  SearchField,
  SectionTitle,
  Sheet,
  StatusPill,
  ago,
  dateTime,
  useDebounced,
  usePagedList,
  webhookTone,
} from "./parts";
import type {
  AdminWebhookEventDetail,
  AdminWebhookEventRow,
  AdminWebhookStatus,
} from "../../api/types";
import type { RootStackParams } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "AdminWebhooks">;

const FILTERS: { label: string; status?: AdminWebhookStatus }[] = [
  { label: "All" },
  { label: "Awaiting", status: "Received" },
  { label: "Failed", status: "Failed" },
  { label: "Processed", status: "Processed" },
];

const PAGE_SIZE = 25;

/** Raw provider bodies run long; past this nobody is reading on a phone. */
const RAW_LIMIT = 4_000;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * The provider callback inbox — read-only, on purpose.
 *
 * This screen answers "why did the provider's callback not land", and stops
 * there. There is no Retry: replaying a stored callback is not how a payment is
 * repaired here, because `ReconcilePaymentCommand` re-asks the provider for the
 * current truth, while a replay would re-apply whatever the body happened to say
 * when it arrived. So a row that matters hands off to its payment, and the fix
 * happens there.
 */
export function AdminWebhooksScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [query, setQuery] = useState("");
  const search = useDebounced(query);
  const [filter, setFilter] = useState(0);

  const active = FILTERS[filter];
  const list = usePagedList<AdminWebhookEventRow>(
    (page) =>
      adminApi.webhooks({
        page,
        pageSize: PAGE_SIZE,
        status: active.status,
        search: search.trim() || undefined,
      }),
    [search, filter],
  );

  const [open, setOpen] = useState<AdminWebhookEventRow | null>(null);
  const [detail, setDetail] = useState<AdminWebhookEventDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  function openRow(row: AdminWebhookEventRow) {
    setOpen(row);
    setDetail(null);
    setDetailError(null);
    adminApi
      .webhook(row.id)
      .then(setDetail)
      .catch((e) => setDetailError(toApiError(e).message));
  }

  function closeSheet() {
    setOpen(null);
    setDetail(null);
    setDetailError(null);
  }

  return (
    <Screen>
      <AdminHeader
        label="Operations"
        title="Webhook inbox"
        onBack={() =>
          navigation.canGoBack()
            ? navigation.goBack()
            : navigation.navigate("AdminHome")
        }
      />

      <FlatList
        data={list.items}
        keyExtractor={(e) => e.id}
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
              placeholder="Event id, type, or payment reference"
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
            <Text style={styles.note}>
              Read-only. To repair a payment a callback failed to settle, open the
              payment and reconcile it — that re-asks the provider rather than
              replaying an old body.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Touchable
            onPress={() => openRow(item)}
            style={styles.row}
            scaleTo={motion.scale.row}
            accessibilityLabel={`${item.eventType}, ${item.status}`}
          >
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.eventType}
              </Text>
              <Text style={styles.rowRef} numberOfLines={1}>
                {item.paymentReference ?? item.providerEventId}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {item.provider} · {item.processAttempts} attempt
                {item.processAttempts === 1 ? "" : "s"} ·{" "}
                {dateTime(item.receivedAtUtc)}
              </Text>
              {item.lastError ? (
                <Text style={styles.rowError} numberOfLines={2}>
                  {item.lastError}
                </Text>
              ) : null}
            </View>
            <View style={styles.rowRight}>
              <StatusPill label={item.status} tone={webhookTone(item.status)} />
              {item.status === "Received" ? (
                <Text style={styles.rowWaiting}>
                  {ago(item.receivedAtUtc)}
                </Text>
              ) : null}
            </View>
          </Touchable>
        )}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        ListEmptyComponent={
          <ListState
            loading={list.loading}
            error={list.error}
            emptyIcon="git-pull-request-outline"
            emptyTitle="Nothing here"
            emptyHint="No callbacks match this filter."
          />
        }
        ListFooterComponent={
          list.loadingMore ? (
            <ActivityIndicator style={styles.footer} color={colors.accent} />
          ) : null
        }
      />

      {/* ── Detail ─────────────────────────────────────────────────────────── */}
      <Sheet
        visible={open !== null}
        title={open?.eventType ?? ""}
        onClose={closeSheet}
      >
        {open ? (
          <>
            <View style={styles.sheetPills}>
              <StatusPill label={open.status} tone={webhookTone(open.status)} />
              <StatusPill label={open.provider} tone="info" />
            </View>

            <Field label="Provider event" value={open.providerEventId} mono />
            <Field label="Payment ref" value={open.paymentReference} mono />
            <Field label="Attempts" value={String(open.processAttempts)} />
            <Field label="Received" value={dateTime(open.receivedAtUtc)} />
            <Field
              label="Last attempt"
              value={
                open.lastAttemptAtUtc ? dateTime(open.lastAttemptAtUtc) : null
              }
            />
            <Field
              label="Processed"
              value={open.processedAtUtc ? dateTime(open.processedAtUtc) : null}
            />

            {open.lastError ? (
              <>
                <SectionTitle>Last error</SectionTitle>
                <RawBlock text={open.lastError} />
              </>
            ) : null}

            {open.paymentReference ? (
              <Button
                label="Find the payment"
                variant="secondary"
                icon="card-outline"
                onPress={() => {
                  const search = open.paymentReference;
                  if (!search) return;
                  closeSheet();
                  // Push, not navigate: back should return to this inbox, and a
                  // pushed screen always starts with the seeded search applied.
                  navigation.push("AdminPayments", { search });
                }}
                style={styles.action}
              />
            ) : null}

            <SectionTitle>What the provider sent</SectionTitle>
            {detailError ? (
              <Text style={styles.detailError}>{detailError}</Text>
            ) : detail === null ? (
              <ActivityIndicator style={styles.footer} color={colors.accent} />
            ) : (
              <RawBlock
                text={
                  detail.payload.length > RAW_LIMIT
                    ? `${detail.payload.slice(0, RAW_LIMIT)}\n\n… ${
                        detail.payload.length - RAW_LIMIT
                      } more characters`
                    : detail.payload
                }
              />
            )}
          </>
        ) : null}
      </Sheet>
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
    note: {
      ...typography.caption,
      color: c.textFaint,
      fontSize: 11,
      lineHeight: 16,
    },

    // ── Rows ────────────────────────────────────────────────────────────────
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    rowMain: {
      flex: 1,
    },
    rowTitle: {
      fontSize: 14.5,
      fontFamily: fonts.semibold,
      color: c.text,
    },
    rowRef: {
      ...typography.mono,
      fontSize: 11,
      color: c.textMuted,
      marginTop: 2,
    },
    rowMeta: {
      fontSize: 11.5,
      fontFamily: fonts.regular,
      color: c.textFaint,
      marginTop: 2,
    },
    rowError: {
      ...typography.mono,
      fontSize: 10.5,
      lineHeight: 15,
      color: c.danger,
      marginTop: spacing.xs,
    },
    rowRight: {
      alignItems: "flex-end",
      gap: spacing.xs,
    },
    rowWaiting: {
      fontSize: 11,
      fontFamily: fonts.medium,
      color: c.warning,
    },
    divider: {
      height: 1,
      backgroundColor: c.border,
    },
    footer: {
      paddingVertical: spacing.lg,
    },

    // ── Sheet ───────────────────────────────────────────────────────────────
    sheetPills: {
      flexDirection: "row",
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    action: {
      marginTop: spacing.lg,
    },
    detailError: {
      ...typography.body,
      color: c.danger,
      fontSize: 12.5,
    },
  });
