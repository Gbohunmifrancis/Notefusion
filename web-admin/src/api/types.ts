/**
 * Wire types for the admin API.
 *
 * These mirror the C# DTOs exactly (`src/NoteFusion.Application/Analytics/Dtos/AnalyticsDtos.cs`,
 * `Admin/Dtos/AdminDtos.cs`, `Admin/Dtos/PaymentOpsDtos.cs`, `Admin/Dtos/SystemHealthDtos.cs` and
 * `Auth/Dtos/AuthResponses.cs`). The wire contract is camelCase. Change one side and change the
 * other in the same commit.
 *
 * **Enum casing is not uniform, and the difference is load-bearing.** `Program.cs` registers a
 * `JsonStringEnumConverter(JsonNamingPolicy.CamelCase)`, so a property whose C# type is an enum
 * travels as camelCase — that is every enum this client *sends* (`"monthly"`, `"admin"`). But the
 * DTOs above declare their enum-ish fields as `string` and fill them with `.ToString()`, which the
 * converter never sees, so everything this client *receives* is PascalCase (`"Active"`,
 * `"Completed"`, `"GiftPro"`). The health statuses are the exception: they are hand-written
 * lowercase literals, not `.ToString()` output.
 *
 * The overview payload still carries no subscribed / paid / free-tier counters. Not for want of a
 * schema — the billing tables exist — but because those are windowed counters and a subscription
 * count belongs to an instant. The live figures are on the health payload, stated as a snapshot.
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

/**
 * `MyProfileDto` from `GET /api/me` — the signed-in operator's own account.
 *
 * The console reads it for one thing: the avatar the shell shows. `AuthUser` above cannot carry
 * the picture, because it is the mobile client's login payload too.
 */
