import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../../components/Screen";
import { Button } from "../../components/Button";
import { Touchable } from "../../components/Touchable";
import { adminApi } from "../../api/endpoints";
import { toApiError } from "../../api/client";
import { showDialog } from "../../lib/dialog";
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
  money,
  paymentTone,
  useDebounced,
  usePagedList,
  webhookTone,
} from "./parts";
import type {
  AdminPaymentDetail,
  AdminPaymentRow,
  AdminPaymentStatus,
} from "../../api/types";
import type { RootStackParams } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "AdminPayments">;

/**
 * The filter row. `status` is sent PascalCase because the wire values are enum
 * member *names*, not serialized enums — ASP.NET happens to bind them
 * case-insensitively, but matching what comes back keeps one spelling in play.
 */
const FILTERS: {
  label: string;
  status?: AdminPaymentStatus;
  stuckOnly?: boolean;
}[] = [
  { label: "All" },
  { label: "Stuck", stuckOnly: true },
  { label: "Paid, no Pro", status: "Verified" },
  { label: "Processing", status: "Processing" },
  { label: "Completed", status: "Completed" },
  { label: "Failed", status: "Failed" },
  { label: "Pending", status: "Pending" },
];

const PAGE_SIZE = 25;

/** Provider payloads run to kilobytes; past this nobody is reading on a phone. */
const RAW_LIMIT = 2_000;

