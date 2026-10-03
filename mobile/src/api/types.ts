/** Types mirroring the C# Web API's JSON wire contract (src/NoteFusion.* DTOs). */

// --- Auth ---------------------------------------------------------------

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * All that registration returns — deliberately no tokens. The account is not usable
 * until the emailed code is entered, and `verify-email` is what issues the session.
 *
 * The email comes back rather than being reused from the form because the server
 * normalises it (trimmed, lower-cased), and the verify call has to send the string
 * the row is actually keyed on.
 */
export interface RegistrationResponse {
  email: string;
}

export interface MyProfile {
  id: string;
  fullName: string;
  email: string;
  role: string;
  profilePictureUrl: string | null;
  /** False for Google-only accounts, which never set a password. */
  hasPassword: boolean;
  createdAt: string;
}

// --- Transcriptions -----------------------------------------------------

export type TranscriptionStatus = "pending" | "processing" | "done" | "failed";

export interface NoteEvent {
  pitchMidi: number;
  startBeat: number;
  durBeats: number;
  degree: number;
  solfa: string;
  octaveMark: string;
  conf: number;
}

/** The song a linked transcription came from — the acknowledgement line and the sheet's credit. */
export interface TranscriptionSource {
  provider: "youtube" | "spotify" | "apple_music" | string;
  url: string;
  title: string;
  artist: string;
  thumbnailUrl?: string | null;
}

export interface TranscriptionResult {
  key: string;
  keyConfidence: number;
  tempo: number;
  timeSignature: string;
  musicXml: string;
  midiBase64: string;
  notes: NoteEvent[];
  solfaLines: string[];
  overallConfidence: number;
  /**
   * Where beat 0 falls in the source audio, in seconds. With `backingAudioBase64` it is
   * what lets the notated melody play over the song's own backing in time: the audio
   * time of beat b is beatOriginSec + b * 60 / tempo. Mirrors the C# DTO.
   */
  beatOriginSec?: number;
  /** Separated jobs only: the instrumental (mix minus the isolated vocal) as a small mono MP3. */
  backingAudioBase64?: string;
  /** Chromatic spelling convention used by the worker; old results default to direction. */
  chromaticSpelling?: "direction" | "ascending" | "descending";
  /**
   * Base64-encoded 16-bit PCM WAV audio preview synthesised server-side from
   * the note list (numpy + soundfile — no system audio libraries required).
   * Empty string when synthesis produced no output.
   * Written to a cache file with expo-file-system and played via expo-av.
   */
  audioPreviewBase64?: string;
  /**
   * False when the worker skipped its pyin refinement stage. No longer reachable
   * by recording a long clip: the worker's pyin budget now equals the duration it
   * accepts (180 s, which MAX_RECORD_SEC in RecordScreen mirrors), so the two
   * remaining causes are a failed decode and a clip with no voiced frame at all.
   *
   * Worth surfacing rather than swallowing: with that stage dark, the worker's
   * accuracy corpus records spurious accidentals rising from 1.53 to 3.53 per
   * clip, which is exactly the "accidentals where not needed" complaint. Show
   * the notation with a caveat, not instead of it. Optional and defaulting to
   * refined, so an older API build never displays a false warning.
   */
  pitchRefined?: boolean;
  /** Linked songs only: where the song came from. */
  source?: TranscriptionSource | null;
  /** Linked songs only: the whole song's length, which may exceed what was transcribed. */
  songDurationSec?: number;
  /** True when only the first part of the song was transcribed (free preview, or past the Pro cap). */
  truncated?: boolean;
  /** True when the vocals were isolated from the mix before transcription. */
  separated?: boolean;
  /** Four-part harmony under the melody (soprano, alto, tenor, bass). Pro only; absent otherwise. */
  parts?: Record<"soprano" | "alto" | "tenor" | "bass", TranscriptionPart> | null;
  /** The four parts as one MusicXML score. Pro only. */
  partsMusicXml?: string;
  /** "heard" when the parts were transcribed from a choir recording, "written" when arranged on request. */
  partsSource?: "heard" | "written" | null;
  /** The words under the solfa; empty until the user types them. Saved items only. */
  lyrics?: string;
  /** The public link's token when the saved sheet is shared; null or absent otherwise. */
  shareToken?: string | null;
}

