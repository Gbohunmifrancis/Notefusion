namespace NoteFusion.Application.Admin.Dtos;

/// <summary>
/// One line of the admin audit trail, flattened for display.
/// </summary>
/// <remarks>
/// The emails come from the stored snapshots, not from a join, so a row still names its actor and its
/// target after either account is gone. <paramref name="IpAddress"/> is null when the address could not
/// be established — the client renders that as "—" rather than inventing a loopback address.
/// </remarks>
/// <param name="Action">The enum member's name, e.g. "GiftPro". Stable enough for the UI to key an icon off.</param>
/// <param name="Summary">The sentence the handler wrote when it performed the action.</param>
/// <param name="Note">The operator's own reason, when they gave one.</param>
public sealed record AuditLogRowDto(
    Guid Id,
    Guid ActorUserId,
    string ActorEmail,
    string Action,
    Guid? TargetUserId,
    string? TargetEmail,
    string? IpAddress,
    string Summary,
    string? Note,
    DateTime OccurredAtUtc);

/// <summary>
/// The subscription on an account, as the console needs to describe it.
/// </summary>
/// <param name="Provider">
/// Which gateway took the money, or null when nobody did. Paired with <paramref name="IsGift"/> rather
/// than left for the client to infer, so the dashboard does not have to know that "no provider" is what
/// a gift looks like in the table.
/// </param>
/// <param name="IsGift">Granted by an operator; no payment and no ledger entry exists for it.</param>
/// <param name="CurrentPeriodEndUtc">
/// Null for lifetime access. The column holds a far-future sentinel, and a client that formats it prints
/// "31 December 9999" at the customer who paid the most.
/// </param>
/// <param name="IsActive">
/// Whether Pro is unlocked right now — the status and the period window read together. Sent as a computed
/// answer because a client that reimplements that rule will eventually disagree with the API about who is
/// a subscriber.
/// </param>
public sealed record AdminSubscriptionDto(
    Guid Id,
    string? PlanCode,
    string? PlanName,
    string Status,
    bool IsActive,
    bool IsGift,
    bool IsLifetime,
    string? Provider,
    DateTime CurrentPeriodStartUtc,
    DateTime? CurrentPeriodEndUtc,
    DateTime? CanceledAtUtc,
    DateTime CreatedAtUtc);

/// <summary>
/// One payment attempt on the account. Attempts are kept, not just successes: "they tried four times and
/// the card kept failing" is the answer to most billing tickets, and a list of only completed payments
/// cannot give it.
/// </summary>
/// <param name="AmountMinor">Minor units of <paramref name="Currency"/> — kobo for NGN, cents for USD.</param>
public sealed record AdminPaymentDto(
    Guid Id,
    string Reference,
    string? ProviderReference,
    string Provider,
    string Status,
    long AmountMinor,
    string Currency,
    string? PlanName,
    string? FailureReason,
    DateTime CreatedAtUtc);

/// <summary>
/// One immutable ledger movement. <paramref name="Direction"/> carries the sign — the stored amount is
/// always positive — so the client formats a credit and a debit from the same field pair.
/// </summary>
public sealed record AdminLedgerEntryDto(
    Guid Id,
    string Direction,
    string Reason,
    long AmountMinor,
    string Currency,
    string Description,
    DateTime CreatedAtUtc);

