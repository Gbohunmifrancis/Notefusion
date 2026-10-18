import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AdminPage, AdminTopBar, PageTitle } from "../../components/admin/AdminChrome";
import {
  Badge,
  FilterChips,
  GroupLabel,
  IconBox,
  Initials,
  List,
  ListRow,
  LoadState,
  Segmented,
  StatTile,
} from "../../components/admin/AdminUI";
import { PaymentSheet } from "../../components/admin/PaymentSheet";
import { ConfirmSheet, type ConfirmRequest } from "../../components/admin/ConfirmSheet";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { adminApi } from "../../api/endpoints";
import type {
  AdminLedgerRow,
  AdminPaymentRow,
  AdminWebhookEventRow,
  PagedResult,
  PaymentOpsSummary,
} from "../../api/types";
import { useAdminQuery } from "../../lib/adminCache";
import { showToast } from "../../lib/toast";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles } from "../../lib/theme";
import {
  PAYMENT_TONE,
  agoSentence,
  byCurrency,
  clock,
  count,
  dayLabel,
  firstName,
  groupByDay,
  initials,
  money,
  moneyLine,
  parseUtc,
  paymentLine,
  shortPlan,
  stuckFor,
  type PaymentStatus,
} from "../../lib/adminFormat";
import type { AdminStackParams, AdminTabParams } from "../../navigation/types";

type View3 = "payments" | "webhooks" | "ledger";
type Filter = "all" | "attention" | "Completed" | "Failed" | "Pending";

const PAGE = 25;

const WEBHOOK_META: Record<string, { label: string; tone: "warn" | "ok" | "bad" }> = {
  Received: { label: "Awaiting", tone: "warn" },
  Processed: { label: "Processed", tone: "ok" },
  Failed: { label: "Parked", tone: "bad" },
};

/**
 * Payments, Webhooks and Ledger as one section (board f-admin/04): three tiles for the state of the money (the two
 * amber ones are the only colour that asks for something), the web's filters, rows by day with its status pills, a
 * payment's sheet, and "Needs a look" with Reconcile, which asks first.
 */
