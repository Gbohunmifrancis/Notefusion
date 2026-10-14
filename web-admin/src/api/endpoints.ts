import { query, request } from "@/api/client";
import type {
  AdminLedgerRow,
  Insights,
  LiveActivity,
  AdminPaymentDetail,
  AdminPaymentRow,
  AdminReconcileResult,
  AdminTranscriptionRow,
  AdminUserDetail,
  AdminUserRow,
  AdminWaitlistRow,
  AdminWebhookEventDetail,
  AdminWebhookEventRow,
  KeyCorrections,
  AnalyticsOverview,
  CheckoutFunnel,
  Engagement,
  FeedbackKind,
  FeedbackRow,
  FeedbackSummary,
  FeedItem,
  FeedKind,
  Journey,
  JourneySubject,
  AuditAction,
  AuditLogRow,
  ClearStalePaymentsResult,
  GiftDuration,
  InboxAttachment,
  InboxEmailDetail,
  InboxPage,
  LedgerDirection,
  LedgerReason,
  LoginResponse,
  MyProfile,
  PagedResult,
  PaymentOpsSummary,
  PaymentProviderName,
  PaymentStatus,
  RoleName,
  SystemAnnouncement,
  SystemHealth,
  TranscriptionLogFilters,
  TranscriptionLogPage,
  WebhookStatus,
} from "@/api/types";

export const login = (email: string, password: string) =>
  request<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: { email, password },
    anonymous: true,
  });

/** Best-effort revoke. A failure here still clears the local session. */
export const logout = (refreshToken: string) =>
  request<void>("/api/auth/logout", {
    method: "POST",
    body: { refreshToken },
    anonymous: true,
  });

/**
 * The signed-in operator's own account. Not admin-gated — it is the same endpoint the app calls —
 * and the console wants it only for the avatar the shell shows, which the login payload cannot
 * carry without changing a contract the mobile client shares.
 */
export const getMyProfile = (signal?: AbortSignal) =>
  request<MyProfile>("/api/me", signal ? { signal } : {});

/** `from` and `to` are inclusive reporting-local dates, "YYYY-MM-DD". */
export interface InsightsFilter {
  from?: string | undefined;
  to?: string | undefined;
  country?: string | undefined;
  platform?: string | undefined;
  plan?: string | undefined;
}
export const getInsights = (f: InsightsFilter, signal?: AbortSignal) =>
  request<Insights>(`/api/admin/analytics/insights${query({ ...f })}`, signal ? { signal } : {});

export const getLiveActivity = (signal?: AbortSignal) =>
  request<LiveActivity>("/api/admin/analytics/live", signal ? { signal } : {});

export const getOverview = (from?: string, to?: string, signal?: AbortSignal) =>
  request<AnalyticsOverview>(
    `/api/admin/analytics/overview${query({ from, to })}`,
    signal ? { signal } : {},
  );

/** `isActive` omitted returns both; true is "can sign in", false is "suspended". `isOnline` filters active within 5m. */
export const getUsers = (
  page: number,
  pageSize: number,
  search?: string,
  isActive?: boolean,
  isOnline?: boolean,
  signal?: AbortSignal,
  /** "online" | "today" | "week" | "month" | "inactive". */
  lastSeen?: string,
  /** "lastSeen" lists the most recently seen first. */
  sort?: string,
  /** The list is customers only; true adds admins and team/test accounts. */
  includeInternal?: boolean,
) =>
  request<PagedResult<AdminUserRow>>(
    `/api/admin/analytics/users${query({ page, pageSize, search, isActive, isOnline, lastSeen, sort, includeInternal })}`,
    signal ? { signal } : {},
  );

export const getAdminTranscriptions = (
  page: number,
  pageSize: number,
  status?: string,
  search?: string,
  signal?: AbortSignal,
) =>
  request<PagedResult<AdminTranscriptionRow>>(
    `/api/admin/transcriptions${query({ page, pageSize, status, search })}`,
    signal ? { signal } : {},
  );

/** Saved sheets' dohs against the engine's: the doh correction rate behind the transcription quality. */
export const getKeyCorrections = (days = 30, signal?: AbortSignal) =>
  request<KeyCorrections>(`/api/admin/key-corrections${query({ days })}`, signal ? { signal } : {});

export const getWaitlist = (
  page: number,
  pageSize: number,
  search?: string,
  signal?: AbortSignal,
) =>
  request<PagedResult<AdminWaitlistRow>>(
    `/api/admin/waitlist${query({ page, pageSize, search })}`,
    signal ? { signal } : {},
  );

export const getUserAccount = (id: string, signal?: AbortSignal) =>
  request<AdminUserDetail>(`/api/admin/users/${id}`, signal ? { signal } : {});

export const getAuditLog = (
  page: number,
  pageSize: number,
  filters: { action?: AuditAction; targetUserId?: string; search?: string } = {},
  signal?: AbortSignal,
) =>
  request<PagedResult<AuditLogRow>>(
    `/api/admin/audit-log${query({ page, pageSize, ...filters })}`,
    signal ? { signal } : {},
  );

