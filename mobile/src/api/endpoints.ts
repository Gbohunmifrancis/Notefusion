import { api } from "./client";
import type {
  AdminPaymentDetail,
  AdminPaymentRow,
  AdminReconcileResult,
  AdminTranscriptionRow,
  AdminUserDetail,
  AdminUserRow,
  AdminWebhookEventDetail,
  AdminWebhookEventRow,
  AppVersionInfo,
  BillingInterval,
  CheckoutSession,
  Choir,
  ChoirMember,
  ChoirSheet,
  ChordSymbol,
  ClearStalePaymentsResult,
  GradeResult,
  GradeTarget,
  HarmonisedSheet,
  LinkInfo,
  LoginResponse,
  MyProfile,
  NoteEvent,
  PagedResult,
  PaymentOpsSummary,
  Plan,
  RegistrationResponse,
  SavedTranscription,
  ShareLink,
  SharedSheet,
  Subscription,
  SystemAnnouncement,
  SystemHealth,
  TokenPairResponse,
  TranscriptionJob,
  TranscriptionPart,
  TransposedSheet,
} from "./types";

/** Typed wrappers over the C# Web API endpoints. One function per route. */

export const authApi = {
  /**
   * Creates the account and mails a six-digit code. Returns no session — the caller
   * must send the returned email to `verifyEmail` with the code before there are tokens.
   */
  register: (fullName: string, email: string, password: string) =>
    api
      .post<RegistrationResponse>("/api/auth/register", {
        fullName,
        email,
        password,
        source: "mobile",
      })
      .then((r) => r.data),

  /** Exchanges a sign-up code for the session `register` withheld. */
  verifyEmail: (email: string, code: string) =>
    api
      .post<LoginResponse>("/api/auth/verify-email", { email, code })
      .then((r) => r.data),

  /**
   * Asks for another code. Succeeds whether or not one was actually sent — the server
   * refuses to say whether the address is registered, or whether the 60-second cooldown
   * swallowed the request, so the countdown the user sees is ours to run.
   */
  resendVerification: (email: string) =>
    api
      .post("/api/auth/resend-verification", { email })
      .then(() => undefined),

  login: (email: string, password: string) =>
    api
      .post<LoginResponse>("/api/auth/login", { email, password })
      .then((r) => r.data),

  /**
   * Signs in with a Google ID token. Serves sign-up and sign-in alike — the server
   * creates the account the first time it sees the Google subject.
   */
  google: (idToken: string) =>
    api
      .post<LoginResponse>("/api/auth/google", { idToken })
      .then((r) => r.data),

  logout: (refreshToken: string) =>
    api.post("/api/auth/logout", { refreshToken }).then(() => undefined),

  /** Returns a fresh pair: the server revokes every other session, this one's refresh token included. */
  changePassword: (currentPassword: string, newPassword: string) =>
    api
      .post<TokenPairResponse>("/api/auth/change-password", { currentPassword, newPassword })
      .then((r) => r.data),

  forgotPassword: (email: string) =>
    api.post("/api/auth/forgot-password", { email }).then((r) => r.data),
};

export const meApi = {
  get: () => api.get<MyProfile>("/api/me").then((r) => r.data),
  update: (fullName: string) =>
    api.put<MyProfile>("/api/me", { fullName }).then((r) => r.data),

  /**
   * Uploads a new avatar. Multipart to our own API, which resizes it and forwards it to
   * Cloudflare R2 with server-side credentials — the app never holds a storage key.
   *
   * Same FormData shape and the same Content-Type caveat as transcriptionsApi.submit:
   * let React Native set the header so the multipart boundary is included.
   */
  uploadPicture: (fileUri: string, fileName: string, mimeType: string) => {
    const form = new FormData();
    form.append("image", {
      uri: fileUri,
      name: fileName,
      type: mimeType,
    } as unknown as Blob);

    return api
      .post<MyProfile>("/api/me/picture", form, { timeout: 60_000 })
      .then((r) => r.data);
  },

  /** Clears the avatar; the app falls back to initials. */
  removePicture: () =>
    api.delete<MyProfile>("/api/me/picture").then((r) => r.data),

  /**
   * Closes the account and deletes its library. The server re-checks the proof rather
   * than trusting the access token: pass a password, or — for Google accounts, which
   * have none — a freshly obtained Google ID token.
   */
  remove: (proof: { password: string } | { googleIdToken: string }) =>
    api.delete("/api/me", { data: proof }).then(() => undefined),
};

