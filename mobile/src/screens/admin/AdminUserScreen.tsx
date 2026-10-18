import React, { useState } from "react";
import { Linking, Share, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AdminBackBar, AdminPage, BarButton } from "../../components/admin/AdminChrome";
import {
  ActionGroup,
  ActionRow,
  Badge,
  GroupLabel,
  Initials,
  List,
  ListRow,
  LoadState,
  Meter,
  Panel,
  WarnNote,
} from "../../components/admin/AdminUI";
import { ConfirmSheet, type ConfirmRequest } from "../../components/admin/ConfirmSheet";
import { PaymentSheet } from "../../components/admin/PaymentSheet";
import { Icon } from "../../components/Icon";
import { adminApi } from "../../api/endpoints";
import type { AdminUserDetail, BillingInterval } from "../../api/types";
import { useAdminQuery } from "../../lib/adminCache";
import { openConsole } from "../../lib/adminConsole";
import { useAuth } from "../../lib/auth";
import { showDialog } from "../../lib/dialog";
import { showToast } from "../../lib/toast";
import { freeResetLabel } from "../../lib/freeWeek";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles } from "../../lib/theme";
import {
  PAYMENT_TONE,
  agoSentence,
  clock,
  countryName,
  dayLabel,
  dayMonth,
  firstName,
  initials,
  money,
  nextFreeReset,
  parseUtc,
  proUntil,
  shortPlan,
  stuckFor,
  type PaymentStatus,
} from "../../lib/adminFormat";
import type { AdminStackParams } from "../../navigation/types";

const GIFTS: { duration: BillingInterval; label: string }[] = [
  { duration: "monthly", label: "A month" },
  { duration: "yearly", label: "A year" },
  { duration: "lifetime", label: "Lifetime" },
];

/** An access token outlives a suspension or a demotion by up to this (Auth:AccessTokenMinutes). */
const TOKEN_WINDOW = "60 minutes";

/**
 * One account, a support conversation on one screen (board f-admin/05): who, the badges, the free week as a meter
 * (and when it comes back), the shared-inbox warning that explains "my free ones are gone", the payments one tap
 * from their sheet and Reconcile, then the actions as rows with Suspend the one red word. Destructive ones (Suspend,
 * End subscription, Revoke Pro, Change role) ask in a sheet and then the phone's lock; the rest ask once.
 */
