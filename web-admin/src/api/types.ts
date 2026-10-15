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
  /** Accounts seen since local midnight (reporting time). */
  activeToday?: number;
}

/** Who is online now and which transcriptions just started (GET /api/admin/analytics/live). */
export interface LiveUser {
  id: string;
  fullName: string;
  email: string;
  country: string | null;
  seenAtUtc: string;
}
export interface LiveJob {
  jobId: string;
  userId: string | null;
  fullName: string | null;
  email: string | null;
  /** "recording" | "song link" | "song upload" */
  kind: string;
  /** A free preview on the website: no account, so no name. */
  preview: boolean;
  finished: boolean;
  startedAtUtc: string;
}
/** A payment that went through in the last few minutes (Verified or Completed). */
export interface LivePayment {
  id: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  amountMinor: number;
  currency: string;
  planName: string;
  paidAtUtc: string;
}
export interface LiveActivity {
  serverTimeUtc: string;
  online: LiveUser[];
  transcribing: LiveJob[];
  /** Absent from an API older than the cash-register alert. */
  payments?: LivePayment[];
}

export interface TranscriptionMetrics {
  totalSaved: number;
  totalSavedPrevious: number;
  /** Transcriptions that produced a result in the window, saved or not. */
  totalTranscribed: number;
  totalTranscribedPrevious: number;
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
  /** "signup" | "transcription" | "transcription_failed" | "payment" | "feedback" | "share". */
  kind: string;
  title: string;
  subtitle: string | null;
  /** ISO-8601 UTC instant. */
  occurredAtUtc: string;
  userId?: string | null;
  email?: string | null;
  country?: string | null;
  /** What happened, as a phrase after the name: "transcribed a song link". */
  detail?: string | null;
}

/**
 * The website's acquisition funnel for the window. Every stage is a count of rows the API keeps —
 * preview jobs, accounts stamped with a source, claims, saved sheets, share tokens, subscriptions —
 * so each number traces to a table rather than to an event stream that does not exist.
 */
export interface WebFunnel {
  previews: number;
  previewsPrevious: number;
  /** Distinct browsers that previewed; a floor on visitors who tried it. */
  previewDevices: number;
  previewsSucceeded: number;
  webSignups: number;
  webSignupsPrevious: number;
  /** Web sign-ups that claimed a preview — the ones the try-it-free box earned. */
  signupsFromPreview: number;
  webSignupsWhoSaved: number;
  sharesCreated: number;
  /** Opens of public links, all time: the API keeps a counter per sheet, not a view log. */
  shareViews: number;
  /** Subscriptions started in the window by accounts that signed up on the web. */
  webProConversions: number;
  previewsPerDay: DailyCount[];
}

/** One action a signed-in web account took, for the "what web users do" feed. */
export interface WebActionItem {
  userId: string;
  fullName: string;
  email: string;
  /** The action's name as the web app reported it, e.g. "Saved sheet". */
  action: string;
  /** The page it happened on. */
  path: string;
  occurredAtUtc: string;
}

/**
 * What the website's own tracker recorded for the window: page views, visitors, clicks and the
 * actions taken in the web app. Every figure is a count over `web_events` rows, which the browser
 * posts in batches to `POST api/web/events`.
 */