function clip(raw: string): string {
  return raw.length > RAW_LIMIT
    ? `${raw.slice(0, RAW_LIMIT)}\n\n… ${raw.length - RAW_LIMIT} more characters`
    : raw;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Every payment attempt across every account, and the one repair an operator can
 * make from a phone.
 *
 * This is the "the customer says they paid" screen. Search takes a reference, a
 * provider's reference, or an email; Reconcile asks the provider what actually
 * happened and applies the answer, which is the same command the background sweep
 * runs — so nothing reachable here can reach an outcome the sweep could not.
 */
export function AdminPaymentsScreen({ navigation, route }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  // Seeded when the webhook inbox pushed us here with a reference to look up.
  const [query, setQuery] = useState(route.params?.search ?? "");
  const search = useDebounced(query);
  const [filter, setFilter] = useState(0);

  const active = FILTERS[filter];
  const list = usePagedList<AdminPaymentRow>(
    (page) =>
      adminApi.payments({
        page,
        pageSize: PAGE_SIZE,
        status: active.status,
        stuckOnly: active.stuckOnly,
        search: search.trim() || undefined,
      }),
    [search, filter],
  );

  // The open row. Kept alongside the fetched detail so the sheet can title itself
  // and show the amount while the detail request is still in flight.
  const [open, setOpen] = useState<AdminPaymentRow | null>(null);
  const [detail, setDetail] = useState<AdminPaymentDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const fetchDetail = useCallback((id: string) => {
    setDetail(null);
    setDetailError(null);
    adminApi
      .payment(id)
      .then(setDetail)
      .catch((e) => setDetailError(toApiError(e).message));
  }, []);

  function openRow(row: AdminPaymentRow) {
    setOpen(row);
    setShowRaw(false);
    fetchDetail(row.id);
  }

  function closeSheet() {
    setOpen(null);
    setDetail(null);
    setDetailError(null);
  }

  function confirmReconcile(row: AdminPaymentRow) {
    showDialog({
      title: "Reconcile this payment?",
      message: `Ask ${row.provider} what happened to ${row.reference} and apply the answer. Safe to repeat — a settled payment is left alone.`,
      icon: "sync-outline",
      tone: "brand",
      actions: [
        {
          label: "Reconcile",
          icon: "sync",
          onPress: () => void reconcile(row),
        },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  async function reconcile(row: AdminPaymentRow) {
    setReconciling(true);
    try {
      const res = await adminApi.reconcile(row.id, "via mobile admin");
      // `outcome` is written server-side on purpose: what a status pair means is a
      // billing rule, not a phrase a dashboard should invent.
      showDialog({
        title: res.changed ? `${res.previousStatus} → ${res.status}` : "No change",
        message: res.outcome,
        icon: res.changed ? "checkmark-circle-outline" : "information-circle-outline",
        tone: res.changed ? "brand" : undefined,
      });
      if (res.changed) list.refresh();
      fetchDetail(row.id);
    } catch (e) {
      const err = toApiError(e);
      // The code matters here — BILLING_VERIFICATION_MISMATCH is a different
      // conversation from a provider being unreachable, and a generic "failed"
      // hides which one happened.
      showDialog({
        title: "Could not reconcile",
        message: `${err.message}\n\n${err.code}`,
        icon: "alert-circle-outline",
        tone: "danger",
      });
    } finally {
      setReconciling(false);
    }
  }

  return (
    <Screen>
      <AdminHeader
        label="Operations"
        title="Payments"
        onBack={() => navigation.goBack()}
      />

      <FlatList
        data={list.items}
        keyExtractor={(t) => t.id}
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
              placeholder="Reference, provider ref, or email"
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
            onPress={() => openRow(item)}
            style={styles.row}
            scaleTo={motion.scale.row}
            accessibilityLabel={`${item.userEmail}, ${item.status}, ${money(item.amountMinor, item.currency)}`}
          >
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.userEmail}
              </Text>
              <Text style={styles.rowRef} numberOfLines={1}>
                {item.reference}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {item.provider}
                {item.planName ? ` · ${item.planName}` : ""} ·{" "}
                {dateTime(item.createdAtUtc)}
              </Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.rowAmount}>
                {money(item.amountMinor, item.currency)}
              </Text>
              <View style={styles.rowPills}>
                {item.isStuck ? <StatusPill label="Stuck" tone="warn" /> : null}
                <StatusPill label={item.status} tone={paymentTone(item.status)} />
              </View>
            </View>
          </Touchable>
        )}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        ListEmptyComponent={
          <ListState
            loading={list.loading}
            error={list.error}
            emptyIcon="card-outline"
            emptyTitle="No payments"
            emptyHint="Nothing matches this filter."
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
        title={open ? money(open.amountMinor, open.currency) : ""}
        onClose={closeSheet}
      >
        {open ? (
          <>
            <View style={styles.sheetPills}>
              <StatusPill label={open.status} tone={paymentTone(open.status)} />
              {open.isStuck ? (
                <StatusPill
                  label={`Stuck ${ago(open.updatedAtUtc)}`}
                  tone="warn"
                />
              ) : null}
            </View>

            <Field label="Account" value={open.userFullName} />
            <Field label="Email" value={open.userEmail} mono />
            <Field label="Plan" value={open.planName} />
            <Field label="Provider" value={open.provider} />
            <Field label="Reference" value={open.reference} mono />
            <Field
              label="Provider ref"
              value={open.providerReference}
              mono
            />
            <Field label="Created" value={dateTime(open.createdAtUtc)} />
            <Field label="Updated" value={dateTime(open.updatedAtUtc)} />
            {open.failureReason ? (
              <Field label="Failure" value={open.failureReason} tone="bad" />
            ) : null}

            <View style={styles.actions}>
              <Button
                label="Reconcile"
                icon="sync"
                loading={reconciling}
                onPress={() => confirmReconcile(open)}
                style={styles.action}
              />
              <Button
                label="Open account"
                variant="secondary"
                icon="person-outline"
                onPress={() => {
                  const userId = open.userId;
                  closeSheet();
                  navigation.navigate("AdminUser", { userId });
                }}
                style={styles.action}
              />
            </View>

            {open.status === "Verified" ? (
              <Text style={styles.escalate}>
                Reconciliation does not retry this state. The money is confirmed
                and the subscription was never applied — gift Pro from the account
                to unblock the customer, and escalate the payment.
              </Text>
            ) : null}

            {detailError ? (
              <Text style={styles.detailError}>{detailError}</Text>
            ) : detail === null ? (
              <ActivityIndicator style={styles.footer} color={colors.accent} />
            ) : (
              <>
                <Field
                  label="Idempotency"
                  value={detail.idempotencyKey}
                  mono
                />
                <Field label="Checkout URL" value={detail.checkoutUrl} mono />

                <SectionTitle>Ledger</SectionTitle>
                {detail.ledger.length === 0 ? (
                  <Text style={styles.none}>
                    No entries. A completed payment always has one, so its absence
                    on a paid charge is the problem itself.
                  </Text>
                ) : (
                  detail.ledger.map((entry) => (
                    <View key={entry.id} style={styles.subRow}>
                      <View style={styles.subMain}>
                        <Text style={styles.subTitle}>
                          {entry.direction} · {entry.reason}
                        </Text>
                        <Text style={styles.subMeta} numberOfLines={2}>
                          {entry.description}
                        </Text>
                        <Text style={styles.subMeta}>
                          {dateTime(entry.createdAtUtc)}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.subAmount,
                          {
                            color:
                              entry.direction === "Credit"
                                ? colors.success
                                : colors.danger,
                          },
                        ]}
                      >
                        {money(entry.amountMinor, entry.currency)}
                      </Text>
                    </View>
                  ))
                )}

                <SectionTitle>Webhook events</SectionTitle>
                {detail.webhookEvents.length === 0 ? (
                  <Text style={styles.none}>
                    The provider never called back about this reference.
                  </Text>
                ) : (
                  detail.webhookEvents.map((event) => (
                    <View key={event.id} style={styles.subRow}>
                      <View style={styles.subMain}>
                        <Text style={styles.subTitle}>{event.eventType}</Text>
                        <Text style={styles.subMeta}>
                          {event.processAttempts} attempt
                          {event.processAttempts === 1 ? "" : "s"} ·{" "}
                          {dateTime(event.receivedAtUtc)}
                        </Text>
                        {event.lastError ? (
                          <Text style={styles.subError} numberOfLines={3}>
                            {event.lastError}
                          </Text>
                        ) : null}
                      </View>
                      <StatusPill
                        label={event.status}
                        tone={webhookTone(event.status)}
                      />
                    </View>
                  ))
                )}

                {detail.initiateRaw || detail.verifyRaw ? (
                  <>
                    <SectionTitle>Provider payloads</SectionTitle>
                    <Touchable
                      onPress={() => setShowRaw((v) => !v)}
                      style={styles.rawToggle}
                      accessibilityLabel="Toggle provider payloads"
                    >
                      <Ionicons
                        name={showRaw ? "chevron-up" : "chevron-down"}
                        size={16}
                        color={colors.textMuted}
                      />
                      <Text style={styles.rawToggleText}>
                        {showRaw ? "Hide" : "Show"} what the provider sent
                      </Text>
                    </Touchable>
                    {showRaw ? (
                      <>
                        {detail.initiateRaw ? (
                          <>
                            <Text style={styles.rawLabel}>Initiate</Text>
                            <RawBlock text={clip(detail.initiateRaw)} />
                          </>
                        ) : null}
                        {detail.verifyRaw ? (
                          <>
                            <Text style={styles.rawLabel}>Verify</Text>
                            <RawBlock text={clip(detail.verifyRaw)} />
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </>
                ) : null}
              </>
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
    count: {
      ...typography.caption,
      color: c.textFaint,
      fontSize: 11,
    },

    // ── Rows ────────────────────────────────────────────────────────────────
    row: {
      flexDirection: "row",
      alignItems: "center",
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
    rowRight: {
      alignItems: "flex-end",
      gap: spacing.xs,
    },
    rowAmount: {
      fontSize: 14,
      fontFamily: fonts.bold,
      color: c.text,
    },
    rowPills: {
      flexDirection: "row",
      gap: spacing.xs,
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
    actions: {
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    action: {
      flex: 1,
    },
    escalate: {
      ...typography.caption,
      color: c.danger,
      fontSize: 11.5,
      lineHeight: 17,
      marginTop: spacing.md,
    },
    detailError: {
      ...typography.body,
      color: c.danger,
      fontSize: 12.5,
      marginTop: spacing.lg,
    },
    none: {
      ...typography.caption,
      color: c.textMuted,
      fontSize: 11.5,
      lineHeight: 17,
    },

    subRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.md,
      paddingVertical: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    subMain: {
      flex: 1,
    },
    subTitle: {
      fontSize: 13,
      fontFamily: fonts.semibold,
      color: c.text,
    },
    subMeta: {
      fontSize: 11.5,
      fontFamily: fonts.regular,
      color: c.textMuted,
      marginTop: 1,
    },
    subError: {
      ...typography.mono,
      fontSize: 10.5,
      lineHeight: 15,
      color: c.danger,
      marginTop: 2,
    },
    subAmount: {
      fontSize: 13,
      fontFamily: fonts.bold,
    },

    rawToggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingVertical: spacing.xs,
    },
    rawToggleText: {
      fontSize: 12.5,
      fontFamily: fonts.medium,
      color: c.textMuted,
    },
    rawLabel: {
      ...typography.caption,
      color: c.textFaint,
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginTop: spacing.sm,
    },
  });