export function AdminUserScreen() {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const nav = useNavigation<NativeStackNavigationProp<AdminStackParams>>();
  const { userId } = useRoute<RouteProp<AdminStackParams, "AdminUser">>().params;
  const { user: me } = useAuth();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [payment, setPayment] = useState<string | null>(null);
  const q = useAdminQuery<AdminUserDetail>(`user:${userId}`, () => adminApi.user(userId));
  const u = q.data;
  const now = new Date();

  const back = () => (nav.canGoBack() ? nav.goBack() : nav.navigate("AdminTabs", { screen: "Users" }));

  if (!u)
    return (
      <AdminPage header={<AdminBackBar label="Users" onBack={back} />}>
        <LoadState loading={q.loading} error={q.error} onRetry={q.refresh} />
      </AdminPage>
    );

  const name = u.fullName || u.email;
  const who = firstName(name);
  const isSelf = me?.id === u.id;
  const isAdmin = u.role === "Admin";
  const sub = u.subscription;
  const active = Boolean(sub?.isActive);
  const done = (message: string) => async () => {
    showToast(message);
    await q.refresh();
  };

  const act = (r: Omit<ConfirmRequest, "onConfirm">, run: (note?: string) => Promise<unknown>, toast: string) =>
    setConfirm({
      ...r,
      onConfirm: async (note) => {
        await run(note);
        await done(toast)();
      },
    });

  // Change role sits in ⋯ with the other rare things (board f-admin/05); it asks in a sheet, then the phone's lock.
  const changeRole = () =>
    act(
      isAdmin
        ? {
            title: `Remove ${who}'s admin access?`,
            message: `${u.email} loses access to the console and to every admin endpoint. A signed-in session keeps admin powers for up to ${TOKEN_WINDOW}.`,
            confirmLabel: "Remove admin",
            destructive: true,
            note: {},
            secondAsk: true,
          }
        : {
            title: `Make ${who} an admin?`,
            message: `${u.email} gains full access to the console: every account's personal data, and every action here. They must sign out and back in before the new role is in their token.`,
            confirmLabel: "Grant admin",
            note: {},
            secondAsk: true,
          },
      (note) => adminApi.setRole(u.id, isAdmin ? "user" : "admin", note),
      isAdmin ? "Admin access removed" : "Admin access granted",
    );

  const moreMenu = () =>
    showDialog({
      title: name,
      actions: [
        { label: "Copy email", icon: "copy", onPress: () => void Share.share({ message: u.email }).catch(() => undefined) },
        { label: "Copy account id", icon: "copy", onPress: () => void Share.share({ message: u.id }).catch(() => undefined) },
        { label: "Journey on the web console", icon: "external", onPress: () => openConsole(`/activity/journey?user=${u.id}`) },
        ...(!isSelf ? [{ label: isAdmin ? "Remove admin access" : "Make admin", icon: "role" as const, onPress: changeRole }] : []),
        ...(!isAdmin
          ? [
              {
                label: u.isInternal ? "Count in analytics" : "Mark as team or test account",
                icon: (u.isInternal ? "eye" : "eye-off") as "eye" | "eye-off",
                onPress: () =>
                  act(
                    {
                      title: u.isInternal ? "Count this account in analytics?" : "Leave this account out of analytics?",
                      message: u.isInternal
                        ? `${u.email} will be counted as a customer again: in the overview, Insights, the Users list, the live notices and every chart.`
                        : `${u.email} is the team's own or a test account. It disappears from the overview, Insights, the Users list (unless you show the team), the live notices and every chart. The account itself is not touched.`,
                      confirmLabel: u.isInternal ? "Count it" : "Leave it out",
                      note: {},
                    },
                    (note) => adminApi.setInternal(u.id, !u.isInternal, note),
                    u.isInternal ? "Counted in analytics again" : "Left out of analytics",
                  ),
              },
            ]
          : []),
        { label: "Cancel", style: "cancel" as const },
      ],
    });

  const gift = () =>
    showDialog({
      title: `Gift Pro to ${who}`,
      message: "No payment is taken, so this never counts as revenue.",
      actions: [
        ...GIFTS.map((g) => ({
          label: g.label,
          icon: "gift" as const,
          onPress: () =>
            act(
              {
                title: "Gift Pro access?",
                message: `Grants ${g.label.toLowerCase()} of Pro to ${u.email} at no charge. No payment is recorded, so this never counts as revenue. It is written to the audit trail against your account.`,
                confirmLabel: "Grant Pro",
                note: {},
              },
              (note) => adminApi.giftPro(u.id, g.duration, note),
              "Pro access granted",
            ),
        })),
        { label: "Cancel", style: "cancel" as const },
      ],
    });

  const used = u.trialGenerationsUsed;
  const total = Math.max(1, u.trialGenerationsTotal);
  const boughtLeft = Math.max(0, u.boughtTranscriptionsTotal - u.boughtTranscriptionsUsed);
  const songsWaiting = u.payments.filter((p) => p.status === "Processing" && /one song/i.test(p.planName ?? "")).length;
  const seen = u.lastSeenAtUtc ? parseUtc(u.lastSeenAtUtc) : null;

  return (
    <AdminPage
      header={
        <AdminBackBar
          label="Users"
          onBack={back}
          right={
            <>
              <BarButton icon="mail" label={`Email ${who}`} onPress={() => void Linking.openURL(`mailto:${u.email}`).catch(() => undefined)} />
              <BarButton icon="more" label="More" onPress={moreMenu} />
            </>
          }
        />
      }
      onRefresh={q.refresh}
      refreshing={q.refreshing}
    >
      <View style={s.who}>
        <Initials text={initials(name)} size={58} />
        <View style={s.flex}>
          <Text style={s.name} numberOfLines={2}>
            {name}
          </Text>
          <Text style={s.email} numberOfLines={1}>
            {[u.email, countryName(u.country)].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>

      <View style={s.badges}>
        <Badge label={active ? (sub?.isGift ? "Pro · gift" : "Pro") : "Free"} tone={active ? "prem" : "neutral"} />
        <Badge label={u.isActive ? "Active" : "Suspended"} tone={u.isActive ? "ok" : "bad"} />
        {isAdmin ? <Badge label="Admin" tone="blue" /> : null}
        {u.isInternal && !isAdmin ? <Badge label="Team" /> : null}
        <Badge label={u.hasGoogle ? "Google" : "Password"} />
        <Badge label={`Joined ${dayMonth(parseUtc(u.createdAt), now)}`} />
        {seen ? <Badge label={`Seen ${agoSentence(seen, now)}`} /> : null}
      </View>

      <Panel style={s.gap14}>
        {active ? (
          <View style={s.line}>
            <Text style={s.lineTerm}>{shortPlan(sub?.planName) === "Payment" ? "Pro" : shortPlan(sub?.planName)}</Text>
            <Text style={s.lineValue}>
              {sub?.isLifetime || !sub?.currentPeriodEndUtc
                ? "For life"
                : `until ${proUntil(parseUtc(sub.currentPeriodEndUtc), now)}${sub.isGift ? " · gift" : sub.provider ? ` · ${sub.provider}` : ""}`}
            </Text>
          </View>
        ) : (
          <>
            <View style={s.line}>
              <Text style={s.lineTerm}>Free this week</Text>
              <Text style={s.lineValue}>{`${used} of ${total} used · back ${freeResetLabel(nextFreeReset(now).toISOString())}`}</Text>
            </View>
            <View style={s.meter}>
              <Meter pct={(used / total) * 100} color={used >= total ? a.warn : a.brand} />
            </View>
          </>
        )}
        <View style={s.line}>
          <Text style={s.lineTerm}>Bought songs</Text>
          <Text style={s.lineValue}>{`${boughtLeft}${songsWaiting ? ` · ${songsWaiting} waiting on a payment` : ""}`}</Text>
        </View>
        <View style={s.line}>
          <Text style={s.lineTerm}>Transcriptions</Text>
          <Text style={s.lineValue}>
            {`${u.transcriptionCount} · ${u.savedTranscriptionCount} saved · ${u.failedTranscriptionCount} failed · ${u.chargedTranscriptionCount} charged`}
          </Text>
        </View>
        {u.sharedMailboxAccounts > 0 ? (
          <WarnNote style={s.gap10}>
            {`Inbox shared with ${u.sharedMailboxAccounts} other account${u.sharedMailboxAccounts === 1 ? "" : "s"}: they share the free three.`}
          </WarnNote>
        ) : null}
      </Panel>

      {u.payments.length ? (
        <>
          <GroupLabel>Payments</GroupLabel>
          <List>
            {u.payments.slice(0, 5).map((p) => {
              const at = parseUtc(p.createdAtUtc);
              // The account's payment rows carry when the checkout opened, not when it last moved: "waiting", not "stuck".
              const stuck = p.status === "Processing" ? ` · waiting ${stuckFor(at, now)}` : "";
              return (
                <ListRow
                  key={p.id}
                  leading={
                    <View style={s.payIcon}>
                      <Icon name="card" size={17} color={a.icon} />
                    </View>
                  }
                  title={`${shortPlan(p.planName)} · ${money(p.amountMinor, p.currency)}`}
                  line={`${p.provider} · ${dayLabel(at, now).toLowerCase()} ${clock(at)}${stuck}`}
                  end={<Badge label={p.status} tone={PAYMENT_TONE[p.status as PaymentStatus] ?? "neutral"} />}
                  onPress={() => setPayment(p.id)}
                />
              );
            })}
          </List>
        </>
      ) : null}

      <GroupLabel>Account actions</GroupLabel>
      <ActionGroup>
        {!active ? <ActionRow icon="gift" label="Gift Pro" hint="A month, a year or lifetime; no payment taken" onPress={gift} /> : null}
        {active && sub?.isGift ? (
          <ActionRow
            icon="pro"
            label="Revoke Pro"
            hint="Ends the gift now; nothing was charged"
            onPress={() =>
              act(
                {
                  title: `Revoke ${who}'s gift?`,
                  message: `Ends the granted Pro access for ${u.email} immediately. Their saved transcriptions are untouched; only the Pro entitlement stops. Nothing was charged, so nothing is refunded.`,
                  confirmLabel: "Revoke",
                  destructive: true,
                  note: {},
                  secondAsk: true,
                },
                (note) => adminApi.revokePro(u.id, note),
                "Gifted Pro revoked",
              )
            }
          />
        ) : null}
        {active ? (
          <ActionRow
            icon="end-period"
            label="End subscription"
            hint="Cuts Pro now; no refund"
            onPress={() =>
              act(
                {
                  title: `End ${who}'s subscription now?`,
                  message: `Cuts Pro access for ${u.email} immediately, whether it was paid for or gifted. No refund is issued: if they paid for the remaining period, refund it in the provider's dashboard separately.`,
                  confirmLabel: "End access",
                  destructive: true,
                  note: {},
                  secondAsk: true,
                },
                (note) => adminApi.endSubscription(u.id, note),
                "Subscription ended",
              )
            }
          />
        ) : null}
        {used > 0 ? (
          <ActionRow
            icon="retry"
            label="Reset this week's free three"
            onPress={() =>
              act(
                {
                  title: "Reset this week's free three?",
                  message: `Gives ${u.email} this week's free transcriptions back.`,
                  confirmLabel: "Reset",
                  note: {},
                },
                (note) => adminApi.resetTrialQuota(u.id, note),
                "Free three reset",
              )
            }
          />
        ) : null}
        <ActionRow
          icon="password"
          label="Send password reset"
          onPress={() =>
            act(
              {
                title: "Send a password-reset link?",
                message: `Emails a reset link to ${u.email}.${u.hasPassword ? "" : " This account signs in with Google and has no password: the link lets them set one."}`,
                confirmLabel: "Send link",
                note: {},
              },
              (note) => adminApi.sendPasswordReset(u.id, note),
              "Reset link sent",
            )
          }
        />
        {!isSelf && u.isActive ? (
          <ActionRow
            icon="user-x"
            label="Suspend account"
            destructive
            chevron={false}
            onPress={() =>
              act(
                {
                  title: `Suspend ${name}?`,
                  message: `${u.email} can't sign in, and every refresh token is revoked. A token already issued keeps working for up to ${TOKEN_WINDOW}. Nothing is deleted; reactivating lets them sign in again.`,
                  confirmLabel: "Suspend",
                  destructive: true,
                  note: { placeholder: "Five cards declined in an hour; Paystack flagged it" },
                  secondAsk: true,
                },
                (note) => adminApi.suspend(u.id, note),
                "Account suspended",
              )
            }
          />
        ) : null}
        {!isSelf && !u.isActive ? (
          <ActionRow
            icon="user-check"
            label="Reactivate account"
            onPress={() =>
              act(
                {
                  title: `Reactivate ${name}?`,
                  message: `${u.email} will be able to sign in again, fresh: the refresh tokens revoked on suspension are not restored.`,
                  confirmLabel: "Reactivate",
                  note: {},
                },
                (note) => adminApi.reactivate(u.id, note),
                "Account reactivated",
              )
            }
          />
        ) : null}
      </ActionGroup>

      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />
      <PaymentSheet
        paymentId={payment}
        onClose={() => setPayment(null)}
        onOpenAccount={(id) => (id === u.id ? undefined : nav.push("AdminUser", { userId: id }))}
      />
    </AdminPage>
  );
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    gap10: { marginTop: 10 },
    gap14: { marginTop: 14 },
    who: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 4 },
    name: { fontFamily: fonts.semibold, fontSize: 22, letterSpacing: -0.4, color: a.text },
    email: { fontFamily: fonts.regular, fontSize: 14, color: a.muted, marginTop: 3 },
    badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 14 },
    line: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6 },
    lineTerm: { fontFamily: fonts.medium, fontSize: 14.5, color: a.text },
    lineValue: { flexShrink: 1, textAlign: "right", fontFamily: fonts.regular, fontSize: 13.5, color: a.muted, fontVariant: ["tabular-nums"] },
    meter: { marginTop: 4, marginBottom: 8 },
    payIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: a.sub, alignItems: "center", justifyContent: "center" },
  });