export interface WebTraffic {
  pageviews: number;
  pageviewsPrevious: number;
  /** Distinct browsers (the tracker's random visitor id) that viewed a page. */
  visitors: number;
  visitorsPrevious: number;
  /** Distinct tab sessions that viewed a page. */
  sessions: number;
  /** Links and buttons clicked. */
  clicks: number;
  /** Clicks on anything that leads to the sign-up form. */
  signupClicks: number;
  /** Named actions taken in the web app, signed in or as a guest. */
  actions: number;
  /** Distinct accounts that took at least one action in the web app. */
  activeWebUsers: number;
  pageviewsPerDay: DailyCount[];
  topPages: CategoryCount[];
  /** "Direct" when the browser sent no referrer. */
  topReferrers: CategoryCount[];
  topClicks: CategoryCount[];
  /** Page views by device: Mobile or Desktop, from the viewport width. */
  devices: CategoryCount[];
  topActions: CategoryCount[];
  /** The newest actions by signed-in accounts, newest first. */
  recentActions: WebActionItem[];
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
  /** Accounts by the client that created them: Web, Mobile, or Unknown (older accounts). */
  signupSources: CategoryCount[];
  webFunnel: WebFunnel;
  /** Page views, visitors, clicks and web-app actions from the site's own tracker. */
  webTraffic: WebTraffic;
  /** Who has Pro now, what came in and went out in the window, and how songs are used. */
  membership: Membership;
}

/** An amount in one currency's minor units. Currencies are never added together. */
export interface CurrencyAmount {
  currency: string;
  amountMinor: number;
}

/**
 * Pro membership. Every payment is a one-off for one period, so `monthlyRunRate` is what the running
 * memberships are worth per month (yearly at a twelfth), not a charge that will happen by itself.
 */