/** What the API hands back for a transposed sheet (saved or not): the moved notes, labelled. */
export interface TransposedSheet {
  key: string;
  notes: NoteEvent[];
  musicXml: string;
  parts?: Record<string, TranscriptionPart> | null;
  partsMusicXml?: string | null;
}

/** Alto, tenor and bass written under a tune on request (Pro): the four parts and their one score. */
export interface HarmonisedSheet {
  parts: Record<string, TranscriptionPart> | null;
  partsMusicXml: string | null;
}

/** The part a take is judged against, in beats, and the count-in that preceded it in the recording. */
export interface GradeTarget {
  notes: { pitchMidi: number; startBeat: number; durBeats: number }[];
  tempoBpm: number;
  leadInSec: number;
}

export type GradeStatus = "hit" | "near" | "wrong" | "missed";

/** One note's verdict: the pitch sung while it was due, in cents off. */
export interface GradeNote {
  index: number;
  targetMidi: number;
  sungMidi: number | null;
  cents: number | null;
  status: GradeStatus;
}

/** How a sung take compared to its part. */
export interface GradeResult {
  score: number;
  hits: number;
  near: number;
  wrong: number;
  missed: number;
  /** The take's overall lean in cents; positive is sharp. */
  tuningCents: number;
  offsetSec: number;
  /** The octave the singer took it in, in semitones; a bass on the tune reads −12 and is not wrong. */
  octaveShift: number;
  summary: string;
  notes: GradeNote[];
}

/** A public link to a saved sheet. */
export interface ShareLink {
  token: string;
  url: string;
}

/** One voice of the four-part harmony, in the same note shape as the melody. */
export interface TranscriptionPart {
  notes: NoteEvent[];
  solfaLines: string[];
}

export type TranscriptionStage = "fetching" | "separating" | "transcribing";

export interface TranscriptionJob {
  jobId: string;
  status: TranscriptionStatus;
  progress: number;
  /** Which step a linked song is on while it runs; absent for an upload. */
  stage?: TranscriptionStage | null;
  /** Known as soon as the link resolves, before `result` exists. */
  source?: TranscriptionSource | null;
  result?: TranscriptionResult | null;
  /**
   * Human-readable failure reason from the Python worker
   * (e.g. "No confident notes detected in the recording").
   * Non-null only when status === 'failed'.
   * Previously this field was absent from the C# DTO so Python error
   * messages were silently dropped and the mobile showed a hardcoded string.
   */
  error?: string | null;
}

// --- Library ------------------------------------------------------------

export interface SavedTranscription {
  id: string;
  title: string;
  key: string;
  tempoBpm: number;
  timeSignature: string;
  overallConfidence: number;
  createdAtUtc: string;
  notes?: NoteEvent[] | null;
  /**
   * MusicXML for export. Detail reads only (GET /api/library/{id}) — the list
   * route omits it so a library page doesn't download every score.
   */
  musicXml?: string | null;
  /** The words under the solfa, as typed. */
  lyrics?: string;
  /** Four-part harmony, labelled for the stored key. Detail reads only. */
  parts?: Record<string, TranscriptionPart> | null;
  partsMusicXml?: string | null;
  /** Set while the sheet is behind a public link. */
  shareToken?: string | null;
  /** The folder the sheet is filed in ("Sunday choir"), or null. */
  folder?: string | null;
}

// --- Billing ------------------------------------------------------------
// Mirrors src/NoteFusion.Application/Billing/Dtos/BillingDtos.cs. Enums serialize
// as camelCase strings (JsonStringEnumConverter + CamelCase policy in Program.cs).

/**
 * `"lifetime"` is a one-off purchase, not a period — a plan carrying it has no renewal
 * and must never be priced "per month". Which of these a user is offered is decided
 * server-side from the country on their account, so the app renders whatever it is sent
 * rather than choosing.
 */