/** The answers to "where did you hear about us?" the API accepts (UserFeedback.HeardAboutSources). */
export type HeardAboutSource =
  | "friend" | "church" | "whatsapp" | "instagram" | "tiktok" | "youtube"
  | "facebook" | "x" | "google" | "play_store" | "other";

/** Feedback categories the API accepts (UserFeedback.Categories). */
export type FeedbackCategory = "bug" | "idea" | "accuracy" | "payments" | "other";

export interface FeedbackSubmission {
  kind: "feedback" | "rating" | "rating_dismissed" | "heard_about";
  rating?: number;
  category?: FeedbackCategory;
  message?: string;
  source?: HeardAboutSource;
  client?: "app";
  appVersion?: string;
  screen?: string;
}

export const feedbackApi = {
  /** Which prompts are due for this account in the app: the API owns the rules. */
  prompts: () =>
    api
      .get<{ askHeardAbout: boolean; askRating: boolean }>("/api/feedback/prompts", { params: { client: "app" } })
      .then((r) => r.data),
  submit: (body: FeedbackSubmission) => api.post("/api/feedback", body).then(() => undefined),
};

export const devicesApi = {
  /**
   * Registers this handset's push token, and tells the server which build it is running so
   * the update notice only goes to someone genuinely behind. `appBuild` 0 means unknown,
   * which the server reads as "behind" — the right guess for a client too old to report.
   */
  register: (token: string, platform: "ios" | "android" | "web", appBuild = 0) =>
    api.post("/api/devices", { token, platform, appBuild }).then(() => undefined),
  unregister: (token: string) =>
    api.delete("/api/devices", { data: { token } }).then(() => undefined),
};

export const appApi = {
  /**
   * What the stores carry. Anonymous, so it answers before sign-in — the hard block has to
   * work on the login screen too, which is where a user stuck on a broken build ends up.
   */
  version: () => api.get<AppVersionInfo>("/api/app/version").then((r) => r.data),
};

export interface SubmitOptions {
  mode: "melody" | "poly" | "choir" | "chords";
  key?: string;
  tempo?: number;
  /** "Beats in a bar", one of `METERS` (lib/meter.ts); left out when the user is not sure. */
  timeSignature?: string;
  /**
   * The file is a whole song with instruments behind the voice, not a hummed or sung
   * line: the worker isolates the lead vocal first and reads the beat from the full mix.
   * Mirrors `SubmitTranscriptionRequest.Separate` on the API.
   */
  separate?: boolean;
  /**
   * The transpose setting on the player's keyboard, -11 to 11 semitones (e.g. -4 when
   * A shapes sound F). The sheet is written as played. Omitted or 0 when it is off.
   */
  keyboardTranspose?: number;
}

