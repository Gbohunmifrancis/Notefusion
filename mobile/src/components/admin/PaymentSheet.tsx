import React, { useState } from "react";
import { Linking, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Sheet } from "../Sheet";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Touchable } from "../Touchable";
import { Badge, DefRows, Initials, LoadState } from "./AdminUI";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles } from "../../lib/theme";
import { adminApi } from "../../api/endpoints";
import type { AdminPaymentDetail, AdminUserDetail } from "../../api/types";
import { useAdminQuery } from "../../lib/adminCache";
import {
  PAYMENT_TONE,
  clock,
  countryName,
  dayLabel,
  firstName,
  initials,
  money,
  moneyLine,
  parseUtc,
  paymentTimeline,
  totals,
  type PaymentStatus,
  type TimelineStep,
} from "../../lib/adminFormat";

/**
 * One payment, as a sheet over the list (board f-admin/04): where a payment push lands. The amount and plan first,
 * then what happened as the console's timeline (checkout, the provider's word, the ledger, what it applied), the
 * references, and the provider's raw replies one tap down (the evidence in a dispute). Swipe down to close.
 */
export function PaymentSheet({
  paymentId,
  onClose,
  onOpenAccount,
  onReconcile,
}: {
  paymentId: string | null;
  onClose: () => void;
  onOpenAccount: (userId: string) => void;
  onReconcile?: (detail: AdminPaymentDetail) => void;
}) {
  return (
    <Sheet visible={paymentId !== null} onClose={onClose} style={{ maxHeight: "92%" }}>
      {paymentId ? (
        <Body id={paymentId} onClose={onClose} onOpenAccount={onOpenAccount} onReconcile={onReconcile} />
      ) : null}
    </Sheet>
  );
}

