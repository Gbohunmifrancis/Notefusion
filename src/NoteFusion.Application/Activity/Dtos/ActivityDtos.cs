using NoteFusion.Application.Analytics.Dtos;

namespace NoteFusion.Application.Activity.Dtos;

/// <summary>
/// One transcription on the activity log: what was sent, by whom, how it ended, and whether it was saved.
/// The account fields are null for an anonymous preview that no one has claimed.
/// </summary>
public sealed record TranscriptionLogRowDto(
    Guid Id,
    string? JobId,
    DateTime CreatedAtUtc,
    string Origin,
    string Client,
    string Kind,
    string Mode,
    string? FileName,
    string? ContentType,
    long? SizeBytes,
    string? LinkUrl,
    string? SongTitle,
    string? SongArtist,
    string? KeyRequested,
    int? TempoRequested,
    string? TimeSignatureRequested,
    double? StartSeconds,
    double? EndSeconds,
    string Status,
    string? FailureReason,
    DateTime? FinishedAtUtc,
    double? AudioSeconds,
    string? DetectedKey,
    int? DetectedTempo,
    int? NoteCount,
    double? Confidence,
    bool UsedStorePreview,
    bool Saved,
    Guid? UserId,
    string? UserName,
    string? UserEmail,
    string? DeviceHash,
    string? FailureStage = null,
    string? FailureCode = null);

/// <summary>
/// Counts over everything the filters matched, not only the page shown. <c>Stops</c> is where the failed and refused
/// ones stopped, by step and reason, most first: the console's "Where they stop".
/// </summary>
public sealed record TranscriptionLogSummaryDto(
    int Total, int Done, int Failed, int Refused, int Running, int Saved, int StorePreviews, long TotalBytes,
    IReadOnlyList<FailureStopDto>? Stops = null);

/// <summary>One step and reason transcriptions stopped at (the log's <c>FailureStage</c> and <c>FailureCode</c>), and how often.</summary>
public sealed record FailureStopDto(string Stage, string Code, int Count);

public sealed record TranscriptionLogPageDto(
    PagedResultDto<TranscriptionLogRowDto> Page,
    TranscriptionLogSummaryDto Summary);

/// <summary>
/// One thing on a journey timeline. <c>Type</c> is "pageview", "click", "action", "transcription",
/// "payment" or "signup"; <c>Title</c> is the line to show and <c>Detail</c> the smaller print under it.
/// </summary>
public sealed record JourneyItemDto(
    DateTime AtUtc,
    string Type,
    string Title,
    string? Detail,
    string? Path,
    string? SessionId,
    string? Device,
    /// <summary>"ok", "warn" or "error", so the timeline can colour a failed upload or a declined payment.</summary>
    string Tone,
    /// <summary>The transcription log row or payment reference behind this item, when there is one.</summary>
    string? RefId);

/// <summary>
/// Everything one person or browser did in a window, newest first: pages, clicks, app actions, every
/// transcription (saved or not) and every payment attempt, from all the browsers and devices that are
/// known to be theirs.
/// </summary>
public sealed record JourneyDto(
    Guid? UserId,
    string? UserName,
    string? UserEmail,
    DateTime FromUtc,
    DateTime ToUtc,
    IReadOnlyList<string> VisitorIds,
    IReadOnlyList<string> DeviceHashes,
    IReadOnlyList<Guid> OtherAccounts,
    int Sessions,
    int Pageviews,
    int Transcriptions,
    int Payments,
    bool Truncated,
    IReadOnlyList<JourneyItemDto> Items);

/// <summary>One step of the checkout funnel: how many browser sessions reached it in the window.</summary>
public sealed record CheckoutStepDto(string Step, string Description, int Sessions, int Events);

/// <summary>A checkout that went wrong, from either side: the browser's report or the payment row.</summary>
public sealed record CheckoutProblemDto(
    DateTime AtUtc,
    string Source,
    string Problem,
    string? Detail,
    Guid? UserId,
    string? UserName,
    string? UserEmail,
    string? VisitorId,
    string? Reference);

/// <summary>
/// The checkout as the browser saw it (the funnel, from the tracker's actions) next to what the payment
/// providers recorded (attempts by status), with the newest problems from both, so a broken payment page
/// shows up as a drop between steps or a run of the same error.
/// </summary>
public sealed record CheckoutFunnelDto(
    DateTime FromUtc,
    DateTime ToUtc,
    IReadOnlyList<CheckoutStepDto> Steps,
    IReadOnlyList<CategoryCountDto> ErrorCodes,
    IReadOnlyList<CategoryCountDto> PaymentsByStatus,
    IReadOnlyList<CategoryCountDto> PaymentsByProvider,
    IReadOnlyList<CategoryCountDto> FailureReasons,
    IReadOnlyList<CategoryCountDto> PageErrors,
    IReadOnlyList<CheckoutProblemDto> RecentProblems);

/// <summary>
/// One entry in the full user activity feed. <c>Kind</c> is "signup", "login", "transcription", "saved",
/// "payment" or "action"; <c>Tone</c> is "ok", "warn" or "error".
/// </summary>
public sealed record FeedItemDto(
    DateTime AtUtc,
    string Kind,
    string Title,
    string? Detail,
    string Tone,
    Guid? UserId,
    string? UserName,
    string? UserEmail,
    string? Country);