export const transcriptionsApi = {
  /**
   * Upload a captured clip as multipart/form-data; returns the polling job. `onUploadProgress`
   * hears the upload itself, 0..1, so the screen can show a real figure before the server answers.
   */
  submit: (fileUri: string, fileName: string, opts: SubmitOptions, extra?: { onUploadProgress?: (fraction: number) => void }) => {
    const form = new FormData();
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    const mime =
      ext === "mp3"
        ? "audio/mpeg"
        : ext === "wav"
        ? "audio/wav"
        : ext === "mid" || ext === "midi"
        ? "audio/midi"
        : ext === "xml" || ext === "musicxml"
        ? "application/xml"
        : ext === "mxl"
        ? "application/vnd.recordare.musicxml"
        : ext === "abc"
        ? "text/plain"
        : "audio/m4a";
    // React Native's FormData takes a {uri,name,type} blob descriptor.
    form.append("audio", {
      uri: fileUri,
      name: fileName,
      type: mime,
    } as unknown as Blob);
    form.append("mode", opts.mode);
    if (opts.key) form.append("key", opts.key);
    if (opts.tempo != null) form.append("tempo", String(opts.tempo));
    if (opts.timeSignature) form.append("timeSignature", opts.timeSignature);
    if (opts.separate) form.append("separate", "true");
    if (opts.keyboardTranspose) form.append("keyboardTranspose", String(opts.keyboardTranspose));
    // The app plays results with its own sampled piano, so the worker's rendered preview is never used.
    form.append("audioPreview", "false");

    // Do NOT set Content-Type manually here.
    // React Native's XHR layer auto-inserts the multipart boundary when the body is
    // a FormData object (e.g. "multipart/form-data; boundary=----XYZ").
    // Manually overriding to 'multipart/form-data' (without the boundary param)
    // causes ASP.NET Core's multipart parser to receive a boundary-less header →
    // it cannot parse the body → request.Audio binds as null →
    // TranscriptionErrors.InvalidAudio (Error.Validation) → HTTP 422.
    // Five minutes, not one: a 20 MB recording over a mobile connection can take well over a
    // minute to leave the phone, and the old 60 s timeout abandoned the upload mid-flight —
    // the server went on to transcribe a job nobody was polling, and the user saw "try again".
    return api
      .post<TranscriptionJob>("/api/transcriptions", form, {
        timeout: 300_000,
        onUploadProgress: extra?.onUploadProgress
          ? (e) => {
              const total = e.total ?? 0;
              if (total > 0) extra.onUploadProgress?.(Math.min(1, e.loaded / total));
            }
          : undefined,
      })
      .then((r) => r.data);
  },

  /** Sing-along grading (Pro): the recorded take and the part it was sung to. */
  grade: (fileUri: string, fileName: string, target: GradeTarget) => {
    const form = new FormData();
    form.append("audio", { uri: fileUri, name: fileName, type: "audio/m4a" } as unknown as Blob);
    form.append("target", JSON.stringify(target));
    return api.post<GradeResult>("/api/transcriptions/grade", form, { timeout: 90_000 }).then((r) => r.data);
  },

  /**
   * Four-part harmony (Pro), written only when asked: the transcription is the one voice that
   * was heard, and parts under it are an arrangement. Nothing is stored; a saved sheet keeps
   * them through `libraryApi.setParts`.
   */
  harmonise: (body: { key: string; tempoBpm: number; timeSignature: string; notes: NoteEvent[] }) =>
    api.post<HarmonisedSheet>("/api/transcriptions/harmonise", body, { timeout: 90_000 }).then((r) => r.data),

  /** Transposes a result that is not saved yet; the saved form is `libraryApi.transpose`. */
  transpose: (body: {
    key: string;
    semitones: number;
    notes: SavedTranscription["notes"];
    musicXml: string;
    parts?: Record<string, { notes: NonNullable<SavedTranscription["notes"]>; solfaLines: string[] }> | null;
    partsMusicXml?: string | null;
    chords?: ChordSymbol[] | null;
  }) => api.post<TransposedSheet>("/api/transcriptions/transpose", body).then((r) => r.data),

  getJob: (jobId: string) =>
    api
      .get<TranscriptionJob>(`/api/transcriptions/jobs/${jobId}`)
      .then((r) => r.data),

  /**
   * What a pasted link points at — title, artist, artwork, length — and how much of
   * the song this account may transcribe in one go. Costs nothing; asked as soon as a
   * pasted value is a song link, so the section picker can be drawn before submitting.
   */
  linkInfo: (url: string) =>
    api.post<LinkInfo>("/api/transcriptions/link/info", { url }, { timeout: 30_000 }).then((r) => r.data),

  /**
   * A song behind a YouTube, Spotify or Apple Music link. The worker fetches the
   * audio, isolates the lead vocal and transcribes it; the job carries the song's
   * title and artist as soon as the link resolves. Pro gets six minutes in the fast
   * lane; a free account gets one sixty-second preview. `startSeconds` / `endSeconds`
   * name the section the user chose; left out, the first part of the song is taken.
   */
  submitLink: (
    url: string,
    opts: Pick<SubmitOptions, "mode" | "key" | "tempo" | "timeSignature" | "keyboardTranspose"> & { startSeconds?: number; endSeconds?: number },
  ) =>
    api
      .post<TranscriptionJob>(
        "/api/transcriptions/link",
        {
          url,
          mode: opts.mode,
          key: opts.key,
          tempo: opts.tempo,
          timeSignature: opts.timeSignature || undefined,
          keyboardTranspose: opts.keyboardTranspose || undefined,
          audioPreview: false,
          startSeconds: opts.startSeconds,
          endSeconds: opts.endSeconds,
        },
        { timeout: 30_000 },
      )
      .then((r) => r.data),
};

