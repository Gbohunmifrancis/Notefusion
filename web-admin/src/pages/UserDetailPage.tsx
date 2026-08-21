import {
  AlertTriangle,
  ArrowLeft,
  CalendarPlus,
  Gift,
  KeyRound,
  ShieldCheck,
  ShieldOff,
  Undo2,
  UserCheck,
  UserX,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import {
  endSubscription,
  extendSubscription,
  getUserAccount,
  giftPro,
  reactivateUser,
  revokePro,
  sendPasswordReset,
  setUserRole,
  suspendUser,
} from "@/api/endpoints";
import type {
  AdminUserDetail,
  GiftDuration,
  PaymentStatus,
  SubscriptionStatus,
} from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { Badge, type BadgeTone } from "@/components/Badge";
import { Card } from "@/components/Card";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/PageHeader";
import { ResultBanner } from "@/components/ResultBanner";
import { StateView } from "@/components/StateView";
import { auditMeta } from "@/lib/audit";
import {
  UNKNOWN,
  addDays,
  formatCount,
  formatInstantDate,
  formatInstantDateTime,
  formatMoney,
  reportingToday,
} from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { useAuth } from "@/lib/auth";
import { TD, TH, THEAD_TR, TR } from "@/lib/tableClasses";
import { useAsync } from "@/lib/useAsync";

/**
 * How long an access token that was already handed out stays valid. It mirrors
 * `AuthSettings.AccessTokenMinutes`, and it is written into the copy for suspension and for demoting
 * an admin because both actions are often read as instant and neither is.
 */
const ACCESS_TOKEN_WINDOW = "up to 60 minutes";

const SUBSCRIPTION_TONES: Record<SubscriptionStatus, BadgeTone> = {
  Active: "success",
  PastDue: "danger",
  Canceled: "warning",
  Expired: "neutral",
};

/** Attempts are kept, so this table has to be able to show a failure as clearly as a success. */
const PAYMENT_TONES: Record<PaymentStatus, BadgeTone> = {
  Pending: "neutral",
  Processing: "warning",
  Verified: "blue",
  Completed: "success",
  Failed: "danger",
};

/**
 * Turns a mutation into the `onConfirm` the dialog wants: perform it, say what happened, and reload
 * the account from the server. Reloading rather than patching state locally is deliberate — the
 * server decided what actually changed, and a gift also moves the subscription, the audit trail and
 * possibly the role in one go.
 */
type Perform = (
  message: string,
  work: (note: string | undefined) => Promise<void>,
) => (note: string | undefined) => Promise<void>;

type Ask = (request: ConfirmRequest) => void;

interface PanelProps {
  user: AdminUserDetail;
  offset: number;
  ask: Ask;
  perform: Perform;
}

const BUTTON_BASE =
  "inline-flex h-9 items-center gap-1.5 rounded-sm px-3.5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45";

const CONTROL =
  "h-9 rounded-sm border border-border bg-surface px-2.5 text-[13px] text-ink outline-none transition focus:border-blue";

/**
 * An operator action. `blockedBy` both disables the button and states the reason, because a greyed
 * control with no explanation is indistinguishable from a broken one — and the reasons here are
 * things the operator can act on ("extend instead of gifting again").
 */
function ActionButton({
  label,
  icon: Icon,
  tone = "default",
  blockedBy,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  tone?: "default" | "danger" | "quiet" | undefined;
  blockedBy?: string | undefined;
  onClick: () => void;
}) {
  const skin =
    tone === "danger"
      ? "border border-danger/40 text-danger-deep hover:bg-danger/10"
      : tone === "quiet"
        ? "border border-border text-ink hover:bg-surface-alt"
        : "bg-blue text-white hover:bg-blue-deep";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={Boolean(blockedBy)}
      {...(blockedBy ? { title: blockedBy } : {})}
      className={`${BUTTON_BASE} ${skin}`}
    >
      <Icon size={14} aria-hidden="true" />
      {label}
    </button>
  );
}