export interface Membership {
  activeMembers: number;
  paidMembers: number;
  giftedMembers: number;
  /** Of the active members, how many hold lifetime access. */
  lifetimeMembers: number;
  newMembers: number;
  /** Memberships whose paid time ran out in the window without a new payment. */
  lapsedMembers: number;
  revenue: CurrencyAmount[];
  monthlyRunRate: CurrencyAmount[];
  membersByPlan: CategoryCount[];
  songsUsedThisMonth: number;
  /** Accounts that have used the whole monthly song allowance. */
  membersOutOfSongs: number;
  /**
   * Choirs whose plan is running. Each is one paid member (its director) in the counts above, in
   * `membersByPlan` under the choir plan's name, and in the run-rate at the choir plan's price, once.
   */
  activeChoirs: number;
  /** Singers in those choirs: Pro through a seat, so not counted as members above. */
  choirSingers: number;
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
  /** The last signed-in request (or the last sign-in, for accounts not seen since presence was recorded). */
  lastSeenAtUtc?: string | null;
  /** Seen within the last five minutes, decided by the API. */
  isOnline?: boolean;
  /** An admin or a team/test account; listed only when the team is asked for. */
  isInternal?: boolean;
  country: string | null;
  /** Every transcription that produced a result, saved or not (finished jobs, claimed previews, older saved sheets). */
  transcriptionCount: number;
  /** Sheets in the library now. */
  savedTranscriptionCount: number;
  /** Transcriptions that ended without a result. */
  failedTranscriptionCount: number;
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
  /** A team or test account, left out of analytics (admins always are). */
  isInternal?: boolean;
  lastSeenAtUtc?: string | null;
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
  /** Every transcription that produced a result, saved or not (finished jobs, claimed previews, older saved sheets). */
  transcriptionCount: number;
  /** Sheets in the library now. */
  savedTranscriptionCount: number;
  /** Transcriptions that ended without a result. */
  failedTranscriptionCount: number;
  /** Free ones this account was charged (bought ones are counted apart). */
  trialGenerationsUsed: number;
  trialGenerationsTotal: number;
  /** One-song purchases spent or held by a running job, and fulfilled ever. */
  boughtTranscriptionsUsed: number;
  boughtTranscriptionsTotal: number;
  /** The free one-minute link preview, if this account was charged it. */
  songPreviewsUsed: number;
  /** Jobs that spent an allowance (free, bought, Pro song or the link preview): the number to compare with the quota. */
  chargedTranscriptionCount: number;
  /** The inbox the address delivers to (aliases such as you+1@gmail.com share one). Absent from older APIs. */
  canonicalEmail?: string | null;
  /** Other accounts on the same inbox, which share this account's free transcriptions. */
  sharedMailboxAccounts?: number;
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

/**
 * Saved sheets' dohs against the engine's, over the last `days` (C# KeyCorrectionsDto, counts only):
 * how many had the doh changed, how many were offered other dohs, and how many of the changed ones
 * kept one of those.
 */
export interface KeyCorrections {
  days: number;
  sheets: number;
  dohChanged: number;
  offered: number;
  changedToAnOfferedDoh: number;
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

/* ── Activity: transcription log, journeys, checkout funnel ───────────────── */

export type TranscriptionLogStatus = "submitted" | "refused" | "done" | "failed";

/** One transcription asked for, saved or not (C# TranscriptionLogRowDto). */
export interface TranscriptionLogRow {
  id: string;
  jobId: string | null;
  createdAtUtc: string;
  /** "account" or "preview" (the website's anonymous try-it-free). */
  origin: string;
  /** "web", "app" or "unknown". */
  client: string;
  /** "upload", "song", "score" or "link". */
  kind: string;
  mode: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  linkUrl: string | null;
  songTitle: string | null;
  songArtist: string | null;
  keyRequested: string | null;
  tempoRequested: number | null;
  timeSignatureRequested: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  status: TranscriptionLogStatus;
  failureReason: string | null;
  finishedAtUtc: string | null;
  audioSeconds: number | null;
  detectedKey: string | null;
  detectedTempo: number | null;
  noteCount: number | null;
  confidence: number | null;
  usedStorePreview: boolean;
  saved: boolean;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  deviceHash: string | null;
}

export interface TranscriptionLogSummary {
  total: number;
  done: number;
  failed: number;
  refused: number;
  running: number;
  saved: number;
  storePreviews: number;
  totalBytes: number;
}

export interface TranscriptionLogPage {
  page: PagedResult<TranscriptionLogRow>;
  summary: TranscriptionLogSummary;
}

export interface TranscriptionLogFilters {
  search?: string | undefined;
  origin?: string | undefined;
  kind?: string | undefined;
  status?: string | undefined;
  client?: string | undefined;
  saved?: boolean | undefined;
  userId?: string | undefined;
  device?: string | undefined;
}

export type JourneyItemType = "pageview" | "click" | "action" | "transcription" | "payment" | "signup";

export interface JourneyItem {
  atUtc: string;
  type: JourneyItemType;
  title: string;
  detail: string | null;
  path: string | null;
  sessionId: string | null;
  device: string | null;
  tone: "ok" | "warn" | "error";
  refId: string | null;
}

export interface Journey {
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  fromUtc: string;
  toUtc: string;
  visitorIds: string[];
  deviceHashes: string[];
  /** For a device or browser: the accounts it has been seen signed in as. */
  otherAccounts: string[];
  sessions: number;
  pageviews: number;
  transcriptions: number;
  payments: number;
  truncated: boolean;
  items: JourneyItem[];
}

export interface JourneySubject {
  userId?: string | undefined;
  device?: string | undefined;
  visitor?: string | undefined;
}

export interface CheckoutStep {
  step: string;
  description: string;
  sessions: number;
  events: number;
}

export interface CheckoutProblem {
  atUtc: string;
  /** "browser" (the tracker's report) or "provider" (a failed payment row). */
  source: string;
  problem: string;
  detail: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  visitorId: string | null;
  reference: string | null;
}

export interface CheckoutFunnel {
  fromUtc: string;
  toUtc: string;
  steps: CheckoutStep[];
  errorCodes: CategoryCount[];
  paymentsByStatus: CategoryCount[];
  paymentsByProvider: CategoryCount[];
  failureReasons: CategoryCount[];
  pageErrors: CategoryCount[];
  recentProblems: CheckoutProblem[];
}

export type FeedKind = "signup" | "login" | "transcription" | "saved" | "payment" | "action";

/** One entry in the full user activity feed (C# FeedItemDto). */
export interface FeedItem {
  atUtc: string;
  kind: FeedKind;
  title: string;
  detail: string | null;
  tone: "ok" | "warn" | "error";
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  country: string | null;
}

/* ── Engagement and feedback ─────────────────────────────────────────────── */

export interface EngagedUser {
  userId: string;
  fullName: string;
  email: string;
  country: string | null;
  isPro: boolean;
  transcriptions: number;
  saved: number;
  activeDays: number;
  webSessions: number;
  lastActiveUtc: string;
  /** Transcriptions ×3 + active days ×2 + saved sheets: the leaderboard's order. */
  score: number;
  /** Of those transcriptions, the ones that spent an allowance (free, bought, Pro song or the link preview). */
  charged: number;
}

export interface Engagement {
  fromUtc: string;
  toUtc: string;
  activeUsers: number;
  newActiveUsers: number;
  returningActiveUsers: number;
  dau: number;
  wau: number;
  mau: number;
  averageDau: number;
  /** Average DAU over MAU, 0–1. */
  stickiness: number | null;
  dailyActiveUsers: DailyCount[];
  topUsers: EngagedUser[];
  usersByTranscriptions: CategoryCount[];
  transcriptionsByHour: CategoryCount[];
  transcriptionsByWeekday: CategoryCount[];
  transcriptionsByClient: CategoryCount[];
  transcriptionsByKind: CategoryCount[];
}

export type FeedbackKind = "feedback" | "rating" | "rating_dismissed" | "heard_about" | "transcription";

export interface FeedbackRow {
  id: string;
  createdAtUtc: string;
  kind: FeedbackKind;
  rating: number | null;
  /** A feedback message's category, what was off about a transcription, or the "heard about us" source. */
  category: string | null;
  message: string | null;
  client: string;
  appVersion: string | null;
  screen: string | null;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  /** The transcription job a "transcription" verdict is about. */
  jobId?: string | null;
}

export interface FeedbackSummary {
  averageRating: number | null;
  ratings: number;
  dismissals: number;
  /** "5" down to "1". */
  ratingDistribution: CategoryCount[];
  heardAboutAnswers: number;
  heardAbout: CategoryCount[];
  feedbackMessages: number;
  feedbackByCategory: CategoryCount[];
  /** Verdicts asked under every result: "spot on", "close", "off". */
  transcriptionVerdicts?: number;
  transcriptionDistribution?: CategoryCount[] | null;
  /** What was off, for "close" and "off" verdicts that said. */
  transcriptionIssues?: CategoryCount[] | null;
}

/* ── Insights (GET /api/admin/analytics/insights) ───────────────────────── */
export interface InsightsKpis {
  accounts: number;
  newAccounts: number;
  activeAccounts: number;
  transcriptions: number;
  paidConversions: number;
  medianSessionMinutes: number | null;
  medianMinutesToFirstTranscription: number | null;
  successRate: number | null;
}
export interface DailyActive { date: string; new: number; returning: number }
export interface DailySignups { date: string; web: number; app: number }
export interface DailyTranscriptions { date: string; recording: number; songLink: number; songUpload: number; preview: number; failed: number }
export interface CountryRow { country: string; accounts: number; active: number; transcriptions: number; pro: number }
export interface FunnelStep { step: string; count: number }
export interface HeatCell { weekday: number; hour: number; count: number }
export interface RetentionRow { cohortStart: string; size: number; weeks: (number | null)[] }
export interface JobDuration { kind: string; count: number; medianSeconds: number | null; p90Seconds: number | null }
export interface Insights {
  fromUtc: string;
  toUtc: string;
  reportingOffsetMinutes: number;
  filters: { countries: CategoryCount[]; country: string | null; platform: string | null; plan: string | null };
  kpis: InsightsKpis;
  dailyActive: DailyActive[];
  dailySignups: DailySignups[];
  dailyTranscriptions: DailyTranscriptions[];
  countries: CountryRow[];
  funnel: FunnelStep[];
  sessionLengths: CategoryCount[];
  timeToFirstTranscription: CategoryCount[];
  heatmap: HeatCell[];
  retention: RetentionRow[];
  jobDurations: JobDuration[];
}