export const libraryApi = {
  list: () => api.get<SavedTranscription[]>("/api/library").then((r) => r.data),

  get: (id: string) =>
    api.get<SavedTranscription>(`/api/library/${id}`).then((r) => r.data),

  save: (body: {
    title: string;
    key: string;
    tempoBpm: number;
    timeSignature: string;
    musicXml: string;
    notes: SavedTranscription["notes"];
    overallConfidence: number;
    sourceJobId?: string;
    lyrics?: string;
    parts?: Record<string, { notes: NonNullable<SavedTranscription["notes"]>; solfaLines: string[] }>;
    partsMusicXml?: string;
    chords?: ChordSymbol[] | null;
    /** The hymn whose hymnbook version this is, as the job offered it; the API keeps its credit. */
    hymnSlug?: string | null;
  }) => api.post<SavedTranscription>("/api/library", body).then((r) => r.data),

  rename: (id: string, title: string) =>
    api
      .put<SavedTranscription>(`/api/library/${id}/title`, { title })
      .then((r) => r.data),

  updateKey: (id: string, key: string) =>
    api
      .put<SavedTranscription>(`/api/library/${id}/key`, { key })
      .then((r) => r.data),

  /**
   * Persists tap-to-correct edits (F-07). The whole list, not one note: a
   * correction may delete a note, and that shifts every index after it. The
   * server ignores the solfa fields and re-derives them for the stored key.
   */
  updateNotes: (id: string, notes: SavedTranscription["notes"]) =>
    api
      .put<SavedTranscription>(`/api/library/${id}/notes`, { notes })
      .then((r) => r.data),

  updateTempo: (id: string, tempo: number) =>
    api
      .put<SavedTranscription>(`/api/library/${id}/tempo`, { tempo })
      .then((r) => r.data),

  updateTimeSignature: (id: string, timeSignature: string) =>
    api
      .put<SavedTranscription>(`/api/library/${id}/time-signature`, { timeSignature })
      .then((r) => r.data),

  remove: (id: string) =>
    api.delete(`/api/library/${id}`).then(() => undefined),

  updateLyrics: (id: string, lyrics: string) =>
    api.put<SavedTranscription>(`/api/library/${id}/lyrics`, { lyrics }).then((r) => r.data),

  /** Transpose for a choir's range: moves every note and the key; the solfa reads as before. */
  transpose: (id: string, semitones: number) =>
    api.post<SavedTranscription>(`/api/library/${id}/transpose`, { semitones }).then((r) => r.data),

  /** Files a sheet in a folder; null or blank takes it out of one. */
  setFolder: (id: string, folder: string | null) =>
    api.put<SavedTranscription>(`/api/library/${id}/folder`, { folder }).then((r) => r.data),

  /** One public link for a whole folder, including sheets filed in it later. */
  shareFolder: (folder: string) =>
    api.post<{ token: string; url: string }>("/api/library/folders/share", { folder }).then((r) => r.data),

  /** Keeps the parts written for a saved sheet after it was saved (null removes them). */
  setParts: (id: string, parts: Record<string, TranscriptionPart> | null, partsMusicXml: string | null) =>
    api.put<SavedTranscription>(`/api/library/${id}/parts`, { parts, partsMusicXml }).then((r) => r.data),

  share: (id: string) => api.post<ShareLink>(`/api/library/${id}/share`).then((r) => r.data),

  unshare: (id: string) => api.delete(`/api/library/${id}/share`).then(() => undefined),
};

export const billingApi = {
  /** Plans shown on the paywall, cheapest first. */
  plans: () => api.get<Plan[]>("/api/billing/plans").then((r) => r.data),

  /** The choir plans this account may buy (one director pays, the singers are Pro), cheapest first. */
  choirPlans: () => api.get<Plan[]>("/api/billing/plans/choir").then((r) => r.data),

  /**
   * The one-song purchase this account may buy (empty for a Pro member). Listed apart from `plans`
   * because older app builds render every plan in that list as a month or year of Pro.
   */
  singlePlans: () => api.get<Plan[]>("/api/billing/plans/single").then((r) => r.data),

  /**
   * Starts a hosted-checkout session for a plan. Returns the provider URL the app
   * opens in an external browser. Idempotent server-side: an in-flight checkout is
   * reused, so tapping "Upgrade" twice never opens a second charge.
   */
  checkout: (planId: string) =>
    api
      .post<CheckoutSession>("/api/billing/checkout", { planId })
      .then((r) => r.data),

  /** The caller's subscription state — the app gates Pro features on this. */
  mySubscription: () =>
    api.get<Subscription>("/api/billing/my-subscription").then((r) => r.data),

  /**
   * Asks the server to verify the caller's in-flight checkout with the provider *now*,
   * and returns the resulting subscription state. Send this the moment the checkout
   * browser closes: without it the app is waiting on the provider's webhook, which is
   * the entire reason "paid" used to take minutes to become "Pro".
   *
   * Safe to call at any time — no pending checkout is a no-op that just reports state —
   * and idempotent, so a retry cannot double-charge or double-fulfil. Returns the same
   * shape as `mySubscription()`, so one call both confirms and reports.
   */
  confirm: () =>
    api.post<Subscription>("/api/billing/confirm").then((r) => r.data),

  /**
   * Cancels at the end of the paid period. Pro is *not* withdrawn early and nothing is
   * refunded, so the caller should re-read `mySubscription()` afterwards rather than
   * assume the account just went Free. Idempotent server-side (204 either way).
   */
  cancel: () => api.post<void>("/api/billing/cancel").then(() => undefined),
};