export type BillingInterval = "monthly" | "yearly" | "lifetime";

export type PaymentProvider = "paystack" | "flutterwave" | "bachs" | "squad";

export type SubscriptionStatus = "active" | "pastDue" | "canceled" | "expired";

/** A plan shown on the paywall. Amount is in the currency's minor units (cents). */
export interface Plan {
  id: string;
  code: string;
  name: string;
  amountMinor: number;
  currency: string;
  interval: BillingInterval;
}

/** Anonymous, location-resolved pricing used by the public website. */
export interface PublicPricing {
  countryCode: string | null;
  plans: Plan[];
}

/**
 * Body of `POST /api/billing/checkout`. `client` is optional; only `"web"`
 * means anything (the browser returns to the website after paying instead of
 * the app), so the app leaves it out.
 */
export interface CheckoutRequest {
  planId: string;
  client?: string;
}

/**
 * A hosted-checkout session. The app opens {@link checkoutUrl} in an external
 * browser (Spotify-style) and never collects card details; the result arrives
 * server-side by webhook, so the app polls my-subscription to learn when Pro unlocks.
 */
export interface CheckoutSession {
  reference: string;
  checkoutUrl: string;
  provider: PaymentProvider;
}

/** The caller's subscription state — the app gates Pro features on this. */
export interface Subscription {
  isActive: boolean;
  planCode: string | null;
  status: SubscriptionStatus | null;
  currentPeriodEndUtc: string | null;
  /**
   * Free transcriptions left. Server-authoritative and counted from successful
   * generations, so it does not go back up when a transcription is deleted.
   * Meaningless while `isActive` — Pro is unmetered.
   */
  trialGenerationsRemaining: number;
  /** The free allowance, so the UI can say "3 of 5" without hardcoding 5. */
  trialGenerationsTotal: number;
  /**
   * Bought outright — there is no renewal date to show and nothing to cancel.
   * `currentPeriodEndUtc` carries a far-future sentinel in this case, so anything
   * that prints a date has to check this first or it shows the year 9999.
   */
  isLifetime: boolean;
  /** Granted by an operator — no payment was taken. */
  isGift?: boolean;
  /** Linked songs left this month on Pro, or free previews left otherwise. */
  songCreditsRemaining?: number;
  /** The allowance `songCreditsRemaining` is measured against. */
  songCreditsTotal?: number;
  /** The plan's display name ("NoteFusion Pro (Monthly)"); null without a subscription. */
  planName?: string | null;
}

// --- App release --------------------------------------------------------

/**
 * What the stores carry, from `GET /api/app/version`. Mirrors `AppVersionDto`.
 *
 * Compare against `Application.nativeBuildVersion` — the **builds**, never the version
 * strings, because `"1.10.0" < "1.9.0"` lexically. Both build numbers are 0 on a server
 * that has not been told about a release, which means "announce nothing, block nobody".
 */
export interface AppVersionInfo {
  latestVersion: string;
  latestBuild: number;
  /** Below this, the app must not be usable. See `lib/appUpdate.ts`. */
  minimumBuild: number;
  releaseNotes: string;
  androidStoreUrl: string;
  iosStoreUrl: string;
  announcement?: { message: string; severity: string } | null;
}

// --- API errors ---------------------------------------------------------

/** The ApiError envelope every 4xx/5xx carries (ApiError code/message/details). */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}

// --- Admin --------------------------------------------------------------
// Mirrors src/NoteFusion.Application/Admin/Dtos/*.cs plus the two admin-only
// records in Analytics/Dtos/AnalyticsDtos.cs. Behind the Admin policy, so nothing
// here is reachable by an ordinary account.
//
// One trap runs through the whole section. Every status, provider and direction
// field below is a plain C# `string` holding the enum member's *name*
// (`t.Status.ToString()`), not a serialized enum — so the values arrive
// PascalCase and the camelCase policy never touches them. Contrast
// {@link PaymentProvider} above, which is a real enum on the client-facing
// billing DTOs and therefore arrives as `"paystack"`. Comparing an admin row's
// `provider` against that union matches nothing, silently. Same reason
// {@link AuthUser.role} is `"Admin"` and not `"admin"`.

