using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Analytics.Queries;

/// <summary>
/// The admin dashboard's overview payload for a window, defaulting to the last 30 days.
/// </summary>
/// <param name="From">Inclusive local start date. Null means <paramref name="To"/> minus 30 days.</param>
/// <param name="To">Inclusive local end date. Null means now.</param>
public sealed record GetAnalyticsOverviewQuery(DateTime? From = null, DateTime? To = null)
    : IRequest<Result<AnalyticsOverviewDto>>;

public sealed class GetAnalyticsOverviewQueryHandler
    : IRequestHandler<GetAnalyticsOverviewQuery, Result<AnalyticsOverviewDto>>
{
    private const int DefaultWindowDays = 30;

    /// <summary>How far back a sign-in counts as "recently active" for the rolling counter.</summary>
    private const int ActiveWindowDays = 30;

    /// <summary>Keys are ranked for a chart, so the tail is noise. Matches a readable bar count.</summary>
    private const int TopKeyCount = 8;

    /// <summary>Weekly cohorts, capped so the retention chart stays legible.</summary>
    private const int RetentionWeeks = 12;

    /// <summary>Entries in the recent-activity feed. Enough to fill the rail without a scrollbar.</summary>
    private const int RecentActivityCount = 12;

    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetAnalyticsOverviewQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<AnalyticsOverviewDto>> Handle(
        GetAnalyticsOverviewQuery request, CancellationToken cancellationToken)
    {
        var utcNow = _clock.UtcNow;
        var rangeResult = AnalyticsRange.Create(request.From, request.To, DefaultWindowDays, utcNow);
        if (rangeResult.IsFailure)
            return rangeResult.Error;

        var range = rangeResult.Value;
        var previous = range.PreviousPeriod();
        var activeSince = utcNow.AddDays(-ActiveWindowDays);

        var users = await BuildUserMetrics(range, previous, activeSince, cancellationToken);
        var transcriptions = await BuildTranscriptionMetrics(range, previous, cancellationToken);

        // Series pull only the timestamp column for the window and bucket in memory. Grouping by a
        // shifted date server-side would have to translate identically on Npgsql and on the SQLite
        // the tests run against, and a divergence there would only show up in production. The
        // window is bounded by AnalyticsRange.MaxDays, so the row count is bounded too.
        var signupsPerDay = await DailySeries(
            _db.Users.Where(u => u.CreatedAt >= range.FromUtc && u.CreatedAt < range.ToUtc)
                     .Select(u => u.CreatedAt),
            range, cancellationToken);

        var transcriptionsPerDay = await DailySeries(
            _db.Transcriptions.Where(t => t.CreatedAtUtc >= range.FromUtc && t.CreatedAtUtc < range.ToUtc)
                              .Select(t => t.CreatedAtUtc),
            range, cancellationToken);

        var signupMethods = await BuildSignupMethods(cancellationToken);
        var devicePlatforms = await BuildDevicePlatforms(cancellationToken);
        var topKeys = await BuildTopKeys(cancellationToken);
        var retention = await BuildRetention(utcNow, cancellationToken);
        var recentActivity = await BuildRecentActivity(cancellationToken);
        var signupSources = await BuildSignupSources(cancellationToken);
        var webFunnel = await BuildWebFunnel(range, previous, cancellationToken);
        var webTraffic = await BuildWebTraffic(range, previous, cancellationToken);
        var membership = await BuildMembership(range, utcNow, cancellationToken);

        return new AnalyticsOverviewDto(
            range.FromUtc,
            range.ToUtc,
            (int)AnalyticsRange.ReportingOffset.TotalMinutes,
            users,
            transcriptions,
            signupsPerDay,
            transcriptionsPerDay,
            signupMethods,
            devicePlatforms,
            topKeys,
            retention,
            recentActivity,
            signupSources,
            webFunnel,
            webTraffic,
            membership);
    }

    private async Task<IReadOnlyList<CategoryCountDto>> BuildSignupSources(CancellationToken ct)
    {
        var web = await _db.Users.CountAsync(u => u.SignupSource == "web", ct);
        var mobile = await _db.Users.CountAsync(u => u.SignupSource == "mobile", ct);
        var unknown = await _db.Users.CountAsync(u => u.SignupSource == null, ct);
        return [new CategoryCountDto("Web", web), new CategoryCountDto("Mobile", mobile), new CategoryCountDto("Unknown", unknown)];
    }

    /// <summary>
    /// The website's funnel. Every stage is a count of rows the schema actually keeps — preview jobs,
    /// accounts stamped with a source, claims, saved sheets, share tokens, subscriptions — so each
    /// number can be traced to a table rather than to an event stream that does not exist.
    /// </summary>
    private async Task<WebFunnelDto> BuildWebFunnel(AnalyticsRange range, AnalyticsRange previous, CancellationToken ct)
    {
        var previews = _db.PreviewJobs.Where(p => p.CreatedAtUtc >= range.FromUtc && p.CreatedAtUtc < range.ToUtc);
        var webUsers = _db.Users.Where(u => u.SignupSource == "web" && u.CreatedAt >= range.FromUtc && u.CreatedAt < range.ToUtc);

        var webUserIds = await webUsers.Select(u => u.Id).ToListAsync(ct);
        var claimedBy = await _db.PreviewJobs
            .Where(p => p.ClaimedByUserId != null)
            .Select(p => p.ClaimedByUserId!.Value)
            .Distinct()
            .ToListAsync(ct);
        var savers = await _db.Transcriptions
            .Where(t => webUserIds.Contains(t.UserId))
            .Select(t => t.UserId)
            .Distinct()
            .CountAsync(ct);
        var allWebIds = await _db.Users.Where(u => u.SignupSource == "web").Select(u => u.Id).ToListAsync(ct);
        var proConversions = await _db.Subscriptions
            .Where(s => s.CreatedAtUtc >= range.FromUtc && s.CreatedAtUtc < range.ToUtc && allWebIds.Contains(s.UserId))
            .Select(s => s.UserId)
            .Distinct()
            .CountAsync(ct);

        var previewsPerDay = await DailySeries(previews.Select(p => p.CreatedAtUtc), range, ct);

        return new WebFunnelDto(
            Previews: await previews.CountAsync(ct),
            PreviewsPrevious: await _db.PreviewJobs.CountAsync(p => p.CreatedAtUtc >= previous.FromUtc && p.CreatedAtUtc < previous.ToUtc, ct),
            PreviewDevices: await previews.Where(p => p.DeviceFingerprint != null).Select(p => p.DeviceFingerprint).Distinct().CountAsync(ct),
            PreviewsSucceeded: await previews.CountAsync(p => p.Succeeded, ct),
            WebSignups: webUserIds.Count,
            WebSignupsPrevious: await _db.Users.CountAsync(u => u.SignupSource == "web" && u.CreatedAt >= previous.FromUtc && u.CreatedAt < previous.ToUtc, ct),
            SignupsFromPreview: webUserIds.Count(id => claimedBy.Contains(id)),
            WebSignupsWhoSaved: savers,
            SharesCreated: await _db.Transcriptions.CountAsync(t => t.SharedAtUtc != null && t.SharedAtUtc >= range.FromUtc && t.SharedAtUtc < range.ToUtc, ct),
            ShareViews: await _db.Transcriptions.SumAsync(t => (long?)t.ShareViews, ct) ?? 0L,
            WebProConversions: proConversions,
            PreviewsPerDay: previewsPerDay);
    }

    /// <summary>Ranked lists on the traffic panel are read at a glance, so the tail is cut.</summary>
    private const int TopTrafficCount = 8;

    /// <summary>Entries in the "what web users do" feed.</summary>
    private const int RecentWebActionCount = 12;

    /// <summary>
    /// The website's own traffic: what the browser-side tracker posted to <c>api/web/events</c>.
    /// Counts are over the window; the ranked lists are top-N by count; the feed is the newest
    /// actions by accounts, joined to the account so the dashboard can name them.
    /// </summary>
    /// <remarks>
    /// Distinct counts (visitors, sessions, accounts) are taken in the database; the ranked lists
    /// are grouped there too and ordered in memory, which keeps the ordering identical on Npgsql
    /// and on the SQLite the tests run against.
    /// </remarks>
    /// <summary>
    /// Pro membership. Subscriptions and plans are small tables, so they are read whole and folded in
    /// memory: the same reason the series are, plus that "latest row per account" and the per-currency
    /// sums would otherwise need SQL that translates differently on Npgsql and on the tests' SQLite.
    /// </summary>
    private async Task<MembershipDto> BuildMembership(AnalyticsRange range, DateTime utcNow, CancellationToken ct)
    {
        var rows = await _db.Subscriptions
            .Select(s => new { s.UserId, s.PlanId, s.Provider, s.Status, s.CurrentPeriodEndUtc, s.CreatedAtUtc })
            .ToListAsync(ct);
        var plans = await _db.Plans
            .Select(p => new { p.Id, p.Name, p.AmountMinor, p.Currency, p.Interval })
            .ToListAsync(ct);
        var planById = plans.ToDictionary(p => p.Id);

        // One membership per account: its latest row, as the app and the billing commands read it.
        var latest = rows
            .GroupBy(s => s.UserId)
            .Select(g => g.OrderByDescending(s => s.CurrentPeriodEndUtc).First())
            .ToList();
        var active = latest
            .Where(s => s.Status is SubscriptionStatus.Active or SubscriptionStatus.Canceled && utcNow < s.CurrentPeriodEndUtc)
            .ToList();
        var gifted = active.Count(s => s.Provider is null);
        var lifetime = active.Count(s => s.CurrentPeriodEndUtc >= NoteFusion.Core.Entities.Billing.Subscription.LifetimeEndUtc);

        var newMembers = rows
            .GroupBy(s => s.UserId)
            .Count(g => g.Min(s => s.CreatedAtUtc) is var first && first >= range.FromUtc && first < range.ToUtc);
        var lapseUntil = range.ToUtc < utcNow ? range.ToUtc : utcNow;
        var lapsed = latest.Count(s => s.CurrentPeriodEndUtc >= range.FromUtc && s.CurrentPeriodEndUtc < lapseUntil);

        var runRate = active
            .Where(s => s.Provider is not null && s.CurrentPeriodEndUtc < NoteFusion.Core.Entities.Billing.Subscription.LifetimeEndUtc)
            .Select(s => planById.GetValueOrDefault(s.PlanId))
            .Where(p => p is not null && p.Interval != BillingInterval.Lifetime)
            .GroupBy(p => p!.Currency)
            .Select(g => new CurrencyAmountDto(g.Key, g.Sum(p => p!.Interval == BillingInterval.Yearly ? p.AmountMinor / 12 : p.AmountMinor)))
            .OrderByDescending(c => c.AmountMinor)
            .ToList();

        var byPlan = active
            .GroupBy(s => s.Provider is null
                ? "Gift"
                : planById.GetValueOrDefault(s.PlanId)?.Name ?? "Unknown plan")
            .Select(g => new CategoryCountDto(g.Key, g.Count()))
            .OrderByDescending(c => c.Count)
            .ToList();

        var charges = await _db.LedgerEntries
            .Where(e => e.Reason == LedgerEntryReason.SubscriptionCharge
                        && e.Direction == LedgerDirection.Credit
                        && e.CreatedAtUtc >= range.FromUtc && e.CreatedAtUtc < range.ToUtc)
            .Select(e => new { e.Currency, e.AmountMinor })
            .ToListAsync(ct);
        var revenue = charges
            .GroupBy(e => e.Currency)
            .Select(g => new CurrencyAmountDto(g.Key, g.Sum(e => e.AmountMinor)))
            .OrderByDescending(c => c.AmountMinor)
            .ToList();

        var monthStart = new DateTime(utcNow.Year, utcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var spent = await _db.TranscriptionJobs
            .Where(j => j.SongCreditConsumedAtUtc != null && j.SongCreditConsumedAtUtc >= monthStart)
            .Select(j => j.UserId)
            .ToListAsync(ct);
        var outOfSongs = spent
            .GroupBy(u => u)
            .Count(g => g.Count() >= NoteFusion.Application.Common.SongCredits.ProMonthlyAllowance);

        return new MembershipDto(
            active.Count, active.Count - gifted, gifted, lifetime,
            newMembers, lapsed, revenue, runRate, byPlan, spent.Count, outOfSongs);
    }

    private async Task<WebTrafficDto> BuildWebTraffic(AnalyticsRange range, AnalyticsRange previous, CancellationToken ct)
    {
        var inRange = _db.WebEvents.Where(e => e.OccurredAtUtc >= range.FromUtc && e.OccurredAtUtc < range.ToUtc);
        var inPrevious = _db.WebEvents.Where(e => e.OccurredAtUtc >= previous.FromUtc && e.OccurredAtUtc < previous.ToUtc);
        var views = inRange.Where(e => e.Kind == WebEvent.Pageview);
        var clicks = inRange.Where(e => e.Kind == WebEvent.Click);
        var actions = inRange.Where(e => e.Kind == WebEvent.Action);

        var topPages = await Ranked(views.GroupBy(e => e.Path), ct);
        var referrers = await Ranked(views.GroupBy(e => e.Referrer ?? "Direct"), ct);
        var topClicks = await Ranked(clicks.GroupBy(e => e.Name!), ct);
        var devices = await Ranked(views.GroupBy(e => e.Device == "mobile" ? "Mobile" : "Desktop"), ct);
        var topActions = await Ranked(actions.GroupBy(e => e.Name!), ct);

        var recentRows = await actions
            .Where(e => e.UserId != null)
            .OrderByDescending(e => e.OccurredAtUtc)
            .Take(RecentWebActionCount)
            .Select(e => new { e.UserId, e.Name, e.Path, e.OccurredAtUtc, User = _db.Users.FirstOrDefault(u => u.Id == e.UserId) })
            .ToListAsync(ct);
        var recent = recentRows
            .Where(r => r.User != null)
            .Select(r => new WebActionItemDto(r.User!.Id, r.User.FullName, r.User.Email, r.Name!, r.Path, r.OccurredAtUtc))
            .ToList();

        return new WebTrafficDto(
            Pageviews: await views.CountAsync(ct),
            PageviewsPrevious: await inPrevious.CountAsync(e => e.Kind == WebEvent.Pageview, ct),
            Visitors: await views.Select(e => e.VisitorId).Distinct().CountAsync(ct),
            VisitorsPrevious: await inPrevious.Where(e => e.Kind == WebEvent.Pageview).Select(e => e.VisitorId).Distinct().CountAsync(ct),
            Sessions: await views.Select(e => e.SessionId).Distinct().CountAsync(ct),
            Clicks: await clicks.CountAsync(ct),
            SignupClicks: await clicks.CountAsync(e => e.Target != null && e.Target.Contains("signup=1"), ct),
            Actions: await actions.CountAsync(ct),
            ActiveWebUsers: await actions.Where(e => e.UserId != null).Select(e => e.UserId).Distinct().CountAsync(ct),
            PageviewsPerDay: await DailySeries(views.Select(e => e.OccurredAtUtc), range, ct),
            TopPages: topPages,
            TopReferrers: referrers,
            TopClicks: topClicks,
            Devices: devices,
            TopActions: topActions,
            RecentActions: recent);
    }

    /// <summary>Top-N groups by count, ties broken by label so the order is stable between refreshes.</summary>
    private static async Task<IReadOnlyList<CategoryCountDto>> Ranked(
        IQueryable<IGrouping<string, WebEvent>> groups, CancellationToken ct)
    {
        var rows = await groups.Select(g => new { Label = g.Key, Count = g.Count() }).ToListAsync(ct);
        return [.. rows.OrderByDescending(r => r.Count)
                       .ThenBy(r => r.Label, StringComparer.Ordinal)
                       .Take(TopTrafficCount)
                       .Select(r => new CategoryCountDto(r.Label, r.Count))];
    }

    private async Task<UserMetricsDto> BuildUserMetrics(
        AnalyticsRange range, AnalyticsRange previous, DateTime activeSince, CancellationToken ct)
    {
        var utcNow = _clock.UtcNow;

        return new UserMetricsDto(
            TotalUsers: await _db.Users.CountAsync(ct),
            NewUsers: await _db.Users.CountAsync(u => u.CreatedAt >= range.FromUtc && u.CreatedAt < range.ToUtc, ct),
            NewUsersPrevious: await _db.Users.CountAsync(u => u.CreatedAt >= previous.FromUtc && u.CreatedAt < previous.ToUtc, ct),
            ActiveUsers: await _db.Users.CountAsync(u => u.LastLoginAt != null && u.LastLoginAt >= activeSince, ct),
            ActiveUsersPrevious: await _db.Users.CountAsync(
                u => u.LastLoginAt != null
                     && u.LastLoginAt >= activeSince.AddDays(-ActiveWindowDays)
                     && u.LastLoginAt < activeSince, ct),
            GoogleVerifiedUsers: await _db.Users.CountAsync(u => u.GoogleId != null, ct),
            PasswordOnlyUsers: await _db.Users.CountAsync(u => u.GoogleId == null && u.PasswordHash != null, ct),
            LockedOutUsers: await _db.Users.CountAsync(u => u.LockoutEndAt != null && u.LockoutEndAt > utcNow, ct),
            DeactivatedUsers: await _db.Users.CountAsync(u => !u.IsActive, ct));
    }

    private async Task<TranscriptionMetricsDto> BuildTranscriptionMetrics(
        AnalyticsRange range, AnalyticsRange previous, CancellationToken ct)
    {
        var inRange = _db.Transcriptions.Where(t => t.CreatedAtUtc >= range.FromUtc && t.CreatedAtUtc < range.ToUtc);

        var succeeded = await inRange.CountAsync(t => t.Status == TranscriptionStatus.Done, ct);
        var failed = await inRange.CountAsync(t => t.Status == TranscriptionStatus.Failed, ct);
        var inFlight = await inRange.CountAsync(
            t => t.Status == TranscriptionStatus.Pending || t.Status == TranscriptionStatus.Processing, ct);

        var terminal = succeeded + failed;

        // AverageAsync over an empty set throws on some providers and returns NaN on others, so the
        // emptiness check happens here rather than being left to the database.
        double? averageConfidence = succeeded == 0
            ? null
            : Math.Round(
                await inRange.Where(t => t.Status == TranscriptionStatus.Done)
                             .AverageAsync(t => t.OverallConfidence, ct), 4);

        // Storage is an all-time figure, not windowed: it answers "how much are we holding right
        // now". Summed in the database as the MusicXml character length; audio is deleted per job,
        // so this is the complete stored footprint. Sum over no rows is null on Npgsql, hence ?? 0.
        var storedBytes = await _db.Transcriptions
            .SumAsync(t => (long?)t.MusicXml.Length, ct) ?? 0L;

        return new TranscriptionMetricsDto(
            TotalSaved: await inRange.CountAsync(ct),
            TotalSavedPrevious: await _db.Transcriptions.CountAsync(
                t => t.CreatedAtUtc >= previous.FromUtc && t.CreatedAtUtc < previous.ToUtc, ct),
            SucceededCount: succeeded,
            FailedCount: failed,
            InFlightCount: inFlight,
            SuccessRate: terminal == 0 ? null : Math.Round(succeeded / (double)terminal, 4),
            AverageConfidence: averageConfidence,
            StoredBytes: storedBytes,
            TotalTranscribed: await Common.TranscriptionCounts.InWindowAsync(_db, range.FromUtc, range.ToUtc, ct),
            TotalTranscribedPrevious: await Common.TranscriptionCounts.InWindowAsync(_db, previous.FromUtc, previous.ToUtc, ct));
    }

    /// <summary>
    /// Buckets a stream of UTC instants into reporting-local days, zero-filling every day in the
    /// window so a gap in activity renders as a zero rather than vanishing from the chart.
    /// </summary>
    private static async Task<IReadOnlyList<DailyCountDto>> DailySeries(
        IQueryable<DateTime> timestamps, AnalyticsRange range, CancellationToken ct)
    {
        var rows = await timestamps.ToListAsync(ct);

        var counts = rows
            .GroupBy(AnalyticsRange.LocalDateOf)
            .ToDictionary(g => g.Key, g => g.Count());

        return [.. range.LocalDates().Select(d => new DailyCountDto(d, counts.GetValueOrDefault(d)))];
    }

    /// <summary>
    /// How accounts were created. "Both" matters separately from "Google": those users linked a
    /// Google identity to an existing password account, and collapsing them into either bucket
    /// would overstate that route.
    /// </summary>
    private async Task<IReadOnlyList<CategoryCountDto>> BuildSignupMethods(CancellationToken ct)
    {
        var googleOnly = await _db.Users.CountAsync(u => u.GoogleId != null && u.PasswordHash == null, ct);
        var passwordOnly = await _db.Users.CountAsync(u => u.GoogleId == null && u.PasswordHash != null, ct);
        var both = await _db.Users.CountAsync(u => u.GoogleId != null && u.PasswordHash != null, ct);

        return
        [
            new CategoryCountDto("Google", googleOnly),
            new CategoryCountDto("Password", passwordOnly),
            new CategoryCountDto("Both", both)
        ];
    }

    private async Task<IReadOnlyList<CategoryCountDto>> BuildDevicePlatforms(CancellationToken ct)
    {
        var rows = await _db.DeviceTokens
            .GroupBy(d => d.Platform)
            .Select(g => new { Platform = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        return [.. rows.OrderByDescending(r => r.Count)
                       .Select(r => new CategoryCountDto(r.Platform, r.Count))];
    }

    /// <summary>
    /// The most-transcribed keys.
    /// </summary>
    /// <remarks>
    /// Grouped on the tonic and mode columns rather than on <c>Key</c> itself: the value object is
    /// mapped as an owned type, and projecting an owned type without its owner is rejected outright
    /// by a tracking query. Both properties are flattened onto the transcriptions table, so this is
    /// a plain scalar GROUP BY. The label is rebuilt through <see cref="MusicalKey"/> so the naming
    /// stays in the value object instead of a second pitch-name table living here.
    /// </remarks>
    private async Task<IReadOnlyList<CategoryCountDto>> BuildTopKeys(CancellationToken ct)
    {
        var rows = await _db.Transcriptions
            .GroupBy(t => new { t.Key.TonicPitchClass, t.Key.Mode })
            .Select(g => new { g.Key.TonicPitchClass, g.Key.Mode, Count = g.Count() })
            .ToListAsync(ct);

        return [.. rows.Select(r => new CategoryCountDto(
                           new MusicalKey(r.TonicPitchClass, r.Mode).ToString(), r.Count))
                       .OrderByDescending(c => c.Count)
                       .ThenBy(c => c.Label, StringComparer.Ordinal)
                       .Take(TopKeyCount)];
    }

    /// <summary>
    /// Weekly signup cohorts and the share of each that came back after the day they joined.
    /// </summary>
    /// <remarks>
    /// <b>Accuracy limit.</b> The schema keeps only the latest <c>LastLoginAt</c>, not a login
    /// history, so this answers "did they ever return" and cannot answer "were they active in week
    /// three". A true D1/D7/D30 curve needs a per-session event table, which does not exist yet.
    /// The DTO is named <c>RetentionRate</c> rather than anything implying a day-N curve so the
    /// dashboard cannot accidentally present it as one.
    /// </remarks>
    private async Task<IReadOnlyList<RetentionCohortDto>> BuildRetention(DateTime utcNow, CancellationToken ct)
    {
        var since = utcNow.AddDays(-7 * RetentionWeeks);

        var rows = await _db.Users
            .Where(u => u.CreatedAt >= since)
            .Select(u => new { u.CreatedAt, u.LastLoginAt })
            .ToListAsync(ct);

        var cohorts = rows
            .GroupBy(r => StartOfLocalWeek(AnalyticsRange.LocalDateOf(r.CreatedAt)))
            .Select(g =>
            {
                var size = g.Count();
                var returned = g.Count(r =>
                    r.LastLoginAt is { } last
                    && AnalyticsRange.LocalDateOf(last) > AnalyticsRange.LocalDateOf(r.CreatedAt));

                return new RetentionCohortDto(
                    g.Key,
                    size,
                    returned,
                    size == 0 ? null : Math.Round(returned / (double)size, 4));
            })
            .OrderBy(c => c.CohortStart);

        return [.. cohorts];
    }

    /// <summary>Monday-anchored week start, so cohorts line up with how the business reads a week.</summary>
    private static DateOnly StartOfLocalWeek(DateOnly date)
    {
        var offset = ((int)date.DayOfWeek + 6) % 7; // Monday = 0
        return date.AddDays(-offset);
    }

    /// <summary>
    /// The newest real events across the platform, interleaved into one feed for the dashboard.
    /// </summary>
    /// <remarks>
    /// Three sources — new accounts, saved transcriptions, and latest sign-ins — are each capped at
    /// the feed length in the database, then merged and re-capped in memory. Pulling only the top
    /// N per source keeps the query bounded regardless of table size; the final sort across the
    /// (at most 3N) rows is what produces the true chronological order. A login item uses the
    /// account's stored <c>LastLoginAt</c>, so an account appears as a login at most once — the
    /// schema keeps no earlier sign-ins to show.
    /// </remarks>
    private async Task<IReadOnlyList<ActivityItemDto>> BuildRecentActivity(CancellationToken ct)
    {
        var signups = await _db.Users
            .OrderByDescending(u => u.CreatedAt)
            .Take(RecentActivityCount)
            .Select(u => new ActivityItemDto("signup", u.FullName, u.Email, u.CreatedAt, u.Id, u.Email, u.Country))
            .ToListAsync(ct);

        var saves = await _db.Transcriptions
            .OrderByDescending(t => t.CreatedAtUtc)
            .Take(RecentActivityCount)
            .Select(t => new { t.Title, t.CreatedAtUtc, User = _db.Users.FirstOrDefault(u => u.Id == t.UserId) })
            .ToListAsync(ct);

        var saveDtos = saves.Where(s => s.User != null).Select(s => new ActivityItemDto("transcription", s.User!.FullName, $"{s.User.Email} • {s.Title}", s.CreatedAtUtc, s.User.Id, s.User.Email, s.User.Country)).ToList();

        var logins = await _db.Users
            .Where(u => u.LastLoginAt != null)
            .OrderByDescending(u => u.LastLoginAt)
            .Take(RecentActivityCount)
            .Select(u => new ActivityItemDto("login", u.FullName, u.Email, u.LastLoginAt!.Value, u.Id, u.Email, u.Country))
            .ToListAsync(ct);

        var payments = await _db.PaymentTransactions
            .Where(p => p.Status == NoteFusion.Core.Enums.PaymentStatus.Completed)
            .OrderByDescending(p => p.CreatedAtUtc)
            .Take(RecentActivityCount)
            .Select(p => new { p.CreatedAtUtc, User = _db.Users.FirstOrDefault(u => u.Id == p.UserId) })
            .ToListAsync(ct);

        var paymentDtos = payments.Where(p => p.User != null).Select(p => new ActivityItemDto("payment", p.User!.FullName, p.User.Email, p.CreatedAtUtc, p.User.Id, p.User.Email, p.User.Country)).ToList();

        return
        [
            .. signups
                .Concat(saveDtos)
                .Concat(logins)
                .Concat(paymentDtos)
                .OrderByDescending(a => a.OccurredAtUtc)
                .Take(RecentActivityCount)
        ];
    }
}