export const getHealth = (signal?: AbortSignal) =>
  request<SystemHealth>("/api/admin/health", signal ? { signal } : {});

/*
 * Payments and reconciliation. The reads are global — every account's attempts in one table — which
 * is what makes them answer "whose money is stuck" without knowing whose to look at first.
 */

/**
 * The counts, the balance, and the two windows the workers run on. Read this before the table: the
 * stuck count is what makes a filtered list worth opening, and `graceWindowMinutes` is what makes
 * the word "stuck" mean anything.
 */
export const getPaymentsSummary = (signal?: AbortSignal) =>
  request<PaymentOpsSummary>("/api/admin/payments/summary", signal ? { signal } : {});

/**
 * `stuckOnly` narrows to exactly what the sweep would pick up. `search` matches our reference, the
 * provider's, or the account's email — the three things a support ticket actually quotes.
 */
export const getPayments = (
  page: number,
  pageSize: number,
  filters: {
    status?: PaymentStatus;
    provider?: PaymentProviderName;
    stuckOnly?: boolean;
    fromUtc?: string;
    toUtc?: string;
    search?: string;
  } = {},
  signal?: AbortSignal,
) =>
  request<PagedResult<AdminPaymentRow>>(
    `/api/admin/payments${query({ page, pageSize, ...filters })}`,
    signal ? { signal } : {},
  );

/** Adds the raw gateway payloads and everything the payment caused. Admin-only, like the rest. */
export const getPayment = (id: string, signal?: AbortSignal) =>
  request<AdminPaymentDetail>(`/api/admin/payments/${id}`, signal ? { signal } : {});

/**
 * Asks the provider what happened and applies the answer, ahead of the sweep.
 *
 * The one mutation here that returns a body rather than 204: the underlying command is idempotent
 * and reports "already settled" as plain success, so the answer is the only way to tell the console
 * which kind of success it got. Safe to repeat.
 */
export const reconcilePayment = (id: string, note?: string) =>
  request<AdminReconcileResult>(`/api/admin/payments/${id}/reconcile`, {
    method: "POST",
    body: { note },
  });

/**
 * The webhook inbox. `search` covers the provider event id, the event type and the payment
 * reference — deliberately not the payload, so a page of results is never a full-text scan of every
 * request body the gateways have ever sent.
 */
export const getWebhooks = (
  page: number,
  pageSize: number,
  filters: { status?: WebhookStatus; provider?: PaymentProviderName; search?: string } = {},
  signal?: AbortSignal,
) =>
  request<PagedResult<AdminWebhookEventRow>>(
    `/api/admin/webhooks${query({ page, pageSize, ...filters })}`,
    signal ? { signal } : {},
  );

/**
 * One stored callback, with the body the provider sent. There is no replay beside it: reconciling
 * the payment recovers the subscription whether or not the callback ever drains, so the payload is
 * here to explain why it did not, not to be re-run.
 */
export const getWebhook = (id: string, signal?: AbortSignal) =>
  request<AdminWebhookEventDetail>(`/api/admin/webhooks/${id}`, signal ? { signal } : {});

/** Money in and money out across every account. Append-only: nothing on this page can change it. */
export const getLedger = (
  page: number,
  pageSize: number,
  filters: {
    direction?: LedgerDirection;
    reason?: LedgerReason;
    fromUtc?: string;
    toUtc?: string;
    search?: string;
  } = {},
  signal?: AbortSignal,
) =>
  request<PagedResult<AdminLedgerRow>>(
    `/api/admin/ledger${query({ page, pageSize, ...filters })}`,
    signal ? { signal } : {},
  );

/*
 * Account mutations. Every one is a POST that returns 204, so they resolve to undefined — `request`
 * already handles that. The target account is always in the route and never in the body, which
 * is what stops a body typo from acting on a different user than the page is showing.
 *
 * `note` is the operator's reason. It is optional on the wire, but the console asks for one on
 * anything destructive: the audit row is the only record of *why*, and the summary the handler
 * writes can only say what happened.
 */

const act = (id: string, action: string, body: Record<string, unknown>) =>
  request<void>(`/api/admin/users/${id}/${action}`, { method: "POST", body });

export const giftPro = (id: string, duration: GiftDuration, note?: string) =>
  act(id, "gift-pro", { duration, note });

/** Refused on a subscription somebody paid for — use `endSubscription` for that, deliberately. */
export const revokePro = (id: string, note?: string) => act(id, "revoke-pro", { note });

/** `newEndUtc` is an ISO instant; the server pins it to UTC and refuses a backwards move. */
export const extendSubscription = (id: string, newEndUtc: string, note?: string) =>
  act(id, "subscription/extend", { newEndUtc, note });

/** Cuts access now, paid or gifted, and refunds nothing. */
export const endSubscription = (id: string, note?: string) =>
  act(id, "subscription/end", { note });

/**
 * Blocks sign-in and refresh, and revokes every refresh token. An access token already issued
 * still works until it expires — the UI states that window rather than implying a cut-off.
 */
export const suspendUser = (id: string, note?: string) => act(id, "suspend", { note });

export const reactivateUser = (id: string, note?: string) => act(id, "reactivate", { note });