/// <summary>
/// Everything the console shows about one account: who they are, whether they can sign in, what they hold,
/// what they paid, and what operators have done to them.
/// </summary>
/// <remarks>
/// This is the most personal payload the API produces, so it lives behind the admin policy and carries no
/// password hash, no token hash, and no refresh-token material. The phone number is included where the list
/// view omits it, because a support call is the one place it is actually the identifying detail.
/// <para>
/// The three histories are capped at <see cref="GetUserAccountQuery.HistoryLimit"/> rows each and ordered
/// newest first. They are a support view, not an export — the full trail is the audit-log page, which pages.
/// </para>
/// </remarks>
/// <param name="LockoutEndAt">
/// When a failed-login lockout lifts, or null when the account is not locked out. Present because "I can't
/// log in" is usually this and nothing to do with suspension, and the two are fixed differently.
/// </param>
/// <param name="TrialGenerationsUsed">
/// Free transcriptions consumed by this account this week (since the last Friday 18:00 WAT), counted from the
/// jobs that consumed them rather than from saved transcriptions — deleting a transcription does not hand the
/// trial back. Bought ones are counted apart (<paramref name="BoughtTranscriptionsUsed"/>). Per account: the
/// paywall also counts other accounts on the same handset and inbox, and jobs still running.
/// </param>
/// <param name="BoughtTranscriptionsUsed">One-song purchases spent or held by a running job.</param>
/// <param name="BoughtTranscriptionsTotal">One-song purchases fulfilled, ever.</param>
/// <param name="SongPreviewsUsed">The free one-minute link previews this account was charged (one at most, by design).</param>
/// <param name="ChargedTranscriptionCount">
/// Jobs that spent an allowance: a free one, a bought one, a Pro song credit or the free link preview. Unlike
/// <paramref name="TranscriptionCount"/>, it leaves out work done on Pro (recordings cost nothing there), claimed
/// website previews and sheets from before jobs were recorded — compare this, not that, with the allowance.
/// </param>
/// <param name="Subscription">Null when the account has never had one, gifted or paid.</param>
public sealed record AdminUserDetailDto(
    Guid Id,
    string FullName,
    string Email,
    string? PhoneNumber,
    string? ProfilePictureUrl,
    string Role,
    bool IsActive,
    bool HasGoogle,
    bool HasPassword,
    string? Country,
    DateTime CreatedAt,
    DateTime? LastLoginAt,
    DateTime? LockoutEndAt,
    int TranscriptionCount,
    int TrialGenerationsUsed,
    int TrialGenerationsTotal,
    AdminSubscriptionDto? Subscription,
    IReadOnlyList<AdminPaymentDto> Payments,
    IReadOnlyList<AdminLedgerEntryDto> Ledger,
    IReadOnlyList<AuditLogRowDto> RecentActions,
    IReadOnlyList<AdminTranscriptionSummaryDto>? RecentTranscriptions = null,
    /// <summary>Sheets in the library now. <c>TranscriptionCount</c> counts every transcription that produced a result.</summary>
    int SavedTranscriptionCount = 0,
    /// <summary>Transcriptions that ended without a result.</summary>
    int FailedTranscriptionCount = 0,
    /// <summary>A team or test account, left out of analytics (an admin always is).</summary>
    bool IsInternal = false,
    DateTime? LastSeenAtUtc = null,
    int BoughtTranscriptionsUsed = 0,
    int BoughtTranscriptionsTotal = 0,
    int SongPreviewsUsed = 0,
    int ChargedTranscriptionCount = 0,
    /// <summary>The inbox the address delivers to (aliases share one), whose free allowance every account on it shares.</summary>
    string? CanonicalEmail = null,
    /// <summary>Other accounts on the same inbox: they and this one share the free transcriptions.</summary>
    int SharedMailboxAccounts = 0);

public sealed record AdminTranscriptionSummaryDto(
    Guid Id,
    string Title,
    string Key,
    int TempoBpm,
    double OverallConfidence,
    string Status,
    DateTime CreatedAtUtc);

public sealed record AdminTranscriptionRowDto(
    Guid Id,
    Guid UserId,
    string UserEmail,
    string Title,
    string Key,
    int TempoBpm,
    string TimeSignature,
    double OverallConfidence,
    string Status,
    DateTime CreatedAtUtc);

public sealed record SystemAnnouncementDto(
    Guid Id,
    string Message,
    string Severity,
    bool IsActive,
    DateTime? ExpiresAtUtc,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc);



/// <summary>
/// Saved sheets' dohs against the engine's (<c>GetKeyCorrectionsQuery</c>): how many sheets, how many had
/// their doh changed, how many were offered other dohs, and how many of the changed ones kept one of those.
/// </summary>
public sealed record KeyCorrectionsDto(
    int Days,
    int Sheets,
    int DohChanged,
    int Offered,
    int ChangedToAnOfferedDoh,
    IReadOnlyList<KeyCorrectionRowDto> Rows);

/// <summary>
/// One saved sheet, anonymised: the key the engine wrote and the notes it heard, the key and notes the user
/// kept, the semitones the sheet was transposed by (taken out before the dohs are compared), and whether the
/// doh kept was one the engine offered.
/// </summary>
public sealed record KeyCorrectionRowDto(
    DateTime SavedOn,
    string Kind,
    string DetectedKey,
    double KeyConfidence,
    IReadOnlyList<string> OfferedKeys,
    string KeptKey,
    int Transposed,
    bool DohChanged,
    bool KeptOfferedDoh,
    IReadOnlyList<KeyCorrectionNoteDto> HeardNotes,
    IReadOnlyList<KeyCorrectionNoteDto> KeptNotes);

public sealed record KeyCorrectionNoteDto(int Pitch, double Beats);
