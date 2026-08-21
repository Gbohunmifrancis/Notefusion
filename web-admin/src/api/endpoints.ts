import { query, request } from "@/api/client";
import type {
  AdminUserDetail,
  AdminUserRow,
  AnalyticsOverview,
  AuditAction,
  AuditLogRow,
  GiftDuration,
  LoginResponse,
  PagedResult,
  RoleName,
  SystemHealth,
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

/** `from` and `to` are inclusive reporting-local dates, "YYYY-MM-DD". */
export const getOverview = (from?: string, to?: string, signal?: AbortSignal) =>
  request<AnalyticsOverview>(
    `/api/admin/analytics/overview${query({ from, to })}`,
    signal ? { signal } : {},
  );

/** `isActive` omitted returns both; true is "can sign in", false is "suspended". */
export const getUsers = (
  page: number,
  pageSize: number,
  search?: string,
  isActive?: boolean,
  signal?: AbortSignal,
) =>
  request<PagedResult<AdminUserRow>>(
    `/api/admin/analytics/users${query({ page, pageSize, search, isActive })}`,
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
 * Mutations. Every one is a POST that returns 204, so they resolve to undefined — `request`
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
