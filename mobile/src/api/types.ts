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
}

export interface TranscriptionJob {
  jobId: string;
  status: TranscriptionStatus;
  progress: number;
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
}

// --- API errors ---------------------------------------------------------

/** The ApiError envelope every 4xx/5xx carries (ApiError code/message/details). */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}