export function AdminPaymentsScreen() {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const route = useRoute<RouteProp<AdminTabParams, "Payments">>();
  const nav = useNavigation<NativeStackNavigationProp<AdminStackParams>>();
  const [view, setView] = useState<View3>("payments");
  const [filter, setFilter] = useState<Filter>("all");
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [pages, setPages] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  // A push, the Overview's amber line, or a webhook alert names what to open.
  useEffect(() => {
    const p = route.params;
    if (!p) return;
    if (p.view) setView(p.view);
    if (p.filter === "attention") {
      setView("payments");
      setFilter("attention");
    }
    if (p.paymentId) setOpen(p.paymentId);
  }, [route.params?.nonce, route.params?.paymentId, route.params?.filter, route.params?.view]);

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPages(1), [view, filter, term]);

  const summary = useAdminQuery<PaymentOpsSummary>("payments-summary", adminApi.paymentsSummary);
  const listKey = `${view}:${filter}:${term}:${pages}`;
  const list = useAdminQuery<PagedResult<AdminPaymentRow | AdminWebhookEventRow | AdminLedgerRow>>(`list:${listKey}`, () => {
    const pageSize = PAGE * pages;
    if (view === "webhooks") return adminApi.webhooks({ page: 1, pageSize, search: term || undefined });
    if (view === "ledger") return adminApi.ledger({ page: 1, pageSize, search: term || undefined });
    return adminApi.payments({
      page: 1,
      pageSize,
      search: term || undefined,
      needsLook: filter === "attention" || undefined,
      status: filter === "all" || filter === "attention" ? undefined : filter,
    });
  });

  const refresh = () => {
    void summary.refresh();
    void list.refresh();
  };

  const sm = summary.data;
  const today = byCurrency(sm?.paidToday ?? []);
  const needsLook = sm ? sm.verifiedCount + sm.stuckCount : 0;
  const now = new Date();

  function reconcile(row: { id: string; provider: string; userFullName: string; amountMinor: number; currency: string; planName: string | null; status: string; isStuck: boolean; updatedAtUtc: string }) {
    const who = firstName(row.userFullName);
    setConfirm({
      title: `Ask ${row.provider} about ${who}'s payment?`,
      message: `${money(row.amountMinor, row.currency)}, ${shortPlan(row.planName).toLowerCase()}, ${row.status}${
        row.status === "Processing" ? ` for ${stuckFor(parseUtc(row.updatedAtUtc), now)}` : ""
      }. Reconcile asks ${row.provider} what happened and applies the answer: the same step the sweep runs every 5 minutes, so it is safe to repeat.`,
      confirmLabel: "Reconcile",
      note: { placeholder: "Customer emailed: charged, no song" },
      onConfirm: async (note) => {
        const result = await adminApi.reconcile(row.id, note);
        // The server's own sentence, written for the operator.
        showToast(result.outcome, { icon: result.changed ? "done" : "about" });
        refresh();
      },
    });
  }

  const items = list.data?.items ?? [];
  const more = list.data ? list.data.totalCount > items.length : false;

  return (
    <AdminPage header={<AdminTopBar />} onRefresh={refresh} refreshing={list.refreshing}>
      <PageTitle
        title="Payments"
        sub={view === "payments" ? "Every checkout, newest first" : view === "webhooks" ? "Every provider callback, stored once" : "Money in and out, newest first"}
        right={<IconBox icon="search" label="Search payments" active={searching} onPress={() => setSearching((v) => !v)} />}
      />
      {searching ? (
        <View style={s.search}>
          <Icon name="search" size={17} color={a.faint} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            autoFocus
            placeholder="Reference, provider's or email"
            placeholderTextColor={a.dim}
            style={s.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search"
          />
        </View>
      ) : null}

      <View style={s.gap14}>
        <Segmented
          wide
          options={[
            { value: "payments", label: "Payments" },
            { value: "webhooks", label: "Webhooks" },
            { value: "ledger", label: "Ledger" },
          ]}
          value={view}
          onChange={setView}
        />
      </View>

      {view === "payments" ? (
        <>
          <View style={[s.minis, s.gap12]}>
            <StatTile
              style={s.mini}
              label="Today"
              value={today[0] ? money(today[0].amountMinor, today[0].currency) : money(0, "NGN")}
              sub={[moneyLine(today.slice(1)), `${sm?.paidTodayCount ?? 0} paid`].filter(Boolean).join(" · ")}
            />
            <StatTile style={s.mini} tone={sm?.verifiedCount ? "warn" : undefined} label="Paid, no Pro" value={count(sm?.verifiedCount ?? 0)} sub={sm?.verifiedCount ? "Escalate" : "None"} />
            <StatTile
              style={s.mini}
              tone={sm?.stuckCount ? "warn" : undefined}
              label="Stuck"
              value={count(sm?.stuckCount ?? 0)}
              sub={sm?.oldestStuckSinceUtc ? `Oldest ${stuckFor(parseUtc(sm.oldestStuckSinceUtc), now)}` : "None"}
            />
          </View>
          <View style={s.gap12}>
            <FilterChips
              options={[
                { value: "all", label: "All" },
                { value: "attention", label: "Needs a look", count: needsLook || undefined },
                { value: "Completed", label: "Completed" },
                { value: "Failed", label: "Failed" },
                { value: "Pending", label: "Pending" },
              ]}
              value={filter}
              onChange={setFilter}
            />
          </View>
          <PaymentList
            rows={items as AdminPaymentRow[]}
            attention={filter === "attention"}
            now={now}
            onOpen={(row) => (filter === "attention" && row.status === "Processing" ? reconcile(row) : setOpen(row.id))}
          />
          {filter === "attention" ? (
            <Text style={s.note}>
              Stuck: still Processing past the grace window. The sweep asks the provider every 5 minutes; Reconcile asks now.
              Paid, no Pro (Verified) is never touched by the sweep: escalate it.
            </Text>
          ) : null}
        </>
      ) : view === "webhooks" ? (
        <List style={s.gap14}>
          {(items as AdminWebhookEventRow[]).map((w) => {
            const meta = WEBHOOK_META[w.status] ?? { label: w.status, tone: "warn" as const };
            return (
              <ListRow
                key={w.id}
                leading={<Icon name="webhook" size={18} color={a.faint} />}
                title={w.eventType}
                line={`${w.provider} · ${w.paymentReference ?? "no reference"} · ${clock(parseUtc(w.receivedAtUtc))}`}
                end={
                  <>
                    <Badge label={meta.label} tone={meta.tone} />
                    <Text style={s.when}>{`${w.processAttempts} ${w.processAttempts === 1 ? "try" : "tries"}`}</Text>
                  </>
                }
                onPress={w.paymentTransactionId ? () => setOpen(w.paymentTransactionId) : undefined}
              />
            );
          })}
        </List>
      ) : (
        <List style={s.gap14}>
          {(items as AdminLedgerRow[]).map((e) => (
            <ListRow
              key={e.id}
              leading={<Icon name="money" size={18} color={a.faint} />}
              title={e.userEmail}
              line={`${e.reason === "SubscriptionCharge" ? "Charge" : e.reason === "TranscriptionPurchase" ? "One song" : e.reason} · ${shortPlan(e.description)} · ${dayLabel(parseUtc(e.createdAtUtc), now)}`}
              end={
                <Text style={[s.amount, e.direction === "Debit" && { color: a.badDeep }]}>
                  {`${e.direction === "Debit" ? "−" : ""}${money(e.amountMinor, e.currency)}`}
                </Text>
              }
              onPress={() => setOpen(e.paymentTransactionId)}
            />
          ))}
        </List>
      )}

      {items.length === 0 ? (
        <LoadState
          loading={list.loading}
          error={list.error}
          empty={term ? "Nothing matches that search." : filter === "attention" ? "Nothing needs a look." : "Nothing here yet."}
          onRetry={list.refresh}
        />
      ) : null}
      {more ? <Button label="Show more" variant="text" onPress={() => setPages((p) => p + 1)} style={s.more} /> : null}

      <PaymentSheet
        paymentId={open}
        onClose={() => setOpen(null)}
        onOpenAccount={(userId) => nav.navigate("AdminUser", { userId })}
        onReconcile={(d) => {
          setOpen(null);
          reconcile(d.payment);
        }}
      />
      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />
    </AdminPage>
  );
}

