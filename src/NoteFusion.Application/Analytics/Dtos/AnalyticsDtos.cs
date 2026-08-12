namespace NoteFusion.Application.Analytics.Dtos;

/// <summary>
/// The dashboard's headline counters for one window, each paired with the equivalent count from
/// the preceding window of the same length so the UI can show a trend without a second request.
/// </summary>
/// <remarks>
/// <b>What is deliberately absent.</b> There are no subscribed, paid, or free-tier counts, because
/// no subscription, plan, or payment entity exists in the schema yet. Emitting zeros would be
/// indistinguishable from "nobody has paid", which is a claim this API cannot make. Those fields
/// arrive with the billing model.
/// </remarks>
/// <param name="TotalUsers">Every account, regardless of when it was created.</param>
/// <param name="NewUsers">Accounts created inside the window.</param>
/// <param name="NewUsersPrevious">Accounts created in the preceding window of equal length.</param>
/// <param name="ActiveUsers">
/// Accounts whose last sign-in falls inside the window. A returning user who never signs out and
/// rides a refresh token will not update this, so treat it as a floor, not a precise DAU.
/// </param>
/// <param name="ActiveUsersPrevious">The same measure over the preceding window.</param>
/// <param name="GoogleVerifiedUsers">
/// Accounts with a linked Google identity. This is the closest thing to a verified-email count the
/// schema supports: Google attested the address at sign-in. It is <em>not</em> a general
/// email-verification metric, and it is named for what it actually measures rather than for what a
/// dashboard card might wish it meant.
/// </param>
/// <param name="PasswordOnlyUsers">Accounts with a password and no linked Google identity.</param>
/// <param name="LockedOutUsers">Accounts currently inside a failed-login lockout.</param>
/// <param name="DeactivatedUsers">Accounts with <c>IsActive</c> false.</param>
public sealed record UserMetricsDto(
    int TotalUsers,
    int NewUsers,
    int NewUsersPrevious,
    int ActiveUsers,
    int ActiveUsersPrevious,
    int GoogleVerifiedUsers,
    int PasswordOnlyUsers,
    int LockedOutUsers,
    int DeactivatedUsers);

/// <summary>Transcription throughput and reliability for one window.</summary>
/// <param name="TotalSaved">Transcriptions saved to a library inside the window.</param>
/// <param name="TotalSavedPrevious">The same count over the preceding window.</param>
/// <param name="SucceededCount">Saved transcriptions in a terminal <c>Done</c> state.</param>
/// <param name="FailedCount">Saved transcriptions in a <c>Failed</c> state.</param>
/// <param name="InFlightCount">Still <c>Pending</c> or <c>Processing</c>.</param>
/// <param name="SuccessRate">
/// Succeeded over all terminal outcomes, 0 to 1, rounded to four places. Null when nothing has
/// reached a terminal state, because a rate over an empty denominator is undefined and 0 would
/// read as total failure.
/// </param>
/// <param name="AverageConfidence">
/// Mean overall confidence across succeeded transcriptions, 0 to 1. Null when there are none.
/// </param>
/// <param name="StoredBytes">
/// Total size of the engraved MusicXML held across every saved transcription, all time, measured
/// as the summed character length of that text. This is the whole of what NoteFusion stores per
/// transcription: the source audio is deleted after each job (PRD privacy rule), so there is no
/// hidden media footprint this figure omits. MusicXML is ASCII text, so one character is one byte
/// and the character sum is the byte size; the sum is computed in the database, never estimated.
/// </param>
public sealed record TranscriptionMetricsDto(
    int TotalSaved,
    int TotalSavedPrevious,
    int SucceededCount,
    int FailedCount,
    int InFlightCount,
    double? SuccessRate,
    double? AverageConfidence,
    long StoredBytes);

/// <summary>One day of a time series, bucketed by reporting-local date (WAT, UTC+1).</summary>
/// <param name="Date">The local calendar date, not an instant.</param>
public sealed record DailyCountDto(DateOnly Date, int Count);

/// <summary>A named slice of a breakdown, for a bar or donut chart.</summary>
public sealed record CategoryCountDto(string Label, int Count);