function Body({
  id,
  onClose,
  onOpenAccount,
  onReconcile,
}: {
  id: string;
  onClose: () => void;
  onOpenAccount: (userId: string) => void;
  onReconcile?: (detail: AdminPaymentDetail) => void;
}) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const [raw, setRaw] = useState(false);
  const detail = useAdminQuery<AdminPaymentDetail>(`payment:${id}`, () => adminApi.payment(id));
  const userId = detail.data?.payment.userId;
  const user = useAdminQuery<AdminUserDetail>(`user:${userId ?? ""}`, () => adminApi.user(userId!), Boolean(userId));

  const d = detail.data;
  if (!d) return <LoadState loading={detail.loading} error={detail.error} onRetry={detail.refresh} />;

  const p = d.payment;
  const now = new Date();
  const u = user.data;
  // The plan's kind, from its name: the row carries no interval (the server's one-song plan is named "One song").
  const isSingle = (p.planName ?? "").toLowerCase() === "one song";
  const isChoir = /choir/i.test(p.planName ?? "");
  const steps = paymentTimeline(
    {
      payment: { ...p, status: p.status as PaymentStatus },
      webhooks: d.webhookEvents,
      ledger: d.ledger,
      proUntilUtc: !isSingle && !isChoir ? u?.subscription?.currentPeriodEndUtc ?? null : null,
      isSingle,
      isChoir,
    },
    now,
  );
  const theirs = (u?.payments ?? []).filter((x) => x.status === "Completed");
  const when = parseUtc(p.status === "Completed" ? p.updatedAtUtc : p.createdAtUtc);
  const providerRef = p.providerReference;
  const name = p.userFullName || p.userEmail;

  return (
    <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
      <View style={s.who}>
        <Initials text={initials(name)} size={44} />
        <View style={s.flex}>
          <Text style={s.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={s.email} numberOfLines={1}>
            {[p.userEmail, countryName(u?.country)].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <Badge label={p.status} tone={PAYMENT_TONE[p.status as PaymentStatus] ?? "neutral"} />
      </View>

      <Text style={s.amount}>{money(p.amountMinor, p.currency)}</Text>
      <Text style={s.plan}>
        {`${p.planName ?? "Payment"} · ${p.status === "Completed" ? "paid" : "opened"} ${dayLabel(when, now).toLowerCase()} at ${clock(when)}`}
      </Text>

      <Text style={s.label}>What happened</Text>
      <Timeline steps={steps} />

      <DefRows
        rows={[
          { term: "Reference", value: <Copyable text={p.reference} />, mono: true },
          ...(providerRef ? [{ term: `${p.provider} reference`, value: <Copyable text={providerRef} /> }] : []),
          ...(u
            ? [
                {
                  term: `Payments from ${firstName(name)}`,
                  value: `${theirs.length} · ${moneyLine(totals(theirs.map((x) => ({ currency: x.currency, amountMinor: x.amountMinor }))))} in all`,
                },
              ]
            : []),
        ]}
      />

      <Touchable onPress={() => setRaw((r) => !r)} accessibilityLabel={`${p.provider}'s own words`}>
        <View style={s.raw}>
          <Icon name="audit" size={18} color={a.icon} />
          <View style={s.flex}>
            <Text style={s.rawTitle}>{`${p.provider}'s own words`}</Text>
            <Text style={s.rawSub}>The raw replies, for a dispute</Text>
          </View>
          <Icon name={raw ? "down" : "chevron"} size={16} color={a.dim} />
        </View>
      </Touchable>
      {raw ? (
        <View style={s.rawBody}>
          {[
            ["Checkout", d.initiateRaw],
            ["Verification", d.verifyRaw],
            ["Closed because", p.failureReason],
          ]
            .filter((x): x is [string, string] => Boolean(x[1]))
            .map(([title, text]) => (
              <View key={title} style={s.rawBlock}>
                <Text style={s.rawBlockTitle}>{title}</Text>
                <Text style={s.mono} selectable>
                  {pretty(text)}
                </Text>
              </View>
            ))}
          {!d.initiateRaw && !d.verifyRaw && !p.failureReason ? <Text style={s.rawSub}>Nothing was recorded.</Text> : null}
        </View>
      ) : null}

      {onReconcile && (p.status === "Processing" || p.status === "Failed") ? (
        <Button
          label={`Ask ${p.provider} now`}
          icon="sync"
          variant="secondary"
          block
          onPress={() => onReconcile(d)}
          style={s.reconcile}
        />
      ) : null}

      <View style={s.actions}>
        <Button
          label={`Email ${firstName(name)}`}
          icon="mail"
          variant="secondary"
          onPress={() => void Linking.openURL(`mailto:${p.userEmail}`).catch(() => undefined)}
        />
        <Button
          label="Open account"
          onPress={() => {
            onClose();
            onOpenAccount(p.userId);
          }}
        />
      </View>
    </ScrollView>
  );
}

function Timeline({ steps }: { steps: readonly TimelineStep[] }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const color = (t: TimelineStep["tone"]) => (t === "start" ? a.brand : t === "ok" ? a.ok : t === "warn" ? a.warn : a.dim);
  return (
    <View style={s.timeline}>
      {steps.map((step, i) => (
        <View key={i} style={s.step}>
          <View style={s.rail}>
            <View style={[s.node, { backgroundColor: color(step.tone) }]} />
            {i < steps.length - 1 ? <View style={[s.line, { backgroundColor: a.line }]} /> : null}
          </View>
          <View style={[s.flex, s.stepBody]}>
            <Text style={s.stepTitle}>{step.title}</Text>
            {step.detail ? <Text style={s.stepDetail}>{step.detail}</Text> : null}
          </View>
          <Text style={s.stepAt}>{clock(step.at)}</Text>
        </View>
      ))}
    </View>
  );
}

/** A reference with the copy glyph: the phone's share sheet, which has Copy. */
function Copyable({ text }: { text: string }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  return (
    <Touchable onPress={() => void Share.share({ message: text }).catch(() => undefined)} accessibilityLabel={`Copy ${text}`} ripple={false}>
      <View style={s.copy}>
        <Text style={s.mono} numberOfLines={1}>
          {text}
        </Text>
        <Icon name="copy" size={14} color={a.faint} />
      </View>
    </Touchable>
  );
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    who: { flexDirection: "row", alignItems: "center", gap: 12 },
    name: { fontFamily: fonts.semibold, fontSize: 17, color: a.text },
    email: { fontFamily: fonts.regular, fontSize: 13.5, color: a.muted, marginTop: 2 },
    amount: { fontFamily: fonts.semibold, fontSize: 36, letterSpacing: -0.8, color: a.text, marginTop: 18, fontVariant: ["tabular-nums"] },
    plan: { fontFamily: fonts.regular, fontSize: 14, color: a.muted, marginTop: 4 },
    label: { fontFamily: fonts.medium, fontSize: 13.5, color: a.muted, marginTop: 18, marginBottom: 8 },
    timeline: { marginBottom: 8 },
    step: { flexDirection: "row", gap: 12 },
    rail: { width: 14, alignItems: "center" },
    node: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
    line: { width: 2, flex: 1, marginVertical: 2 },
    stepBody: { paddingBottom: 12 },
    stepTitle: { fontFamily: fonts.medium, fontSize: 14.5, color: a.text },
    stepDetail: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted, marginTop: 2 },
    stepAt: { fontFamily: fonts.regular, fontSize: 13, color: a.muted, fontVariant: ["tabular-nums"] },
    copy: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 220 },
    mono: { fontFamily: "JetBrainsMono_500Medium", fontSize: 12, color: a.text },
    raw: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginTop: 12,
      padding: 12,
      borderRadius: 10,
      backgroundColor: a.sub,
    },
    rawTitle: { fontFamily: fonts.medium, fontSize: 14.5, color: a.text },
    rawSub: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted, marginTop: 1 },
    rawBody: { marginTop: 8, gap: 10 },
    rawBlock: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: a.line, backgroundColor: a.bg },
    rawBlockTitle: { fontFamily: fonts.medium, fontSize: 12.5, color: a.muted, marginBottom: 6 },
    reconcile: { marginTop: 14 },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 18, flexWrap: "wrap" },
  });