function PaymentList({
  rows,
  attention,
  now,
  onOpen,
}: {
  rows: readonly AdminPaymentRow[];
  attention: boolean;
  now: Date;
  onOpen: (row: AdminPaymentRow) => void;
}) {
  const s = useAdminStyles(makeStyles);
  const groups = useMemo(
    () => (attention ? [{ label: "Needs a look", items: [...rows], paid: [] }] : groupByDay(rows, now)),
    [rows, attention, now.toDateString()],
  );
  if (!rows.length) return null;
  return (
    <View>
      {groups.map((g) => (
        <View key={g.label}>
          <GroupLabel right={attention ? String(g.items.length) : moneyLine(g.paid) || undefined}>{g.label}</GroupLabel>
          <List>
            {g.items.map((p) => (
              <ListRow
                key={p.id}
                leading={<Initials text={initials(p.userFullName || p.userEmail)} />}
                title={p.userFullName || p.userEmail}
                line={attention && p.status === "Verified" ? `${shortPlan(p.planName)} · ${p.provider} · paid ${agoSentence(parseUtc(p.updatedAtUtc), now)}` : paymentLine({ ...p, status: p.status as PaymentStatus }, now)}
                end={
                  <>
                    <Text style={s.amount}>{money(p.amountMinor, p.currency)}</Text>
                    <Badge label={p.status} tone={PAYMENT_TONE[p.status as PaymentStatus] ?? "neutral"} />
                  </>
                }
                onPress={() => onOpen(p)}
              />
            ))}
          </List>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    gap12: { marginTop: 12 },
    gap14: { marginTop: 14 },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      height: 46,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: a.brand,
      backgroundColor: a.card,
      marginTop: 12,
    },
    searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: a.text, paddingVertical: 0 },
    minis: { flexDirection: "row", gap: 8 },
    mini: { flex: 1, minHeight: 96, padding: 10 },
    amount: { fontFamily: fonts.semibold, fontSize: 14.5, color: a.text, fontVariant: ["tabular-nums"] },
    when: { fontFamily: fonts.regular, fontSize: 12, color: a.muted },
    note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: a.muted, marginTop: 12 },
    more: { alignSelf: "center", marginTop: 8 },
  });
