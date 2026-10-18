namespace NoteFusion.Application.Analytics.Dtos;

/// <summary>
/// The dashboard's headline counters for one window, each paired with the equivalent count from
/// the preceding window of the same length so the UI can show a trend without a second request.
/// </summary>
/// <remarks>
/// <b>What is deliberately absent.</b> There are no subscribed, paid, or free-tier counts. The billing
/// schema exists now, so the reason is no longer that it cannot be counted: these are per-window user
/// counters with a preceding-window comparison, and a subscription count belongs to a point in time
/// rather than to a window — "37 subscribers in June" has no honest single meaning. Live subscription
/// figures are on the health page (<c>GET api/admin/health</c>), where they are stated as a snapshot,
/// and revenue comes from the ledger.
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
    int DeactivatedUsers,
    /// <summary>Accounts seen since local midnight (reporting time): any signed-in request, else the last sign-in.</summary>
    int ActiveToday = 0);

/// <summary>Transcription throughput and reliability for one window.</summary>
/// <param name="TotalSaved">Transcriptions saved to a library inside the window.</param>
/// <param name="TotalSavedPrevious">The same count over the preceding window.</param>
/// <param name="SucceededCount">Jobs started in the window that produced a result: account transcriptions and free previews.</param>
/// <param name="FailedCount">Jobs started in the window that ended without a result.</param>
/// <param name="InFlightCount">Jobs started in the window still running.</param>
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
    long StoredBytes,
    /// <summary>Transcriptions that produced a result in the window, saved or not (see TranscriptionCounts).</summary>
    int TotalTranscribed = 0,
    int TotalTranscribedPrevious = 0,
    /// <summary>Jobs in the window whose result recognised a hymn in the library (the worker's hymnMatch).</summary>
    int HymnMatchesOffered = 0,
    /// <summary>Sheets saved in the window as a hymn's hymnbook version (the user said yes to the offer).</summary>
    int HymnVersionsSaved = 0);

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
    DateTime OccurredAtUtc,
    Guid? UserId,
    string? Email,
    string? Country,
    /// <summary>What happened, as a phrase after the name: "transcribed a song link", "paid ₦7,500 for Pro".</summary>
    string? Detail = null);

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
/// The website's acquisition funnel for one window: anonymous previews at the top, web sign-ups,
/// the share loop, and Pro conversions among web sign-ups at the bottom.
/// </summary>
/// <param name="Previews">Anonymous previews started inside the window.</param>
/// <param name="PreviewsPrevious">The same count over the preceding window.</param>
/// <param name="PreviewDevices">Distinct browsers that previewed; a floor on visitors who tried it.</param>
/// <param name="PreviewsSucceeded">Previews that reached a result the visitor could read.</param>
/// <param name="WebSignups">Accounts created from the website inside the window.</param>
/// <param name="WebSignupsPrevious">The same count over the preceding window.</param>
/// <param name="SignupsFromPreview">Of those, how many claimed a preview — the sign-ups the try-it-free box earned.</param>
/// <param name="WebSignupsWhoSaved">Web sign-ups in the window that have saved at least one sheet.</param>
/// <param name="SharesCreated">Sheets put behind a public link inside the window.</param>
/// <param name="ShareViews">Opens of public links, all time — the schema keeps a counter per sheet, not a view log.</param>
/// <param name="WebProConversions">Subscriptions started inside the window by accounts that signed up on the web.</param>
/// <param name="PreviewsPerDay">Previews per local day, zero-filled.</param>
public sealed record WebFunnelDto(
    int Previews,
    int PreviewsPrevious,
    int PreviewDevices,
    int PreviewsSucceeded,
    int WebSignups,
    int WebSignupsPrevious,
    int SignupsFromPreview,
    int WebSignupsWhoSaved,
    int SharesCreated,
    long ShareViews,
    int WebProConversions,
    IReadOnlyList<DailyCountDto> PreviewsPerDay);

/// <summary>
/// One action a signed-in web account took, for the dashboard's "what web users do" feed.
/// </summary>
/// <param name="Action">The action's name as the web app reported it, e.g. "Saved sheet".</param>
/// <param name="Path">The page it happened on.</param>
public sealed record WebActionItemDto(
    Guid UserId,
    string FullName,
    string Email,
    string Action,
    string Path,
    DateTime OccurredAtUtc);