/** A page of results plus the total, so a list can say "showing 1–25 of 340". */
export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export type AdminPaymentStatus =
  | "Pending"
  | "Processing"
  | "Verified"
  | "Completed"
  | "Failed";

export type AdminWebhookStatus = "Received" | "Processed" | "Failed";

export type AdminProvider = "Paystack" | "Flutterwave" | "Bachs" | "Squad";

export type AdminLedgerDirection = "Credit" | "Debit";

/**
 * One payment attempt across every account — the row of the reconciliation table.
 *
 * `Verified` is the status to read carefully: the money moved but the ledger entry
 * and subscription have not been written, so that row is a customer who has paid
 * and does not have Pro.
 */
export interface AdminPaymentRow {
  id: string;
  userId: string;
  userEmail: string;
  userFullName: string;
  reference: string;
  providerReference: string | null;
  provider: AdminProvider;
  status: AdminPaymentStatus;
  /** Minor units of `currency` — cents for USD, kobo for NGN. Never a float. */
  amountMinor: number;
  currency: string;
  planName: string | null;
  failureReason: string | null;
  /** Still `Processing` past the grace window — what the background sweep picks up. */
  isStuck: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
}

/**
 * One payment in full. `initiateRaw`/`verifyRaw` are the provider's own words —
 * the evidence in a dispute — and this is the only route that returns them.
 */
export interface AdminPaymentDetail {
  payment: AdminPaymentRow;
  idempotencyKey: string;
  checkoutUrl: string | null;
  initiateRaw: string | null;
  verifyRaw: string | null;
  ledger: AdminLedgerEntry[];
  webhookEvents: AdminWebhookEventRow[];
}

/**
 * One row of the webhook inbox. A `Failed` row does not mean the customer lost
 * their subscription — reconciling the payment recovers that independently — it
 * means nobody has looked at why the callback would not drain.
 */
export interface AdminWebhookEventRow {
  id: string;
  provider: AdminProvider;
  providerEventId: string;
  eventType: string;
  paymentReference: string | null;
  /** Null when the payload carried no reference of ours, or named a dead one. */
  paymentTransactionId: string | null;
  status: AdminWebhookStatus;
  processAttempts: number;
  lastError: string | null;
  receivedAtUtc: string;
  lastAttemptAtUtc: string | null;
  processedAtUtc: string | null;
}

/** One inbox row plus the request body it stored — what explains a parked event. */
export interface AdminWebhookEventDetail {
  event: AdminWebhookEventRow;
  payload: string;
}

/** One immutable ledger movement inside a single account's history. */
export interface AdminLedgerEntry {
  id: string;
  direction: AdminLedgerDirection;
  reason: string;
  amountMinor: number;
  currency: string;
  description: string;
  createdAtUtc: string;
}

/** The same movement in the cross-account list, which has to name its owner. */
export interface AdminLedgerRow {
  id: string;
  userId: string;
  userEmail: string;
  paymentTransactionId: string;
  paymentReference: string | null;
  direction: AdminLedgerDirection;
  reason: string;
  amountMinor: number;
  currency: string;
  description: string;
  createdAtUtc: string;
}

/**
 * The reconciliation snapshot: what state the money is in, and what the workers
 * are about to do about it. One request because the numbers only mean something
 * read against each other — a stuck count needs the window that defines "stuck".
 */
