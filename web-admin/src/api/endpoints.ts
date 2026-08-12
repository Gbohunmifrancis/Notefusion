import { query, request } from "@/api/client";
import type {
  AdminUserRow,
  AnalyticsOverview,
  LoginResponse,
  PagedResult,
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

export const getUsers = (
  page: number,
  pageSize: number,
  search?: string,
  signal?: AbortSignal,
) =>
  request<PagedResult<AdminUserRow>>(
    `/api/admin/analytics/users${query({ page, pageSize, search })}`,
    signal ? { signal } : {},
  );