/** A team or test account is left out of every analytics figure and list (admins always are). */
export const setInternalAccount = (id: string, isInternal: boolean, note?: string) =>
  act(id, "internal", { isInternal, note });

/** Takes effect on the target's next access token, not immediately. */
export const setUserRole = (id: string, role: RoleName, note?: string) =>
  act(id, "role", { role, note });

export const sendPasswordReset = (id: string, note?: string) =>
  act(id, "send-password-reset", { note });

export interface SendUserEmailPayload {
  subject: string;
  heading?: string | undefined;
  bodyHtml: string;
  ctaText?: string | undefined;
  ctaUrl?: string | undefined;
  note?: string | undefined;
}

/** Sends a branded custom email to the target user, rendered with NoteFusion's template. */
export const sendUserEmail = (id: string, payload: SendUserEmailPayload) =>
  act(id, "email", payload as unknown as Record<string, unknown>);

// ── Inbox (received emails via Resend inbound route) ────────────────────────────────────────────

export const getInbox = (page: number, pageSize: number, signal?: AbortSignal) =>
  request<InboxPage>(`/api/admin/inbox${query({ page, pageSize })}`, signal ? { signal } : {});

export const getInboxEmail = (id: string, signal?: AbortSignal) =>
  request<InboxEmailDetail>(`/api/admin/inbox/${id}`, signal ? { signal } : {});

export const getInboxAttachments = (id: string, signal?: AbortSignal) =>
  request<InboxAttachment[]>(`/api/admin/inbox/${id}/attachments`, signal ? { signal } : {});

export const replyToEmail = (id: string, subject: string, bodyHtml: string) =>
  request<void>(`/api/admin/inbox/${id}/reply`, {
    method: "POST",
    body: { subject, bodyHtml },
  });

export const clearStalePayments = () =>
  request<ClearStalePaymentsResult>("/api/admin/payments/clear-stale", {
    method: "POST",
  });

export const resetTrialQuota = (id: string, note?: string) =>
  request<number>(`/api/admin/users/${id}/reset-trial`, {
    method: "POST",
    body: { note },
  });

export const getTranscriptions = (
  page: number,
  pageSize: number,
  filters: { status?: string; search?: string } = {},
  signal?: AbortSignal,
) =>
  request<PagedResult<AdminTranscriptionRow>>(
    `/api/admin/transcriptions${query({ page, pageSize, ...filters })}`,
    signal ? { signal } : {},
  );

export const getAnnouncement = (signal?: AbortSignal) =>
  request<SystemAnnouncement | null>("/api/admin/announcement", signal ? { signal } : {});

export const setAnnouncement = (payload: {
  message: string;
  severity?: "info" | "warning" | "critical";
  expiresAtUtc?: string | null;
}) =>
  request<SystemAnnouncement>("/api/admin/announcement", {
    method: "POST",
    body: payload,
  });

export const clearAnnouncement = () =>
  request<void>("/api/admin/announcement", {
    method: "DELETE",
  });

/* ── Activity ─────────────────────────────────────────────────────────────── */

/** Every transcription asked for, saved or not, newest first. */
export const getTranscriptionLog = (
  page: number,
  pageSize: number,
  filters: TranscriptionLogFilters,
  signal?: AbortSignal,
) =>
  request<TranscriptionLogPage>(
    `/api/admin/activity/transcriptions${query({ page, pageSize, ...filters })}`,
    signal ? { signal } : {},
  );

/** One account's, device's or browser's pages, clicks, actions, transcriptions and payments. */
export const getJourney = (subject: JourneySubject, days: number, signal?: AbortSignal) =>
  request<Journey>(`/api/admin/activity/journey${query({ ...subject, days })}`, signal ? { signal } : {});

/** The full user activity feed behind the overview's "Recent activity" panel. */
export const getActivityFeed = (page: number, pageSize: number, kind?: FeedKind, signal?: AbortSignal) =>
  request<PagedResult<FeedItem>>(`/api/admin/activity/feed${query({ page, pageSize, kind })}`, signal ? { signal } : {});

/** The checkout funnel and its problems over a window. */
export const getCheckoutFunnel = (from?: string, to?: string, signal?: AbortSignal) =>
  request<CheckoutFunnel>(`/api/admin/activity/checkout${query({ from, to })}`, signal ? { signal } : {});

/* ── Engagement and feedback ─────────────────────────────────────────────── */

/** The most active accounts and how engaged users were over a window. */
export const getEngagement = (from?: string, to?: string, top = 20, signal?: AbortSignal) =>
  request<Engagement>(`/api/admin/analytics/engagement${query({ from, to, top })}`, signal ? { signal } : {});

export const getFeedbackSummary = (signal?: AbortSignal) =>
  request<FeedbackSummary>("/api/admin/feedback/summary", signal ? { signal } : {});

export const getFeedbackList = (page: number, pageSize: number, kind?: FeedbackKind, userId?: string, signal?: AbortSignal) =>
  request<PagedResult<FeedbackRow>>(`/api/admin/feedback${query({ page, pageSize, kind, userId })}`, signal ? { signal } : {});