/// <summary>
/// One entry in the dashboard's recent-activity feed: a real event with a real timestamp.
/// </summary>
/// <remarks>
/// Every item is a point-in-time fact the schema actually records — an account was created, a
/// transcription was saved, a user last signed in. The feed does not reconstruct a session
/// history it does not have: the login items reflect each account's <em>latest</em>
/// <c>LastLoginAt</c>, not every sign-in, which is why the same account never appears twice as a
/// login. That bound is deliberate, not a sampling artefact.
/// </remarks>
/// <param name="Kind">"signup", "transcription", or "login" — the client picks an icon from this.</param>
/// <param name="Title">The headline, e.g. a transcription title or an account's display name.</param>
/// <param name="Subtitle">Secondary line, e.g. the email. Null when there is nothing to add.</param>
/// <param name="OccurredAtUtc">When the event happened, in UTC.</param>
public sealed record ActivityItemDto(
    string Kind,
    string Title,
    string? Subtitle,
    DateTime OccurredAtUtc);

/// <summary>
/// Signup-cohort retention: of the users who joined in a period, how many later came back.
/// </summary>
/// <param name="CohortStart">First local date in the cohort's period.</param>
/// <param name="CohortSize">Users who joined in that period.</param>
/// <param name="ReturnedCount">
/// Of those, how many have a last-sign-in strictly later than the day they joined. Same-day
/// activity is excluded: signing in as part of registering is not a return visit.
/// </param>
/// <param name="RetentionRate">
/// <paramref name="ReturnedCount"/> over <paramref name="CohortSize"/>, 0 to 1, rounded to four
/// places. Null for an empty cohort rather than 0, so the chart can omit the point instead of
/// plotting a misleading floor.
/// </param>
public sealed record RetentionCohortDto(
    DateOnly CohortStart,
    int CohortSize,
    int ReturnedCount,
    double? RetentionRate);

/// <summary>
/// The whole overview payload in one response, so the dashboard's first paint costs one request
/// rather than six. Each section is independently meaningful and the series are aligned to the
/// same window.
/// </summary>
/// <param name="FromUtc">Inclusive start of the window, echoed so the client can label the chart.</param>
/// <param name="ToUtc">Exclusive end of the window.</param>
/// <param name="ReportingOffsetMinutes">
/// The offset used to bucket days, echoed so the dashboard formats dates the same way the server
/// grouped them instead of falling back to the browser's timezone.
/// </param>
/// <param name="Users">Account counters.</param>
/// <param name="Transcriptions">Throughput and reliability counters.</param>
/// <param name="SignupsPerDay">New accounts per local day, zero-filled across the window.</param>
/// <param name="TranscriptionsPerDay">Saved transcriptions per local day, zero-filled.</param>
/// <param name="SignupMethods">Account split by sign-up route.</param>
/// <param name="DevicePlatforms">Registered push devices by platform.</param>
/// <param name="TopKeys">The most common musical keys across saved transcriptions.</param>
/// <param name="Retention">Weekly signup cohorts and their return rates.</param>
/// <param name="RecentActivity">
/// The newest real events across the platform — signups, saved transcriptions, and latest
/// sign-ins — interleaved and capped. A feed for the dashboard's right rail, not an audit log.
/// </param>
public sealed record AnalyticsOverviewDto(
    DateTime FromUtc,
    DateTime ToUtc,
    int ReportingOffsetMinutes,
    UserMetricsDto Users,
    TranscriptionMetricsDto Transcriptions,
    IReadOnlyList<DailyCountDto> SignupsPerDay,
    IReadOnlyList<DailyCountDto> TranscriptionsPerDay,
    IReadOnlyList<CategoryCountDto> SignupMethods,
    IReadOnlyList<CategoryCountDto> DevicePlatforms,
    IReadOnlyList<CategoryCountDto> TopKeys,
    IReadOnlyList<RetentionCohortDto> Retention,
    IReadOnlyList<ActivityItemDto> RecentActivity);

/// <summary>
/// One row of the admin user table. Deliberately narrow: enough to support the table and a
/// support conversation, and nothing more.
/// </summary>
/// <remarks>
/// This carries personal data, so it exists behind the admin policy only. There is no password
/// hash, no token, and no phone number here — a support view does not need the phone number to
/// identify an account, and the fewer places PII is copied to the better.
/// </remarks>
public sealed record AdminUserRowDto(
    Guid Id,
    string FullName,
    string Email,
    string Role,
    bool IsActive,
    bool HasGoogle,
    bool HasPassword,
    DateTime CreatedAt,
    DateTime? LastLoginAt,
    int TranscriptionCount);

/// <summary>A page of results plus the total, so the client can render "showing 1-25 of 340".</summary>
public sealed record PagedResultDto<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount)
{
    public int TotalPages => PageSize <= 0 ? 0 : (int)Math.Ceiling(TotalCount / (double)PageSize);
}