/** The reasons behind whatever is disabled, spelled out under the row rather than only in a tooltip. */
function BlockedNotes({ reasons }: { reasons: readonly string[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 text-xs text-faint">
      {reasons.map((reason) => (
        <li key={reason} className="flex gap-1.5">
          <span aria-hidden="true">·</span>
          <span>{reason}</span>
        </li>
      ))}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-1 break-words text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/**
 * The distinct reasons among a set of maybe-blocked actions. Deduplicated because three of the four
 * subscription actions are blocked by the same fact when there is no subscription, and repeating one
 * sentence three times reads as three separate problems.
 */
const distinct = (reasons: (string | undefined)[]) => [
  ...new Set(reasons.filter((reason): reason is string => Boolean(reason))),
];

/* ── Identity ─────────────────────────────────────────────────────────────── */

function IdentityCard({ user, offset }: { user: AdminUserDetail; offset: number }) {
  return (
    <Card title="Account">
      <div className="mb-5 flex items-center gap-3.5 border-b border-border-light pb-5">
        <Avatar name={user.fullName} size={48} />
        <div className="min-w-0">
          <p className="truncate text-heading font-semibold text-ink">{user.fullName}</p>
          <p className="truncate text-[13px] text-muted">{user.email}</p>
        </div>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Role">
          <Badge tone={user.role === "Admin" ? "blue" : "neutral"}>{user.role}</Badge>
        </Field>
        <Field label="Status">
          {user.isActive ? (
            <Badge tone="success">Active</Badge>
          ) : (
            <Badge tone="danger">Suspended</Badge>
          )}
        </Field>
        <Field label="Sign-in">
          <span className="flex flex-wrap gap-1">
            {user.hasGoogle && <Badge tone="blue">Google</Badge>}
            {user.hasPassword && <Badge>Password</Badge>}
            {!user.hasGoogle && !user.hasPassword && <Badge tone="danger">No method</Badge>}
          </span>
        </Field>
        <Field label="Phone">{user.phoneNumber ?? UNKNOWN}</Field>
        <Field label="Country">{user.country ?? UNKNOWN}</Field>
        <Field label="Joined">{formatInstantDate(user.createdAt, offset)}</Field>
        <Field label="Last sign-in">{formatInstantDateTime(user.lastLoginAt, offset)}</Field>
        <Field label="Lockout">
          {/* A failed-login lockout, not a suspension. They stop a sign-in the same way and are
              lifted differently, so the page never collapses them into one word. */}
          {user.lockoutEndAt ? (
            <span className="text-danger-deep">
              Locked until {formatInstantDateTime(user.lockoutEndAt, offset)}
            </span>
          ) : (
            "None"
          )}
        </Field>
        <Field label="Transcriptions">{formatCount(user.transcriptionCount)}</Field>
        <Field label="Free generations used">
          {formatCount(user.trialGenerationsUsed)} of {formatCount(user.trialGenerationsTotal)}
        </Field>
      </dl>
    </Card>
  );
}

/* ── Subscription ─────────────────────────────────────────────────────────── */

const NO_SUBSCRIPTION = "This account has no subscription yet — gifting one creates it.";
const ALREADY_ENDED = "This subscription has already ended.";

const DURATION_LABELS: Record<GiftDuration, string> = {
  monthly: "one month",
  yearly: "one year",
  lifetime: "lifetime",
};

function SubscriptionPanel({
  user,
  offset,
  ask,
  perform,
  isSelf,
}: PanelProps & { isSelf: boolean }) {
  const [duration, setDuration] = useState<GiftDuration>("monthly");
  const [newEnd, setNewEnd] = useState("");
  const sub = user.subscription;

  // An extension has to land after the period it is extending. When the period already lapsed,
  // "after today" is the real floor — moving the end to last week would extend nothing.
  const today = reportingToday(offset);
  const currentEnd = sub?.currentPeriodEndUtc?.slice(0, 10) ?? today;
  const minEnd = addDays(currentEnd > today ? currentEnd : today, 1);

  // Separation of duties, and it comes first in each reason below: an operator looking at their own
  // account should be told they are the wrong person to do this, not that the dates do not line up.
  const selfBlock = isSelf
    ? "You cannot change your own subscription. Ask another administrator, so the trail has two names in it."
    : undefined;

  const giftBlocked =
    selfBlock ??
    (sub?.isActive
      ? "Pro is already active. Extend the current period instead of granting a second one."
      : undefined);

  const revokeBlocked =
    selfBlock ??
    (!sub
      ? NO_SUBSCRIPTION
      : !sub.isActive
        ? ALREADY_ENDED
        : !sub.isGift
          ? "This subscription was paid for. Ending paid access is a separate, separately confirmed action."
          : undefined);

  const extendBlocked =
    selfBlock ??
    (!sub
      ? NO_SUBSCRIPTION
      : sub.isLifetime
        ? "Lifetime access has no end date to move."
        : !newEnd
          ? "Pick a new end date first."
          : undefined);

  const endBlocked =
    selfBlock ?? (!sub ? NO_SUBSCRIPTION : !sub.isActive ? ALREADY_ENDED : undefined);

  return (
    <Card
      title="Subscription"
      hint="A gift records a real plan with no payment provider, so it never appears as revenue."
    >
      {sub ? (
        <dl className="grid gap-4 border-b border-border-light pb-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Plan">
            {sub.planName ?? sub.planCode ?? UNKNOWN}
            {sub.planCode && (
              <span className="ml-1.5 font-mono text-[11px] text-faint">{sub.planCode}</span>
            )}
          </Field>
          <Field label="Status">
            <Badge tone={SUBSCRIPTION_TONES[sub.status]}>{sub.status}</Badge>
          </Field>
          <Field label="Access now">
            {sub.isActive ? <Badge tone="success">Pro unlocked</Badge> : <Badge>No access</Badge>}
          </Field>
          <Field label="Source">
            {sub.isGift ? (
              <Badge tone="premium" title="Granted by an operator — no payment was taken">
                Gift
              </Badge>
            ) : (
              `Paid via ${sub.provider ?? UNKNOWN}`
            )}
          </Field>
          <Field label="Period started">
            {formatInstantDate(sub.currentPeriodStartUtc, offset)}
          </Field>
          <Field label="Ends">
            {/* Lifetime is stored as a far-future sentinel the API nulls out. Printing "31 Dec 9999"
                would be technically true and useless. */}
            {sub.isLifetime ? "Never — lifetime" : formatInstantDateTime(sub.currentPeriodEndUtc, offset)}
          </Field>
          {sub.canceledAtUtc && (
            <Field label="Cancelled">{formatInstantDateTime(sub.canceledAtUtc, offset)}</Field>
          )}
        </dl>
      ) : (
        <p className="border-b border-border-light pb-5 text-[13px] text-muted">
          No subscription on this account. They are on the free tier, with{" "}
          {formatCount(user.trialGenerationsUsed)} of {formatCount(user.trialGenerationsTotal)} free
          generations used.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <select
          value={duration}
          onChange={(event) => setDuration(event.target.value as GiftDuration)}
          aria-label="Gift duration"
          className={CONTROL}
        >
          <option value="monthly">1 month</option>
          <option value="yearly">1 year</option>
          <option value="lifetime">Lifetime</option>
        </select>
        <ActionButton
          label="Gift Pro"
          icon={Gift}
          blockedBy={giftBlocked}
          onClick={() =>
            ask({
              title: "Gift Pro access",
              body: (
                <>
                  <p>
                    Grants <span className="font-semibold text-ink">{DURATION_LABELS[duration]}</span>{" "}
                    of Pro to <span className="font-semibold text-ink">{user.email}</span> at no
                    charge.
                  </p>
                  <p>
                    No payment is recorded, so this never counts as revenue. It is written to the
                    audit trail against your account.
                  </p>
                </>
              ),
              confirmLabel: "Grant Pro",
              noteLabel: "Why (optional)",
              onConfirm: perform("Pro access granted.", (note) =>
                giftPro(user.id, duration, note),
              ),
            })
          }
        />

        <ActionButton
          label="Revoke gift"
          icon={Undo2}
          tone="quiet"
          blockedBy={revokeBlocked}
          onClick={() =>
            ask({
              title: "Revoke the gift",
              body: (
                <>
                  <p>
                    Ends the granted Pro access for{" "}
                    <span className="font-semibold text-ink">{user.email}</span> immediately. Their
                    saved transcriptions are untouched; only the Pro entitlement stops.
                  </p>
                  <p>Nothing was charged, so nothing is refunded. You can gift again afterwards.</p>
                </>
              ),
              confirmLabel: "Revoke",
              tone: "danger",
              noteLabel: "Why (optional)",
              onConfirm: perform("Gifted Pro revoked.", (note) => revokePro(user.id, note)),
            })
          }
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={newEnd}
          min={minEnd}
          onChange={(event) => setNewEnd(event.target.value)}
          aria-label="New end date"
          className={CONTROL}
        />
        <ActionButton
          label="Extend"
          icon={CalendarPlus}
          tone="quiet"
          blockedBy={extendBlocked}
          onClick={() =>
            ask({
              title: "Extend the subscription",
              body: (
                <p>
                  Access for <span className="font-semibold text-ink">{user.email}</span> will run
                  until{" "}
                  <span className="font-semibold text-ink">
                    {formatInstantDate(`${newEnd}T23:59:59Z`, 0)}, 23:59 UTC
                  </span>
                  . Billing is not touched — this moves the end of the current period and takes no
                  payment.
                </p>
              ),
              confirmLabel: "Extend",
              noteLabel: "Why (optional)",
              onConfirm: perform("Subscription extended.", (note) =>
                extendSubscription(user.id, `${newEnd}T23:59:59Z`, note),
              ),
            })
          }
        />

        <ActionButton
          label="End now"
          icon={XCircle}
          tone="danger"
          blockedBy={endBlocked}
          onClick={() =>
            ask({
              title: "End the subscription now",
              body: (
                <>
                  <p>
                    Cuts Pro access for{" "}
                    <span className="font-semibold text-ink">{user.email}</span> immediately, whether
                    it was paid for or gifted.
                  </p>
                  <p className="font-semibold text-ink">
                    No refund is issued. If they paid for the remaining period, refund it in the
                    provider's dashboard separately.
                  </p>
                </>
              ),
              confirmLabel: "End access",
              tone: "danger",
              typeToConfirm: user.email,
              noteLabel: "Why (optional)",
              onConfirm: perform("Subscription ended.", (note) =>
                endSubscription(user.id, note),
              ),
            })
          }
        />
      </div>

      <BlockedNotes reasons={distinct([giftBlocked, revokeBlocked, extendBlocked, endBlocked])} />
    </Card>
  );
}

/* ── Account lifecycle ────────────────────────────────────────────────────── */

function LifecyclePanel({
  user,
  ask,
  perform,
  isSelf,
}: Omit<PanelProps, "offset"> & { isSelf: boolean }) {
  const isAdmin = user.role === "Admin";

  // The server refuses both of these on your own account. Blocking them here as well is not
  // redundant: it says why before the click, instead of after a 400.
  const selfBlock = isSelf
    ? "You cannot suspend your own account or change your own role."
    : undefined;

  return (
    <Card
      title="Account actions"
      hint="Every one of these is written to the audit trail against your account."
    >
      <div className="flex flex-wrap items-center gap-2">
        {user.isActive ? (
          <ActionButton
            label="Suspend"
            icon={UserX}
            tone="danger"
            blockedBy={selfBlock}
            onClick={() =>
              ask({
                title: "Suspend this account",
                body: (
                  <>
                    <p>
                      <span className="font-semibold text-ink">{user.email}</span> will be blocked
                      from signing in, and every refresh token they hold is revoked.
                    </p>
                    <p>
                      An access token already issued keeps working until it expires —{" "}
                      <span className="font-semibold text-ink">{ACCESS_TOKEN_WINDOW}</span>. This is
                      not an instant cut-off, and if that matters, wait out the window before
                      confirming anything else.
                    </p>
                    <p>
                      Nothing is deleted — their transcriptions and their subscription are
                      untouched. Reactivating lets them sign in again, but the revoked tokens stay
                      revoked, so every device signs in once more.
                    </p>
                  </>
                ),
                confirmLabel: "Suspend account",
                tone: "danger",
                typeToConfirm: user.email,
                noteLabel: "Why (optional)",
                onConfirm: perform("Account suspended.", (note) => suspendUser(user.id, note)),
              })
            }
          />
        ) : (
          <ActionButton
            label="Reactivate"
            icon={UserCheck}
            onClick={() =>
              ask({
                title: "Reactivate this account",
                body: (
                  <p>
                    <span className="font-semibold text-ink">{user.email}</span> will be able to
                    sign in again. They will need to sign in fresh: the refresh tokens revoked on
                    suspension are not restored.
                  </p>
                ),
                confirmLabel: "Reactivate",
                noteLabel: "Why (optional)",
                onConfirm: perform("Account reactivated.", (note) =>
                  reactivateUser(user.id, note),
                ),
              })
            }
          />
        )}

        <ActionButton
          label="Send reset link"
          icon={KeyRound}
          tone="quiet"
          onClick={() =>
            ask({
              title: "Send a password-reset link",
              body: (
                <>
                  <p>
                    Emails a reset link to{" "}
                    <span className="font-semibold text-ink">{user.email}</span>. The destination is
                    fixed by server configuration, so this cannot send a token anywhere else.
                  </p>
                  {!user.hasPassword && (
                    <p>
                      This account signs in with Google and has no password. The link lets them set
                      one; it does not remove Google sign-in.
                    </p>
                  )}
                </>
              ),
              confirmLabel: "Send link",
              noteLabel: "Why (optional)",
              onConfirm: perform("Reset link sent.", (note) => sendPasswordReset(user.id, note)),
            })
          }
        />

        <ActionButton
          label={isAdmin ? "Remove admin" : "Make admin"}
          icon={isAdmin ? ShieldOff : ShieldCheck}
          tone={isAdmin ? "danger" : "quiet"}
          blockedBy={selfBlock}
          onClick={() =>
            ask({
              title: isAdmin ? "Remove admin access" : "Grant admin access",
              body: isAdmin ? (
                <>
                  <p>
                    <span className="font-semibold text-ink">{user.email}</span> loses access to this
                    console and to every admin endpoint.
                  </p>
                  <p>
                    The change takes effect on their next access token, so a signed-in session keeps
                    admin powers for <span className="font-semibold text-ink">{ACCESS_TOKEN_WINDOW}</span>.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <span className="font-semibold text-ink">{user.email}</span> gains full access to
                    this console: every account's personal data, and every action on this page.
                  </p>
                  <p>They must sign out and back in before the new role is in their token.</p>
                </>
              ),
              confirmLabel: isAdmin ? "Remove admin" : "Grant admin",
              tone: "danger",
              typeToConfirm: user.email,
              noteLabel: "Why (optional)",
              onConfirm: perform(
                isAdmin ? "Admin access removed." : "Admin access granted.",
                (note) => setUserRole(user.id, isAdmin ? "user" : "admin", note),
              ),
            })
          }
        />
      </div>

      <BlockedNotes reasons={distinct([selfBlock])} />
    </Card>
  );
}

/* ── Histories ────────────────────────────────────────────────────────────── */

function PaymentsCard({ user, offset }: { user: AdminUserDetail; offset: number }) {
  return (
    <Card
      title="Payments"
      hint="Attempts, not just successes. Newest 20 — this is a support view, not an export."
      bleed
    >
      {user.payments.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-muted">
          No payment has ever been attempted on this account.
        </p>
      ) : (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[46rem]">
            <thead>
              <tr className={THEAD_TR}>
                <th className={TH}>When</th>
                <th className={TH}>Reference</th>
                <th className={TH}>Plan</th>
                <th className={TH}>Provider</th>
                <th className={TH}>Status</th>
                <th className={`${TH} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {user.payments.map((payment) => (
                <tr key={payment.id} className={TR}>
                  <td className={`${TD} whitespace-nowrap`}>
                    {formatInstantDateTime(payment.createdAtUtc, offset)}
                  </td>
                  <td className={TD}>
                    <span className="font-mono text-[11.5px] text-ink">{payment.reference}</span>
                    {payment.providerReference && (
                      <p className="font-mono text-[11px] text-faint">
                        {payment.providerReference}
                      </p>
                    )}
                  </td>
                  <td className={TD}>{payment.planName ?? UNKNOWN}</td>
                  <td className={TD}>{payment.provider}</td>
                  <td className={TD}>
                    <Badge tone={PAYMENT_TONES[payment.status]}>{payment.status}</Badge>
                    {payment.failureReason && (
                      <p className="mt-1 max-w-[18rem] text-[11px] text-danger-deep">
                        {payment.failureReason}
                      </p>
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right tabular-nums text-ink`}>
                    {formatMoney(payment.amountMinor, payment.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function LedgerCard({ user, offset }: { user: AdminUserDetail; offset: number }) {
  return (
    <Card
      title="Ledger"
      hint="Money recognised against this account. A gift writes nothing here, by design."
      bleed
    >
      {user.ledger.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-muted">No ledger entries.</p>
      ) : (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[38rem]">
            <thead>
              <tr className={THEAD_TR}>
                <th className={TH}>When</th>
                <th className={TH}>Reason</th>
                <th className={TH}>Description</th>
                <th className={`${TH} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {user.ledger.map((entry) => (
                <tr key={entry.id} className={TR}>
                  <td className={`${TD} whitespace-nowrap`}>
                    {formatInstantDateTime(entry.createdAtUtc, offset)}
                  </td>
                  <td className={TD}>
                    <Badge tone={entry.reason === "Refund" ? "warning" : "neutral"}>
                      {entry.reason === "SubscriptionCharge" ? "Charge" : "Refund"}
                    </Badge>
                  </td>
                  <td className={TD}>{entry.description}</td>
                  <td className={`${TD} whitespace-nowrap text-right tabular-nums text-ink`}>
                    {/* The stored amount is always positive; the direction carries the sign. */}
                    {entry.direction === "Credit" ? "+" : "−"}
                    {formatMoney(entry.amountMinor, entry.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RecentActionsCard({ user, offset }: { user: AdminUserDetail; offset: number }) {
  return (
    <Card
      title="Operator actions on this account"
      hint="Newest 20."
      bleed
      action={
        <Link
          to={`/audit-log?target=${user.id}`}
          className="text-xs font-semibold text-accent transition hover:opacity-80"
        >
          Full audit trail →
        </Link>
      }
    >
      {user.recentActions.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-muted">
          No operator has acted on this account.
        </p>
      ) : (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[44rem]">
            <thead>
              <tr className={THEAD_TR}>
                <th className={TH}>When</th>
                <th className={TH}>Action</th>
                <th className={TH}>By</th>
                <th className={TH}>IP</th>
                <th className={TH}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {user.recentActions.map((row) => {
                const meta = auditMeta(row.action);
                return (
                  <tr key={row.id} className={TR}>
                    <td className={`${TD} whitespace-nowrap`}>
                      {formatInstantDateTime(row.occurredAtUtc, offset)}
                    </td>
                    <td className={TD}>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </td>
                    <td className={TD}>{row.actorEmail}</td>
                    <td className={TD}>
                      <span className="font-mono text-[11.5px]">{row.ipAddress ?? UNKNOWN}</span>
                    </td>
                    <td className={TD}>
                      <p className="text-ink">{row.summary}</p>
                      {row.note && <p className="mt-0.5 italic text-faint">“{row.note}”</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export function UserDetailPage() {
  const { id = "" } = useParams();
  const auth = useAuth();

  const fetcher = useCallback((signal: AbortSignal) => getUserAccount(id, signal), [id]);
  const state = useAsync<AdminUserDetail>(fetcher);

  const [banner, setBanner] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const offset = getReportingOffset();

  const perform: Perform = (message, work) => async (note) => {
    // A throw propagates on purpose: the dialog keeps itself open and shows the server's own
    // message, which is where the real explanation lives ("that is the last administrator").
    await work(note);
    setBanner(message);
    state.reload();
  };

  const user = state.data;

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title={user?.fullName ?? "Account"}
        breadcrumb={["Dashboard", "Users", user?.email ?? "…"]}
        actions={
          <Link
            to="/users"
            className={`${BUTTON_BASE} border border-border text-ink hover:bg-surface-alt`}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            All users
          </Link>
        }
      />

      {banner && <ResultBanner message={banner} onDismiss={() => setBanner(null)} />}

      <StateView state={state} loadingLabel="Loading account">
        {(loaded) => (
          <div className="space-y-5">
            {!loaded.isActive && (
              <p
                className="flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger-deep"
                role="status"
              >
                <AlertTriangle size={16} className="mt-[1px] shrink-0" aria-hidden="true" />
                <span>
                  This account is suspended. It cannot sign in or refresh a session, and its
                  refresh tokens were revoked.
                </span>
              </p>
            )}

            <IdentityCard user={loaded} offset={offset} />

            <div className="grid gap-5 xl:grid-cols-2">
              <SubscriptionPanel
                user={loaded}
                offset={offset}
                ask={setConfirm}
                perform={perform}
                isSelf={loaded.id === auth.user?.id}
              />
              <LifecyclePanel
                user={loaded}
                ask={setConfirm}
                perform={perform}
                isSelf={loaded.id === auth.user?.id}
              />
            </div>

            <PaymentsCard user={loaded} offset={offset} />
            <LedgerCard user={loaded} offset={offset} />
            <RecentActionsCard user={loaded} offset={offset} />
          </div>
        )}
      </StateView>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