export interface PaymentOpsSummary {
  pendingCount: number;
  processingCount: number;
  /**
   * Paid, but the ledger entry and subscription are missing. The most important
   * number here: every one is a customer who cannot use what they bought, and it
   * is **not** self-healing — the sweep only touches rows still in `Processing`.
   */
  verifiedCount: number;
  completedCount: number;
  failedCount: number;
  /** `Processing` rows older than `graceWindowMinutes` — what the sweep will take. */
  stuckCount: number;
  /** An instant, not an age: an age computed server-side goes stale in transit. */
  oldestStuckSinceUtc: string | null;
  webhooksAwaitingCount: number;
  webhooksProcessedCount: number;
  webhooksFailedCount: number;
  oldestAwaitingWebhookAtUtc: string | null;
  /** Money in. Gifts are absent by design: no payment, no ledger entry. */
  creditedMinor: number;
  /** Money out. */
  refundedMinor: number;
  /** Credits minus debits, summed from the entries rather than stored anywhere. */
  netMinor: number;
  currency: string;
  graceWindowMinutes: number;
  sweepIntervalMinutes: number;
  mrrMinor: number;
  activeSubscribersCount: number;
  expiringInSevenDaysCount: number;
}

/**
 * What an operator-triggered reconciliation actually did. The command is
 * idempotent and answers "nothing to do" with success, so `changed` is the
 * difference between "the provider confirmed it" and "this was already settled".
 */
export interface AdminReconcileResult {
  paymentTransactionId: string;
  previousStatus: AdminPaymentStatus;
  status: AdminPaymentStatus;
  changed: boolean;
  /** A sentence written for the operator, ready to show as-is. */
  outcome: string;
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

/** One tier of the health page, or the whole page's rolled-up verdict. */
export interface HealthPanel {
  name: string;
  status: string;
  latencyMs: number | null;
  detail: string | null;
}

export interface SystemHealth {
  status: string;
  checkedAtUtc: string;
  database: HealthPanel;
  transcriptionWorker: HealthPanel;
  webhookBacklog: HealthPanel;
  activity: { jobsLast24Hours: number; jobsLast7Days: number };
  subscriptions: {
    activeCount: number;
    giftedCount: number;
    expiringWithinSevenDays: number;
    pastDueCount: number;
  };
  /** Tiers this stack cannot prove anything about, named rather than faked. */
  notMonitored: string[];
  workerHeartbeats?: WorkerHeartbeat[];
}

/** One row of the admin user table — enough for a support conversation, no more. */
export interface AdminUserRow {
  id: string;
  fullName: string;
  email: string;
  profilePictureUrl: string | null;
  role: string;
  isActive: boolean;
  hasGoogle: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  transcriptionCount: number;
  /** Computed server-side; a client that recomputes it eventually disagrees. */
  hasProAccess: boolean;
  /** Only meaningful while `hasProAccess` — false is not "they paid". */
  isGiftedPro: boolean;
}

export interface AdminSubscription {
  id: string;
  planCode: string | null;
  planName: string | null;
  status: string;
  isActive: boolean;
  isGift: boolean;
  isLifetime: boolean;
  provider: string | null;
  currentPeriodStartUtc: string;
  /** Null for lifetime — the column holds a year-9999 sentinel a client would print. */
  currentPeriodEndUtc: string | null;
  canceledAtUtc: string | null;
  createdAtUtc: string;
}

/** One payment attempt inside a single account's page, which needs no owner. */
export interface AdminPayment {
  id: string;
  reference: string;
  providerReference: string | null;
  provider: AdminProvider;
  status: AdminPaymentStatus;
  amountMinor: number;
  currency: string;
  planName: string | null;
  failureReason: string | null;
  createdAtUtc: string;
}

/** One line of the audit trail. Emails come from stored snapshots, not a join. */
export interface AuditLogRow {
  id: string;
  actorUserId: string;
  actorEmail: string;
  /** The enum member's name, e.g. "GiftPro". */
  action: string;
  targetUserId: string | null;
  targetEmail: string | null;
  ipAddress: string | null;
  summary: string;
  note: string | null;
  occurredAtUtc: string;
}

/** Everything the console shows about one account. The most personal payload. */
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
  /** When a failed-login lockout lifts. Usually the real cause of "I can't log in". */
  lockoutEndAt: string | null;
  transcriptionCount: number;
  trialGenerationsUsed: number;
  trialGenerationsTotal: number;
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

export interface SystemAnnouncement {
  id: string;
  message: string;
  severity: "info" | "warning" | "critical";
  isActive: boolean;
  expiresAtUtc: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

