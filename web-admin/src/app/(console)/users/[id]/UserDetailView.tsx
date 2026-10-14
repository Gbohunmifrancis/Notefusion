"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarPlus,
  Gift,
  KeyRound,
  Mail,
  Route,
  ShieldCheck,
  ShieldOff,
  Undo2,
  UserCheck,
  UserX,
  XCircle,
  type LucideIcon,
  Eye,
  EyeOff,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { SendEmailDialog } from "@/components/SendEmailDialog";

import {
  endSubscription,
  extendSubscription,
  getJourney,
  getTranscriptionLog,
  getUserAccount,
  giftPro,
  reactivateUser,
  resetTrialQuota,
  revokePro,
  sendPasswordReset,
  setInternalAccount,
  setUserRole,
  suspendUser,
} from "@/api/endpoints";
import type {
  AdminUserDetail,
  GiftDuration,
  SubscriptionStatus,
} from "@/api/types";
import { JourneyTimeline } from "@/components/activity/JourneyTimeline";
import { TranscriptionLogTable } from "@/components/activity/TranscriptionLogTable";
import { Avatar } from "@/components/Avatar";
import { Badge, type BadgeTone } from "@/components/Badge";
import { Card } from "@/components/Card";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { StateView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { auditMeta } from "@/lib/audit";
import { useAuth } from "@/lib/auth";
import {
  UNKNOWN,
  addDays,
  formatCount,
  formatInstantDate,
  formatInstantDateTime,
  formatMoney,
  reportingToday,
} from "@/lib/format";
import { PAYMENT_TONES } from "@/lib/payments";
import { getReportingOffset } from "@/lib/reporting";
import { TBODY, TD, TH } from "@/lib/tableClasses";

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

/**
 * Turns a mutation into the `onConfirm` the dialog wants: perform it, say what happened, and drop
 * the cached account so it is re-read from the server. Re-reading rather than patching state locally
 * is deliberate — the server decided what actually changed, and a gift also moves the subscription,
 * the audit trail and possibly the role in one go.
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

/** Shared metrics for the operator buttons: shorter than shadcn's default and a tighter icon gap. */
const ACTION = "h-9 gap-1.5 text-[13px] font-semibold";

const TONES: Record<
  "default" | "danger" | "quiet",
  { variant: "default" | "outline"; className: string }
> = {
  default: { variant: "default", className: "" },
  quiet: { variant: "outline", className: "" },
  // Not shadcn's `destructive`, which is a filled red: two of the three buttons in the subscription
  // row are destructive, and filling both would make the panel shout. An outline in danger colours
  // reads as the same warning at the volume the rest of the console speaks at. The dark overrides
  // are needed because `outline` re-colours its own border and hover above the plain ones.
  danger: {
    variant: "outline",
    className:
      "border-danger/40 text-danger-deep hover:bg-danger/10 hover:text-danger-deep dark:border-danger/40 dark:hover:bg-danger/10",
  },
};

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
  const skin = TONES[tone];

  return (
    // A disabled button takes no pointer events — right, but it also means no native tooltip. The
    // reason has to hang off a wrapper that still receives the pointer. `BlockedNotes` prints every
    // reason under the row regardless; this is for whoever hovers the greyed control instead.
    <span
      className={blockedBy ? "inline-flex cursor-not-allowed" : "inline-flex"}
      {...(blockedBy ? { title: blockedBy } : {})}
    >
      <Button
        type="button"
        variant={skin.variant}
        onClick={onClick}
        disabled={Boolean(blockedBy)}
        className={`${ACTION} ${skin.className}`}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </Button>
    </span>
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
      <dd className="mt-1 break-words text-[13px] text-foreground">{children}</dd>
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
        <Avatar name={user.fullName} src={user.profilePictureUrl} size={48} />
        <div className="min-w-0">
          <p className="truncate text-heading font-semibold text-foreground">{user.fullName}</p>
          <p className="truncate text-[13px] text-muted-foreground">{user.email}</p>
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
        <Field label="Transcriptions">
          <span title="Every transcription that produced a result, saved or not: finished jobs, free previews claimed at sign-up, and sheets saved before jobs were recorded">
            {formatCount(user.transcriptionCount)}
          </span>
          <span className="ml-1.5 text-xs text-muted-foreground">
            {formatCount(user.savedTranscriptionCount)} saved
            {user.failedTranscriptionCount > 0 && ` · ${formatCount(user.failedTranscriptionCount)} failed`}
          </span>
        </Field>
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
            {sub.isLifetime
              ? "Never — lifetime"
              : formatInstantDateTime(sub.currentPeriodEndUtc, offset)}
          </Field>
          {sub.canceledAtUtc && (
            <Field label="Cancelled">{formatInstantDateTime(sub.canceledAtUtc, offset)}</Field>
          )}
        </dl>
      ) : (
        <p className="border-b border-border-light pb-5 text-[13px] text-muted-foreground">
          No subscription on this account. They are on the free tier, with{" "}
          {formatCount(user.trialGenerationsUsed)} of {formatCount(user.trialGenerationsTotal)} free
          generations used.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Select value={duration} onValueChange={(next) => setDuration(next as GiftDuration)}>
          <SelectTrigger aria-label="Gift duration" className="rounded-sm text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="monthly">1 month</SelectItem>
            <SelectItem value="yearly">1 year</SelectItem>
            <SelectItem value="lifetime">Lifetime</SelectItem>
          </SelectContent>
        </Select>
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
                    Grants{" "}
                    <span className="font-semibold text-foreground">
                      {DURATION_LABELS[duration]}
                    </span>{" "}
                    of Pro to <span className="font-semibold text-foreground">{user.email}</span> at
                    no charge.
                  </p>
                  <p>
                    No payment is recorded, so this never counts as revenue. It is written to the
                    audit trail against your account.
                  </p>
                </>
              ),
              confirmLabel: "Grant Pro",
              noteLabel: "Why (optional)",
              onConfirm: perform("Pro access granted.", (note) => giftPro(user.id, duration, note)),
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
                    <span className="font-semibold text-foreground">{user.email}</span> immediately.
                    Their saved transcriptions are untouched; only the Pro entitlement stops.
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
        {/* `w-auto` because shadcn's input is full-width, which would push the button onto its own
            row; the 16px text below `md` is shadcn's own, and it is what stops iOS zooming on
            focus. */}
        <Input
          type="date"
          value={newEnd}
          min={minEnd}
          onChange={(event) => setNewEnd(event.target.value)}
          aria-label="New end date"
          className="w-auto rounded-sm md:text-[13px]"
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
                  Access for <span className="font-semibold text-foreground">{user.email}</span> will
                  run until{" "}
                  <span className="font-semibold text-foreground">
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
                    <span className="font-semibold text-foreground">{user.email}</span> immediately,
                    whether it was paid for or gifted.
                  </p>
                  <p className="font-semibold text-foreground">
                    No refund is issued. If they paid for the remaining period, refund it in the
                    provider&apos;s dashboard separately.
                  </p>
                </>
              ),
              confirmLabel: "End access",
              tone: "danger",
              typeToConfirm: user.email,
              noteLabel: "Why (optional)",
              onConfirm: perform("Subscription ended.", (note) => endSubscription(user.id, note)),
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
  onOpenEmail,
}: Omit<PanelProps, "offset"> & { isSelf: boolean; onOpenEmail: () => void }) {
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
        <ActionButton
          label="Send email"
          icon={Mail}
          tone="default"
          onClick={onOpenEmail}
        />

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
                      <span className="font-semibold text-foreground">{user.email}</span> will be
                      blocked from signing in, and every refresh token they hold is revoked.
                    </p>
                    <p>
                      An access token already issued keeps working until it expires —{" "}
                      <span className="font-semibold text-foreground">{ACCESS_TOKEN_WINDOW}</span>.
                      This is not an instant cut-off, and if that matters, wait out the window before
                      confirming anything else.
                    </p>
                    <p>
                      Nothing is deleted — their transcriptions and their subscription are untouched.
                      Reactivating lets them sign in again, but the revoked tokens stay revoked, so
                      every device signs in once more.
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
                    <span className="font-semibold text-foreground">{user.email}</span> will be able
                    to sign in again. They will need to sign in fresh: the refresh tokens revoked on
                    suspension are not restored.
                  </p>
                ),
                confirmLabel: "Reactivate",
                noteLabel: "Why (optional)",
                onConfirm: perform("Account reactivated.", (note) => reactivateUser(user.id, note)),
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
                    <span className="font-semibold text-foreground">{user.email}</span>. The
                    destination is fixed by server configuration, so this cannot send a token
                    anywhere else.
                  </p>
                  {!user.hasPassword && (
                    <p>
                      This account signs in with Google and has no password. The link lets them set
                    one; it does not remove Google sign-in.
                    </p>
                  )}
                </>
              ),
              confirmLabel: "Send reset link",
              noteLabel: "Why (optional)",
              onConfirm: perform("Reset link sent.", (note) => sendPasswordReset(user.id, note)),
            })
          }
        />

        {user.trialGenerationsUsed > 0 && (
          <ActionButton
            label="Reset trial quota"
            icon={Undo2}
            tone="quiet"
            onClick={() =>
              ask({
                title: "Reset trial quota",
                body: (
                  <p>
                    Reset free trial generations used for{" "}
                    <span className="font-semibold text-foreground">{user.email}</span>?
                    Their trial count will be reset to 0, restoring their free transcription quota.
                  </p>
                ),
                confirmLabel: "Reset quota",
                noteLabel: "Why (optional)",
                onConfirm: perform("Trial quota reset.", async (note) => {
                  await resetTrialQuota(user.id, note);
                }),
              })
            }
          />
        )}

        {/* Team and test accounts stay out of the numbers; an admin always does, so the toggle is for the rest. */}
        {!isAdmin && (
          <ActionButton
            label={user.isInternal ? "Count in analytics" : "Mark as team/test account"}
            icon={user.isInternal ? Eye : EyeOff}
            tone="quiet"
            onClick={() =>
              ask({
                title: user.isInternal ? "Count this account in analytics" : "Leave this account out of analytics",
                body: user.isInternal ? (
                  <p>
                    <span className="font-semibold text-foreground">{user.email}</span> will be counted as a customer again:
                    in the overview, Insights, the Users list, the live notices and every chart.
                  </p>
                ) : (
                  <p>
                    <span className="font-semibold text-foreground">{user.email}</span> is the team&apos;s own or a test
                    account. It disappears from the overview, Insights, the Users list (unless you show the team), the
                    live notices and every chart, along with its browser&apos;s website visits. The account itself is not
                    touched.
                  </p>
                ),
                confirmLabel: user.isInternal ? "Count it" : "Leave it out",
                noteLabel: "Why (optional)",
                onConfirm: perform(
                  user.isInternal ? "Counted in analytics again." : "Left out of analytics.",
                  (note) => setInternalAccount(user.id, !user.isInternal, note),
                ),
              })
            }
          />
        )}

        <ActionButton
          label={isAdmin ? "Demote from admin" : "Make admin"}
          icon={isAdmin ? ShieldOff : ShieldCheck}
          tone={isAdmin ? "danger" : "quiet"}
          blockedBy={selfBlock}
          onClick={() =>
            ask({
              title: isAdmin ? "Remove admin access" : "Grant admin access",
              body: isAdmin ? (
                <>
                  <p>
                    <span className="font-semibold text-foreground">{user.email}</span> loses access
                    to this console and to every admin endpoint.
                  </p>
                  <p>
                    The change takes effect on their next access token, so a signed-in session keeps
                    admin powers for{" "}
                    <span className="font-semibold text-foreground">{ACCESS_TOKEN_WINDOW}</span>.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <span className="font-semibold text-foreground">{user.email}</span> gains full
                    access to this console: every account&apos;s personal data, and every action on
                    this page.
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
        <p className="px-5 pb-5 text-[13px] text-muted-foreground">
          No payment has ever been attempted on this account.
        </p>
      ) : (
        <div className="border-t border-border">
          <Table className="min-w-[46rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>When</TableHead>
                <TableHead className={TH}>Reference</TableHead>
                <TableHead className={TH}>Plan</TableHead>
                <TableHead className={TH}>Provider</TableHead>
                <TableHead className={TH}>Status</TableHead>
                <TableHead className={`${TH} text-right`}>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={TBODY}>
              {user.payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className={TD}>
                    {formatInstantDateTime(payment.createdAtUtc, offset)}
                  </TableCell>
                  <TableCell className={TD}>
                    <span className="font-mono text-[11.5px] text-foreground">
                      {payment.reference}
                    </span>
                    {payment.providerReference && (
                      <p className="font-mono text-[11px] text-faint">
                        {payment.providerReference}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className={TD}>{payment.planName ?? UNKNOWN}</TableCell>
                  <TableCell className={TD}>{payment.provider}</TableCell>
                  {/* Wraps, because a provider's failure reason is a sentence. */}
                  <TableCell className={`${TD} whitespace-normal`}>
                    <Badge tone={PAYMENT_TONES[payment.status]}>{payment.status}</Badge>
                    {payment.failureReason && (
                      <p className="mt-1 max-w-[18rem] text-[11px] text-danger-deep">
                        {payment.failureReason}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className={`${TD} text-right tabular-nums text-foreground`}>
                    {formatMoney(payment.amountMinor, payment.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
        <p className="px-5 pb-5 text-[13px] text-muted-foreground">No ledger entries.</p>
      ) : (
        <div className="border-t border-border">
          <Table className="min-w-[38rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>When</TableHead>
                <TableHead className={TH}>Reason</TableHead>
                <TableHead className={TH}>Description</TableHead>
                <TableHead className={`${TH} text-right`}>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={TBODY}>
              {user.ledger.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className={TD}>
                    {formatInstantDateTime(entry.createdAtUtc, offset)}
                  </TableCell>
                  <TableCell className={TD}>
                    <Badge tone={entry.reason === "Refund" ? "warning" : "neutral"}>
                      {entry.reason === "SubscriptionCharge" ? "Charge" : "Refund"}
                    </Badge>
                  </TableCell>
                  <TableCell className={`${TD} whitespace-normal`}>{entry.description}</TableCell>
                  <TableCell className={`${TD} text-right tabular-nums text-foreground`}>
                    {/* The stored amount is always positive; the direction carries the sign. */}
                    {entry.direction === "Credit" ? "+" : "−"}
                    {formatMoney(entry.amountMinor, entry.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
          href={`/audit-log?target=${user.id}`}
          className="text-xs font-semibold text-brand transition hover:opacity-80"
        >
          Full audit trail →
        </Link>
      }
    >
      {user.recentActions.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-muted-foreground">
          No operator has acted on this account.
        </p>
      ) : (
        <div className="border-t border-border">
          <Table className="min-w-[44rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>When</TableHead>
                <TableHead className={TH}>Action</TableHead>
                <TableHead className={TH}>By</TableHead>
                <TableHead className={TH}>IP</TableHead>
                <TableHead className={TH}>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={TBODY}>
              {user.recentActions.map((row) => {
                const meta = auditMeta(row.action);
                return (
                  <TableRow key={row.id}>
                    <TableCell className={TD}>
                      {formatInstantDateTime(row.occurredAtUtc, offset)}
                    </TableCell>
                    <TableCell className={TD}>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </TableCell>
                    <TableCell className={TD}>{row.actorEmail}</TableCell>
                    <TableCell className={TD}>
                      <span className="font-mono text-[11.5px]">{row.ipAddress ?? UNKNOWN}</span>
                    </TableCell>
                    {/* A summary plus a note is prose, and shadcn's cell is nowrap by default. */}
                    <TableCell className={`${TD} whitespace-normal`}>
                      <p className="text-foreground">{row.summary}</p>
                      {row.note && <p className="mt-0.5 italic text-faint">“{row.note}”</p>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function TranscriptionsCard({ user, offset }: { user: AdminUserDetail; offset: number }) {
  const rows = user.recentTranscriptions ?? [];
  return (
    <Card
      title="Recent transcriptions"
      hint="Newest transcriptions generated by this user."
      bleed
    >
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-muted-foreground">
          No transcriptions created yet.
        </p>
      ) : (
        <div className="border-t border-border">
          <Table className="min-w-[38rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>When</TableHead>
                <TableHead className={TH}>Title</TableHead>
                <TableHead className={TH}>Key</TableHead>
                <TableHead className={TH}>Tempo</TableHead>
                <TableHead className={TH}>Confidence</TableHead>
                <TableHead className={`${TH} text-right`}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={TBODY}>
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className={TD}>
                    {formatInstantDateTime(t.createdAtUtc, offset)}
                  </TableCell>
                  <TableCell className={`${TD} font-medium text-foreground`}>
                    {t.title || "Untitled"}
                  </TableCell>
                  <TableCell className={TD}>{t.key || "—"}</TableCell>
                  <TableCell className={TD}>{t.tempoBpm > 0 ? `${t.tempoBpm} BPM` : "—"}</TableCell>
                  <TableCell className={TD}>{Math.round(t.overallConfidence * 100)}%</TableCell>
                  <TableCell className={`${TD} text-right`}>
                    <Badge
                      tone={
                        t.status.toLowerCase() === "completed"
                          ? "success"
                          : t.status.toLowerCase() === "failed"
                          ? "danger"
                          : "neutral"
                      }
                    >
                      {t.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

/** Every transcription this account asked for, saved or not, from the activity log. */
function ActivityLogCard({ userId, offset }: { userId: string; offset: number }) {
  const [page, setPage] = useState(1);
  const state = useQuery({
    queryKey: ["activity-log", "user", userId, page],
    queryFn: ({ signal }) => getTranscriptionLog(page, 10, { userId }, signal),
    placeholderData: keepPreviousData,
  });
  const s = state.data?.summary;
  return (
    <Card
      title="Everything transcribed"
      hint={
        s
          ? `${s.total} asked for · ${s.saved} saved · ${s.failed + s.refused} failed or refused, including free previews before signing up`
          : "Saved or not, including free previews before signing up"
      }
      bleed
    >
      <StateView
        state={state}
        isEmpty={(d) => d.page.items.length === 0}
        emptyMessage="Nothing transcribed yet"
        loadingLabel="Loading transcriptions"
      >
        {(d) => (
          <div className="border-t border-border">
            <TranscriptionLogTable rows={d.page.items} offset={offset} showUser={false} />
            <Pager
              page={d.page.page}
              pageSize={d.page.pageSize}
              totalCount={d.page.totalCount}
              totalPages={d.page.totalPages}
              busy={state.isFetching}
              onPage={setPage}
            />
          </div>
        )}
      </StateView>
    </Card>
  );
}

/** The newest of this account's journey; the full one is its own page. */
function JourneyCard({ userId, offset }: { userId: string; offset: number }) {
  const state = useQuery({
    queryKey: ["journey", { userId }, "30", "card"],
    queryFn: ({ signal }) => getJourney({ userId }, 30, signal),
  });
  return (
    <Card
      title="Journey (last 30 days)"
      hint="Pages, clicks, app actions, uploads and payments, from every browser and device seen signed in as this account"
      action={
        <Button asChild variant="outline" className={ACTION}>
          <Link href={`/activity/journey?userId=${userId}`}>Full journey</Link>
        </Button>
      }
      bleed
    >
      <StateView state={state} loadingLabel="Loading journey">
        {(j) => <JourneyTimeline items={j.items} offset={offset} limit={40} />}
      </StateView>
    </Card>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export function UserDetailView({ id }: { id: string }) {
  const auth = useAuth();
  const queryClient = useQueryClient();

  const state = useQuery({
    queryKey: ["user", id],
    queryFn: ({ signal }) => getUserAccount(id, signal),
  });

  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  const offset = getReportingOffset();

  const perform: Perform = (message, work) => async (note) => {
    // A throw propagates on purpose: the dialog keeps itself open and shows the server's own
    // message, which is where the real explanation lives ("that is the last administrator").
    await work(note);
    toast.success(message);
    // Every panel here and every list that named this account is now stale — one gift moves the
    // subscription, the plan badge in the accounts table, the audit trail and the overview's
    // counts at once. Rather than enumerate those keys and miss one, drop the whole cache; it
    // holds a handful of small aggregates. Not awaited, so the dialog closes as it always did.
    void queryClient.invalidateQueries();
  };

  const user = state.data;

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title={user?.fullName ?? "Account"}
        breadcrumb={["Dashboard", "Users", user?.email ?? "…"]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="default"
              className={ACTION}
              onClick={() => setEmailOpen(true)}
            >
              <Mail className="size-3.5" aria-hidden="true" />
              Send email
            </Button>
            <Button asChild variant="outline" className={ACTION}>
              <Link href={`/activity/journey?userId=${id}`}>
                <Route className="size-3.5" aria-hidden="true" />
                Journey
              </Link>
            </Button>
            <Button asChild variant="outline" className={ACTION}>
              <Link href="/users">
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                All users
              </Link>
            </Button>
          </div>
        }
      />

      <StateView state={state} loadingLabel="Loading account">
        {(loaded) => (
          <div className="space-y-5">
            {!loaded.isActive && (
              <p
                className="flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger-deep"
                role="status"
              >
                <AlertTriangle className="mt-[1px] size-4 shrink-0" aria-hidden="true" />
                <span>
                  This account is suspended. It cannot sign in or refresh a session, and its refresh
                  tokens were revoked.
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
                onOpenEmail={() => setEmailOpen(true)}
              />
            </div>

            <PaymentsCard user={loaded} offset={offset} />
            <JourneyCard userId={loaded.id} offset={offset} />
            <ActivityLogCard userId={loaded.id} offset={offset} />
            <TranscriptionsCard user={loaded} offset={offset} />
            <LedgerCard user={loaded} offset={offset} />
            <RecentActionsCard user={loaded} offset={offset} />
          </div>
        )}
      </StateView>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />

      {user && (
        <SendEmailDialog
          open={emailOpen}
          onOpenChange={setEmailOpen}
          targetUser={user}
          onSuccess={() => {
            void queryClient.invalidateQueries();
          }}
        />
      )}
    </div>
  );
}
