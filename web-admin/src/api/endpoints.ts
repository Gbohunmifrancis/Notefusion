import { query, request } from "@/api/client";
import type {
  AdminLedgerRow,
  AdminPaymentDetail,
  AdminPaymentRow,
  AdminReconcileResult,
  AdminUserDetail,
  AdminUserRow,
  AdminWaitlistRow,
  AdminWebhookEventDetail,
  AdminWebhookEventRow,
  AnalyticsOverview,
  AuditAction,
  AuditLogRow,
  GiftDuration,
  LedgerDirection,
  LedgerReason,
  LoginResponse,
  MyProfile,
  PagedResult,
  PaymentOpsSummary,
  PaymentProviderName,
  PaymentStatus,
  RoleName,
  SystemHealth,
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
) =>
  request<PagedResult<AdminUserRow>>(
    `/api/admin/analytics/users${query({ page, pageSize, search, isActive, isOnline })}`,
    signal ? { signal } : {},
  );

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