/// <summary>
/// What the website's own tracker recorded for one window: page views, visitors, clicks and the
/// actions signed-in accounts took in the web app. Every figure is a count over
/// <c>web_events</c> rows, which the browser posts in batches to <c>POST api/web/events</c>.
/// </summary>
/// <param name="Pageviews">Pages viewed inside the window.</param>
/// <param name="PageviewsPrevious">The same count over the preceding window.</param>
/// <param name="Visitors">Distinct browsers (the tracker's random visitor id) that viewed a page.</param>
/// <param name="VisitorsPrevious">The same count over the preceding window.</param>
/// <param name="Sessions">Distinct tab sessions that viewed a page.</param>
/// <param name="Clicks">Links and buttons clicked.</param>
/// <param name="SignupClicks">Clicks on anything that leads to the sign-up form.</param>
/// <param name="Actions">Named actions taken in the web app, signed in or as a guest.</param>
/// <param name="ActiveWebUsers">Distinct accounts that took at least one action in the web app.</param>
/// <param name="PageviewsPerDay">Page views per local day, zero-filled.</param>
/// <param name="TopPages">The most viewed paths.</param>
/// <param name="TopReferrers">The sites visits came from; "Direct" when the browser sent none.</param>
/// <param name="TopClicks">The most clicked labels.</param>
/// <param name="Devices">Page views by device: Mobile or Desktop, from the viewport width.</param>
/// <param name="TopActions">The most taken actions in the web app.</param>
/// <param name="RecentActions">The newest actions by signed-in accounts, newest first.</param>
public sealed record WebTrafficDto(
    int Pageviews,
    int PageviewsPrevious,
    int Visitors,
    int VisitorsPrevious,
    int Sessions,
    int Clicks,
    int SignupClicks,
    int Actions,
    int ActiveWebUsers,
    IReadOnlyList<DailyCountDto> PageviewsPerDay,
    IReadOnlyList<CategoryCountDto> TopPages,
    IReadOnlyList<CategoryCountDto> TopReferrers,
    IReadOnlyList<CategoryCountDto> TopClicks,
    IReadOnlyList<CategoryCountDto> Devices,
    IReadOnlyList<CategoryCountDto> TopActions,
    IReadOnlyList<WebActionItemDto> RecentActions);

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
/// <param name="SignupSources">Accounts by the client that created them: web, mobile, or unknown (older accounts).</param>
/// <param name="WebFunnel">The website's acquisition funnel for the window.</param>
/// <param name="WebTraffic">Page views, visitors, clicks and web-app actions from the site's own tracker.</param>
/// <param name="Membership">Who is on Pro right now, what came in and went out in the window, and how the songs are used.</param>
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
    IReadOnlyList<ActivityItemDto> RecentActivity,
    IReadOnlyList<CategoryCountDto> SignupSources,
    WebFunnelDto WebFunnel,
    WebTrafficDto WebTraffic,
    MembershipDto Membership);

/// <summary>An amount in one currency's minor units (cents, kobo). Currencies are never added together.</summary>
public sealed record CurrencyAmountDto(string Currency, long AmountMinor);