/**
 * The choir plan. `mine` is the caller's choir as director or singer; 404 `CHOIR_NOT_FOUND`
 * when they are in none. Managing it (rename, members, invite) is the director's alone.
 */
export const choirApi = {
  /** The caller's choir, or null when they are in none. */
  mine: () =>
    api
      .get<Choir>("/api/choirs/mine")
      .then((r) => r.data as Choir | null)
      .catch((e: { response?: { status?: number } }) => {
        if (e?.response?.status === 404) return null;
        throw e;
      }),

  rename: (name: string) => api.put<Choir>("/api/choirs/mine", { name }).then((r) => r.data),

  members: () => api.get<ChoirMember[]>("/api/choirs/mine/members").then((r) => r.data),

  removeMember: (userId: string) => api.delete(`/api/choirs/mine/members/${userId}`).then(() => undefined),

  /** A new invite code; the old one stops working. */
  regenerateInvite: () => api.post<Choir>("/api/choirs/mine/invite").then((r) => r.data),

  join: (code: string) => api.post<Choir>("/api/choirs/join", { code }).then((r) => r.data),

  leave: () => api.post("/api/choirs/leave").then(() => undefined),

  /** The choir's shared library. */
  sheets: () => api.get<ChoirSheet[]>("/api/choirs/mine/sheets").then((r) => r.data),

  /** One sheet of the choir's library, read-only. */
  sheet: (id: string) => api.get<SharedSheet>(`/api/choirs/mine/sheets/${id}`).then((r) => r.data),

  /** Shares one of the caller's own sheets with their choir. */
  share: (id: string) => api.put(`/api/choirs/mine/sheets/${id}`).then(() => undefined),

  /** Takes a sheet out of the choir's library. */
  unshare: (id: string) => api.delete(`/api/choirs/mine/sheets/${id}`).then(() => undefined),
};

/**
 * The admin console's routes, behind `AuthorizationPolicies.Admin`. An ordinary
 * account gets 403 from every one of these, so the mobile gate (`useAuth().isAdmin`)
 * is a courtesy that keeps a normal user from seeing a screen full of errors — not
 * the security boundary. That is the server's.
 *
 * Every mutation is a POST carrying an optional `note`, and the target account or
 * payment is always in the URL rather than the body: a mismatched body could act on
 * a different row than the route names, which is the one thing an audit trail cannot
 * help with, because the row would be truthful about the wrong person.
 */
