/**
 * Wire types for the admin analytics API.
 *
 * These mirror the C# DTOs exactly (`src/NoteFusion.Application/Analytics/Dtos/AnalyticsDtos.cs`
 * and `Auth/Dtos/AuthResponses.cs`). The wire contract is camelCase. Change one side and
 * change the other in the same commit.
 *
 * Note what is deliberately absent: there are no subscribed / paid / free-tier fields,
 * because no subscription, plan or payment entity exists in the schema yet. The server
 * does not emit them and this dashboard must not invent them — a zero on an admin
 * dashboard reads as a fact about the business, not as a missing feature.
 */

/** The C# `ApiError` envelope returned for every non-2xx result. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, string[]> | null;
}

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  /** `UserRole` as a string: "User" | "Admin". */
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  user: AuthUser;
}

export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserMetrics {
  totalUsers: number;
  newUsers: number;
  newUsersPrevious: number;
  activeUsers: number;
  activeUsersPrevious: number;
  /** Accounts with a linked Google identity. Not a general email-verification count. */
  googleVerifiedUsers: number;
  passwordOnlyUsers: number;
  lockedOutUsers: number;
  deactivatedUsers: number;
}

export interface TranscriptionMetrics {
  totalSaved: number;
  totalSavedPrevious: number;
  succeededCount: number;
  failedCount: number;
  inFlightCount: number;
  /** Null when nothing reached a terminal state. Null is not 0 — render it as unknown. */
  successRate: number | null;
  /** Null when nothing succeeded. */
  averageConfidence: number | null;
  /**
   * Total size of stored MusicXML across all transcriptions, in bytes. Audio is deleted per job,
   * so this is the whole stored footprint, not a proxy. Always a number (0 on an empty library).
   */
  storedBytes: number;
}

export interface DailyCount {
  /** A reporting-local calendar date, "YYYY-MM-DD". Already shifted by the server. */
  date: string;
  count: number;
}

export interface CategoryCount {
  label: string;
  count: number;
}

export interface RetentionCohort {
  /** Monday-anchored reporting-local week start, "YYYY-MM-DD". */
  cohortStart: string;
  cohortSize: number;
  /** Users who signed in on a later day than they registered. */
  returnedCount: number;
  /** Null for an empty cohort. */
  retentionRate: number | null;
}

/**
 * One entry in the recent-activity feed. Every item is a real recorded event, not a
 * reconstruction — `login` reflects an account's latest sign-in only, since no earlier
 * ones are stored.
 */
export interface ActivityItem {
  /** "signup" | "transcription" | "login" — the client maps this to an icon. */
  kind: string;
  title: string;
  subtitle: string | null;
  /** ISO-8601 UTC instant. */
  occurredAtUtc: string;
}

export interface AnalyticsOverview {
  fromUtc: string;
  toUtc: string;
  /** Offset the server bucketed days in. 60 = West Africa Time. */
  reportingOffsetMinutes: number;
  users: UserMetrics;
  transcriptions: TranscriptionMetrics;
  signupsPerDay: DailyCount[];
  transcriptionsPerDay: DailyCount[];
  signupMethods: CategoryCount[];
  devicePlatforms: CategoryCount[];
  topKeys: CategoryCount[];
  retention: RetentionCohort[];
  recentActivity: ActivityItem[];
}

export interface AdminUserRow {
  id: string;
  fullName: string;
  email: string;
  role: string;
  isActive: boolean;
  hasGoogle: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  transcriptionCount: number;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}