export interface MyProfile {
  id: string;
  fullName: string;
  email: string;
  role: string;
  profilePictureUrl: string | null;
  hasPassword: boolean;
  createdAt: string;
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
  /** The account's avatar, or null when it has none — the console draws initials instead. */
  profilePictureUrl: string | null;
  role: string;
  isActive: boolean;
  hasGoogle: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  transcriptionCount: number;
  /** Pro unlocked right now, decided server-side by status and period window together. */
  hasProAccess: boolean;
  /**
   * That access came from an operator's grant. Only meaningful while `hasProAccess` is true —
   * false on an account with no access at all, which is not the same claim as "they paid".
   */
  isGiftedPro: boolean;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/* ── Admin operations ─────────────────────────────────────────────────────── */

/**
 * `AdminAuditAction` as its C# member name — PascalCase, because the DTO field is a string filled
 * by `.ToString()`. This is also the value the audit-log filter sends back up: MVC binds
 * query-string enums case-insensitively, so the same literal works in both directions.
 */
export type AuditAction =
  | "GiftPro"
  | "RevokePro"
  | "ExtendSubscription"
  | "EndSubscription"
  | "SuspendUser"
  | "ReactivateUser"
  | "CreateUser"
  | "SendPasswordReset"
  | "ChangeRole"
  | "ReconcilePayment"
  | "SendEmail"
  | "ResetTrialQuota"
  | "SetAnnouncement";

/**
 * One line of the audit trail. The emails are stored snapshots rather than joins, so a row still
 * names its actor after that admin's account is gone.
 */
export interface AuditLogRow {
  id: string;
  actorUserId: string;
  actorEmail: string;
  action: AuditAction;
  targetUserId: string | null;
  targetEmail: string | null;
  /** Null when the address could not be established. Render "—", never a loopback. */
  ipAddress: string | null;
  /** The sentence the handler wrote when it performed the action. */
  summary: string;
  /** The operator's own reason, when they gave one. */
  note: string | null;
  occurredAtUtc: string;
}

/** `SubscriptionStatus.ToString()`. */
export type SubscriptionStatus = "Active" | "PastDue" | "Canceled" | "Expired";

/** `PaymentProvider.ToString()`. Null on a gift, because no gateway was involved. */
export type PaymentProviderName = "Paystack" | "Flutterwave" | "Bachs" | "Squad";

export interface AdminSubscription {
  id: string;
  planCode: string | null;
  planName: string | null;
  status: SubscriptionStatus;
  /** Pro unlocked right now: status and period window read together, computed by the API. */
  isActive: boolean;
  isGift: boolean;
  isLifetime: boolean;
  provider: PaymentProviderName | null;
  currentPeriodStartUtc: string;
  /** Null for lifetime access — the column holds a far-future sentinel the client must not print. */
  currentPeriodEndUtc: string | null;
  canceledAtUtc: string | null;
  createdAtUtc: string;
}

/** `PaymentStatus.ToString()`. Attempts are kept, so failures appear here too. */
export type PaymentStatus =
  | "Pending"
  | "Processing"
  | "Verified"
  | "Completed"
  | "Failed";

export interface AdminPayment {
  id: string;
  reference: string;
  providerReference: string | null;
  provider: PaymentProviderName;
  status: PaymentStatus;
  /** Minor units of `currency` — kobo for NGN, cents for USD. */
  amountMinor: number;
  currency: string;
  planName: string | null;
  failureReason: string | null;
  createdAtUtc: string;
}

/** `LedgerDirection.ToString()`. Carries the sign; the stored amount is always positive. */
export type LedgerDirection = "Credit" | "Debit";

/** `LedgerEntryReason.ToString()`. */
export type LedgerReason = "SubscriptionCharge" | "Refund";

export interface AdminLedgerEntry {
  id: string;
  direction: LedgerDirection;
  reason: LedgerReason;
  amountMinor: number;
  currency: string;
  description: string;
  createdAtUtc: string;
}

/**
 * Everything the console shows about one account. The three histories are capped at 20 rows each,
 * newest first — a support view, not an export.
 */
export interface AdminUserDetail {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  profilePictureUrl: string | null;
  role: string;
  isActive: boolean;
  hasGoogle: boolean;
  hasPassword: boolean;
  country: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  /**
   * When a failed-login lockout lifts, or null when there is none. Distinct from suspension: both
   * stop a sign-in and they are fixed differently.
   */
  lockoutEndAt: string | null;
  transcriptionCount: number;
  trialGenerationsUsed: number;
  trialGenerationsTotal: number;
  /** Null when the account has never had one, gifted or paid. */
  subscription: AdminSubscription | null;
  payments: AdminPayment[];
  ledger: AdminLedgerEntry[];
  recentActions: AuditLogRow[];
  recentTranscriptions?: AdminTranscriptionSummary[];
}

export interface AdminTranscriptionSummary {
  id: string;
  title: string;
  key: string;
  tempoBpm: number;
  overallConfidence: number;
  status: string;
  createdAtUtc: string;
}

export interface AdminTranscriptionRow {
  id: string;
  userId: string;
  userEmail: string;
  title: string;
  key: string;
  tempoBpm: number;
  timeSignature: string;
  overallConfidence: number;
  status: string;
  createdAtUtc: string;
}

/* ── Payments & reconciliation ────────────────────────────────────────────── */

/** `WebhookStatus.ToString()` — the inbox row's processing state, not the payment's. */
export type WebhookStatus = "Received" | "Processed" | "Failed";

/**
 * One payment attempt as the reconciliation table lists it: every account's attempts in one list,
 * where `AdminPayment` above is the same row inside a single account's page.
 *
 * The email and name ride on the row because the question this table answers is "whose payment is
 * stuck", which a user id cannot answer without a request per line. Both are `""` when the account
 * has since been deleted — no foreign key ties a payment to a user, so the row outlives it.
 */
export interface AdminPaymentRow {
  id: string;
  userId: string;
  userEmail: string;
  userFullName: string;
  reference: string;
  providerReference: string | null;
  provider: PaymentProviderName;
  status: PaymentStatus;
  /** Minor units of `currency` — cents for USD, kobo for NGN. */
  amountMinor: number;
  currency: string;
  planName: string | null;
  failureReason: string | null;
  /**
   * Still `Processing` past the grace window — exactly what the background sweep picks up. Computed
   * server-side from the same window the worker reads, so the page cannot disagree with it.
   */
  isStuck: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
}

/**
 * One payment in full. `initiateRaw` / `verifyRaw` are the gateway's own words — the evidence in a
 * dispute — and this is the only route that returns them.
 */
export interface AdminPaymentDetail {
  payment: AdminPaymentRow;
  /** Two rows sharing this key are one initiation retried, not two charges. */
  idempotencyKey: string;
  checkoutUrl: string | null;
  initiateRaw: string | null;
  verifyRaw: string | null;
  ledger: AdminLedgerEntry[];
  webhookEvents: AdminWebhookEventRow[];
}

/**
 * One row of the webhook inbox — the record that makes provider callbacks exactly-once. The payload
 * is deliberately absent: it is a whole request body per line. Fetch one event to read it.
 */
export interface AdminWebhookEventRow {
  id: string;
  provider: PaymentProviderName;
  providerEventId: string;
  eventType: string;
  paymentReference: string | null;
  /** Resolved from the reference. Null when the callback named nothing of ours. */
  paymentTransactionId: string | null;
  status: WebhookStatus;
  processAttempts: number;
  lastError: string | null;
  receivedAtUtc: string;
  lastAttemptAtUtc: string | null;
  processedAtUtc: string | null;
}

export interface AdminWebhookEventDetail {
  event: AdminWebhookEventRow;
  /** The provider's request body, verbatim — the field that explains a parked event. */
  payload: string;
}

/** One ledger movement across all accounts. `AdminLedgerEntry` is the same row within one account. */
export interface AdminLedgerRow {
  id: string;
  userId: string;
  userEmail: string;
  paymentTransactionId: string;
  paymentReference: string | null;
  direction: LedgerDirection;
  reason: LedgerReason;
  amountMinor: number;
  currency: string;
  description: string;
  createdAtUtc: string;
}

/**
 * The reconciliation snapshot: what state the money is in, and what the workers will do about it.
 *
 * `graceWindowMinutes` and `sweepIntervalMinutes` come down with the counts so the page can say
 * what "overdue" means instead of printing a number the reader has to take on trust.
 */
export interface PaymentOpsSummary {
  pendingCount: number;
  processingCount: number;
  /**
   * Money moved, entitlement never written. Should be zero, and it does not self-heal —
   * reconciliation only acts on `Processing`, so a row parked here needs a developer.
   */
  verifiedCount: number;
  completedCount: number;
  failedCount: number;
  /** `Processing` rows past the grace window — what the sweep would pick up right now. */
  stuckCount: number;
  /** When the oldest stuck payment was last touched. An instant, not an age: this page caches. */
  oldestStuckSinceUtc: string | null;
  webhooksAwaitingCount: number;
  webhooksProcessedCount: number;
  webhooksFailedCount: number;
  oldestAwaitingWebhookAtUtc: string | null;
  /** Money in. Gifts are absent by design: no payment, no entry. */
  creditedMinor: number;
  refundedMinor: number;
  netMinor: number;
  currency: string;
  graceWindowMinutes: number;
  sweepIntervalMinutes: number;
  mrrMinor: number;
  activeSubscribersCount: number;
  expiringInSevenDaysCount: number;
}

export interface ClearStalePaymentsResult {
  clearedPendingCount: number;
  clearedProcessingCount: number;
  fulfilledCount: number;
}

export interface WorkerHeartbeat {
  workerName: string;
  lastRunUtc: string;
  durationMs: number;
  status: string;
  detail: string | null;
}

export interface SystemAnnouncement {
  id: string;
  message: string;
  severity: "info" | "warning" | "critical";
  isActive: boolean;
  expiresAtUtc: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

/**
 * What an operator-triggered reconciliation did. The command is idempotent and reports "nothing to
 * do" as success, so `changed` is the difference between "the provider confirmed it" and "this was
 * already settled" — both successes, and the operator needs to know which.
 */
export interface AdminReconcileResult {
  paymentTransactionId: string;
  previousStatus: PaymentStatus;
  status: PaymentStatus;
  changed: boolean;
  /** A sentence written server-side for the operator, ready to show as-is. */
  outcome: string;
}

/* ── System health ────────────────────────────────────────────────────────── */

/**
 * Lowercase, unlike every other enum-ish field here: these are hand-written literals in
 * `GetSystemHealthQuery`, not `.ToString()` output.
 */
export type HealthStatus = "healthy" | "degraded" | "down";

export interface HealthPanel {
  name: string;
  status: HealthStatus;
  /** Null when the tier is unreachable — a failed probe has no response time. */
  latencyMs: number | null;
  /** The one line an operator needs. Null when there is nothing to say, not "OK". */
  detail: string | null;
}

/** Submissions, not successes — the API never persists a job's outcome. */
export interface ActivityStats {
  jobsLast24Hours: number;
  jobsLast7Days: number;
}

export interface SubscriptionHealth {
  activeCount: number;
  giftedCount: number;
  /** Excludes lifetime access, which never expires. */
  expiringWithinSevenDays: number;
  pastDueCount: number;
}

export interface SystemHealth {
  /** The worst of the three panels: down beats degraded beats healthy. */
  status: HealthStatus;
  checkedAtUtc: string;
  database: HealthPanel;
  transcriptionWorker: HealthPanel;
  webhookBacklog: HealthPanel;
  activity: ActivityStats;
  subscriptions: SubscriptionHealth;
  /**
   * Tiers this stack does not have, each with the reason. Rendered as prose: a panel that reads
   * "—" forever looks like a broken metric rather than an absent tier.
   */
  notMonitored: string[];
  workerHeartbeats?: WorkerHeartbeat[];
}

/* ── Mutation bodies ──────────────────────────────────────────────────────── */

/**
 * `BillingInterval` as the API deserialises it — camelCase, because `GiftBody.Duration` is a real
 * enum and the camelCase converter applies on the way in.
 */
export type GiftDuration = "monthly" | "yearly" | "lifetime";

/** `UserRole`, same rule as `GiftDuration`. */
export type RoleName = "user" | "admin";

export interface AdminWaitlistRow {
  id: string;
  email: string;
  fullName: string | null;
  role: string | null;
  source: string | null;
  createdAtUtc: string;
  isInvited: boolean;
  invitedAtUtc: string | null;
}

// ── Inbox (received emails via Resend inbound route) ────────────────────────────────────────────

export interface InboxEmailSummary {
  id: string;
  subject: string;
  from: string;
  to: string;
  receivedAt: string;
  hasAttachments: boolean;
}

export interface InboxEmailDetail {
  id: string;
  subject: string;
  from: string;
  to: string;
  receivedAt: string;
  htmlBody: string | null;
  textBody: string | null;
  hasAttachments: boolean;
}

export interface InboxAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
}

export interface InboxPage {
  items: InboxEmailSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface WebFunnelMetric {
  event: string;
  count: number;
}

export interface WebFunnel {
  fromUtc: string;
  toUtc: string;
  previewJobs: number;
  completedPreviews: number;
  failedPreviews: number;
  expiredPreviews: number;
  events: WebFunnelMetric[];
}