export const adminApi = {
  /** State of the money right now — counts, stuck rows, and what the ledger sums to. */
  paymentsSummary: () =>
    api
      .get<PaymentOpsSummary>("/api/admin/payments/summary")
      .then((r) => r.data),

  /** Always 200 while the API is up: a dependency being down is the answer. */
  health: () => api.get<SystemHealth>("/api/admin/health").then((r) => r.data),

  payments: (params: {
    page?: number;
    pageSize?: number;
    /** PascalCase on the way out too, though ASP.NET binds enums case-insensitively. */
    status?: string;
    provider?: string;
    stuckOnly?: boolean;
    search?: string;
  }) =>
    api
      .get<PagedResult<AdminPaymentRow>>("/api/admin/payments", { params })
      .then((r) => r.data),

  payment: (id: string) =>
    api
      .get<AdminPaymentDetail>(`/api/admin/payments/${id}`)
      .then((r) => r.data),

  /**
   * Asks the provider what happened and applies the answer, instead of waiting for
   * the sweep. Runs the same command the background worker runs, so an operator
   * cannot reach an outcome the sweep could not. Safe to repeat — a settled payment
   * is a no-op, and `changed` says which one you got.
   */
  reconcile: (id: string, note?: string) =>
    api
      .post<AdminReconcileResult>(`/api/admin/payments/${id}/reconcile`, { note })
      .then((r) => r.data),

  webhooks: (params: {
    page?: number;
    pageSize?: number;
    status?: string;
    provider?: string;
    search?: string;
  }) =>
    api
      .get<PagedResult<AdminWebhookEventRow>>("/api/admin/webhooks", { params })
      .then((r) => r.data),

  /** Carries the provider's request body — the field that explains a parked event. */
  webhook: (id: string) =>
    api
      .get<AdminWebhookEventDetail>(`/api/admin/webhooks/${id}`)
      .then((r) => r.data),

  users: (params: {
    page?: number;
    pageSize?: number;
    search?: string;
    isActive?: boolean;
  }) =>
    api
      .get<PagedResult<AdminUserRow>>("/api/admin/analytics/users", { params })
      .then((r) => r.data),

  user: (id: string) =>
    api.get<AdminUserDetail>(`/api/admin/users/${id}`).then((r) => r.data),

  /** Grants Pro at no charge. Records no payment and no ledger entry — a gift is
   *  not revenue — and is refused when the account already has an active one. */
  giftPro: (id: string, duration: BillingInterval, note?: string) =>
    api
      .post(`/api/admin/users/${id}/gift-pro`, { duration, note })
      .then(() => undefined),

  /** Takes a gift back. Refused for a subscription somebody paid for. */
  revokePro: (id: string, note?: string) =>
    api.post(`/api/admin/users/${id}/revoke-pro`, { note }).then(() => undefined),

  /** Moves the end of the period out. Must be later than the date it replaces. */
  extendSubscription: (id: string, newEndUtc: string, note?: string) =>
    api
      .post(`/api/admin/users/${id}/subscription/extend`, { newEndUtc, note })
      .then(() => undefined),

  /** Ends it now, gift or paid, forfeiting the rest of the period. Refunds nothing. */
  endSubscription: (id: string, note?: string) =>
    api
      .post(`/api/admin/users/${id}/subscription/end`, { note })
      .then(() => undefined),

  /**
   * Blocks sign-in and revokes refresh tokens. Not instant: an access token already
   * issued keeps working until it expires (up to `Auth:AccessTokenMinutes`, 60 by
   * default), because there is no server-side session to tear down.
   */
  suspend: (id: string, note?: string) =>
    api.post(`/api/admin/users/${id}/suspend`, { note }).then(() => undefined),

  reactivate: (id: string, note?: string) =>
    api.post(`/api/admin/users/${id}/reactivate`, { note }).then(() => undefined),

  /** Mails a reset link — the supported way to help someone locked out, because it
   *  puts the new password in their hands and not in an operator's. */
  sendPasswordReset: (id: string, note?: string) =>
    api
      .post(`/api/admin/users/${id}/send-password-reset`, { note })
      .then(() => undefined),

  /** Manually sweeps abandoned Pending and expired Processing checkouts. */
  clearStalePayments: () =>
    api
      .post<ClearStalePaymentsResult>("/api/admin/payments/clear-stale")
      .then((r) => r.data),

  /** Resets consumed trial quota on an account so they can transcribe again. */
  resetTrialQuota: (id: string, note?: string) =>
    api
      .post<number>(`/api/admin/users/${id}/reset-trial`, { note })
      .then((r) => r.data),

  /** Global list of transcriptions across all users. */
  transcriptions: (params?: {
    page?: number;
    pageSize?: number;
    status?: string;
    search?: string;
  }) =>
    api
      .get<PagedResult<AdminTranscriptionRow>>("/api/admin/transcriptions", { params })
      .then((r) => r.data),

  /** Fetches active global system announcement, if any. */
  getAnnouncement: () =>
    api.get<SystemAnnouncement | null>("/api/admin/announcement").then((r) => r.data),

  /** Publishes a global broadcast announcement. */
  setAnnouncement: (data: {
    message: string;
    severity?: string;
    expiresAtUtc?: string | null;
    note?: string;
  }) =>
    api
      .post<SystemAnnouncement>("/api/admin/announcement", data)
      .then((r) => r.data),

  /** Clears active global system announcement. */
  clearAnnouncement: (note?: string) =>
    api
      .delete("/api/admin/announcement", { params: { note } })
      .then(() => undefined),
};