/// <summary>
/// Pro membership for the admin overview. Every payment is a one-off for one period, so there is no
/// recurring revenue in the strict sense: <paramref name="MonthlyRunRate"/> is what the memberships
/// running now are worth per month (a yearly plan counted at a twelfth), the figure that would recur if
/// every member bought again. Each account counts once, on its latest subscription row.
/// </summary>
/// <param name="ActiveMembers">Accounts with Pro right now: <paramref name="PaidMembers"/> + <paramref name="GiftedMembers"/>.</param>
/// <param name="LifetimeMembers">Of the active members, how many hold lifetime access (counted in paid or gifted too).</param>
/// <param name="NewMembers">Subscriptions first started inside the window.</param>
/// <param name="LapsedMembers">Memberships whose paid time ran out inside the window without a new payment.</param>
/// <param name="Revenue">Payments collected inside the window, per currency, from the ledger.</param>
/// <param name="MonthlyRunRate">The active paid memberships' plan prices per month, per currency. Lifetime is excluded.</param>
/// <param name="MembersByPlan">Active members by plan name; gifts are labelled as such.</param>
/// <param name="SongsUsedThisMonth">Song credits spent since the first of this month (UTC), by every account.</param>
/// <param name="MembersOutOfSongs">Accounts that have spent the whole monthly allowance this month.</param>
/// <param name="ActiveChoirs">
/// Choirs whose plan is running. Each is one paid membership — its director's — and is counted once in
/// <paramref name="ActiveMembers"/>, <paramref name="PaidMembers"/>, <paramref name="MembersByPlan"/> (under
/// the choir plan's name) and <paramref name="MonthlyRunRate"/> (the choir plan's price, once).
/// </param>
/// <param name="ChoirSingers">
/// Singers in those choirs: Pro through a seat they did not pay for, so kept out of the member counts.
/// </param>
public sealed record MembershipDto(
    int ActiveMembers,
    int PaidMembers,
    int GiftedMembers,
    int LifetimeMembers,
    int NewMembers,
    int LapsedMembers,
    IReadOnlyList<CurrencyAmountDto> Revenue,
    IReadOnlyList<CurrencyAmountDto> MonthlyRunRate,
    IReadOnlyList<CategoryCountDto> MembersByPlan,
    int SongsUsedThisMonth,
    int MembersOutOfSongs,
    int ActiveChoirs = 0,
    int ChoirSingers = 0);

/// <summary>
/// One row of the admin user table. Deliberately narrow: enough to support the table and a
/// support conversation, and nothing more.
/// </summary>
/// <remarks>
/// This carries personal data, so it exists behind the admin policy only. There is no password
/// hash, no token, and no phone number here — a support view does not need the phone number to
/// identify an account, and the fewer places PII is copied to the better.
/// </remarks>
/// <param name="ProfilePictureUrl">
/// The account's avatar, or null when it has none. Only ever a URL — the image itself lives with
/// Google or in object storage — so this adds no new class of data to a view that already carries
/// the name and the address.
/// </param>
/// <param name="HasProAccess">
/// Whether Pro is unlocked right now — status and period window read together, the same rule
/// <c>GetSystemHealthQuery</c> counts subscribers with. Computed here rather than left to the
/// client, because a client that reimplements it will eventually disagree with the API about who
/// is a subscriber.
/// </param>
/// <param name="IsGiftedPro">
/// True when that access came from an operator's grant rather than a payment. Only meaningful
/// while <paramref name="HasProAccess"/> is true; false on an account with no access at all, which
/// is not the same statement as "they paid".
/// </param>
public sealed record AdminUserRowDto(
    Guid Id,
    string FullName,
    string Email,
    string? ProfilePictureUrl,
    string Role,
    bool IsActive,
    bool HasGoogle,
    bool HasPassword,
    DateTime CreatedAt,
    DateTime? LastLoginAt,
    int TranscriptionCount,
    bool HasProAccess,
    bool IsGiftedPro,
    /// <summary>Sheets in the library now. <c>TranscriptionCount</c> counts every transcription that produced a result.</summary>
    int SavedTranscriptionCount = 0,
    /// <summary>Transcriptions that ended without a result.</summary>
    int FailedTranscriptionCount = 0,
    /// <summary>The account's last signed-in request (or, before presence was recorded, its last sign-in).</summary>
    DateTime? LastSeenAtUtc = null,
    /// <summary>Seen within <c>LastSeen.OnlineWindow</c>.</summary>
    bool IsOnline = false,
    /// <summary>An admin or an account flagged internal: shown only when the list asks for the team.</summary>
    bool IsInternal = false,
    /// <summary>The account's stored ISO country code, when known.</summary>
    string? Country = null,
    /// <summary>Leads or sings in a choir whose plan is running (the phone admin's violet Choir badge).</summary>
    bool InChoir = false);

/// <summary>A page of results plus the total, so the client can render "showing 1-25 of 340".</summary>
public sealed record PagedResultDto<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount)
{
    public int TotalPages => PageSize <= 0 ? 0 : (int)Math.Ceiling(TotalCount / (double)PageSize);
}
