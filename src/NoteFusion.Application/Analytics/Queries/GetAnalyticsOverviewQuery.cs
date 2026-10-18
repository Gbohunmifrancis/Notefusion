using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common;
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

    /// <summary>Keys are ranked for a chart, so the tail is noise. Matches a readable bar count.</summary>
    private const int TopKeyCount = 8;

    /// <summary>Weekly cohorts, capped so the retention chart stays legible.</summary>
    private const int RetentionWeeks = 12;

    /// <summary>Entries in the recent-activity feed. Enough to fill the rail without a scrollbar.</summary>
    private const int RecentActivityCount = 20;

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

        var users = await BuildUserMetrics(range, previous, cancellationToken);
        var transcriptions = await BuildTranscriptionMetrics(range, previous, cancellationToken);

        // Series pull only the timestamp column for the window and bucket in memory. Grouping by a
        // shifted date server-side would have to translate identically on Npgsql and on the SQLite
        // the tests run against, and a divergence there would only show up in production. The
        // window is bounded by AnalyticsRange.MaxDays, so the row count is bounded too.
        var signupsPerDay = await DailySeries(
            _db.RealUsers().Where(u => u.CreatedAt >= range.FromUtc && u.CreatedAt < range.ToUtc)
                     .Select(u => u.CreatedAt),
            range, cancellationToken);

        var transcriptionsPerDay = await DailySeries(
            _db.RealSheets().Where(t => t.CreatedAtUtc >= range.FromUtc && t.CreatedAtUtc < range.ToUtc)
                              .Select(t => t.CreatedAtUtc),
            range, cancellationToken);

        var signupMethods = await BuildSignupMethods(cancellationToken);
        var devicePlatforms = await BuildDevicePlatforms(cancellationToken);
        var topKeys = await BuildTopKeys(range, cancellationToken);
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
        var web = await _db.RealUsers().CountAsync(u => u.SignupSource == "web", ct);
        var mobile = await _db.RealUsers().CountAsync(u => u.SignupSource == "mobile", ct);
        // Accounts from before the stamp (and Google sign-ups, which did not set it): an account that ever
        // registered a phone for push came from the app; one seen only in the web tracker, from the web.
        var unstamped = await _db.RealUsers().Where(u => u.SignupSource == null).Select(u => u.Id).ToListAsync(ct);
        var phones = (await _db.RealDeviceTokens().Where(d => unstamped.Contains(d.UserId)).Select(d => d.UserId).Distinct().ToListAsync(ct)).ToHashSet();
        var browsers = (await _db.RealWebEvents().Where(e => e.UserId != null && unstamped.Contains(e.UserId.Value))
            .Select(e => e.UserId!.Value).Distinct().ToListAsync(ct)).ToHashSet();
        var inferredMobile = unstamped.Count(id => phones.Contains(id));
        var inferredWeb = unstamped.Count(id => !phones.Contains(id) && browsers.Contains(id));
        return
        [
            new CategoryCountDto("Web", web + inferredWeb),
            new CategoryCountDto("Mobile", mobile + inferredMobile),
            new CategoryCountDto("Unknown", unstamped.Count - inferredMobile - inferredWeb)
        ];
    }

    /// <summary>
    /// The website's funnel. Every stage is a count of rows the schema actually keeps — preview jobs,
    /// accounts stamped with a source, claims, saved sheets, share tokens, subscriptions — so each
    /// number can be traced to a table rather than to an event stream that does not exist.
    /// </summary>
    private async Task<WebFunnelDto> BuildWebFunnel(AnalyticsRange range, AnalyticsRange previous, CancellationToken ct)
    {
        var previews = _db.RealPreviews().Where(p => p.CreatedAtUtc >= range.FromUtc && p.CreatedAtUtc < range.ToUtc);
        var webUsers = _db.RealUsers().Where(u => u.SignupSource == "web" && u.CreatedAt >= range.FromUtc && u.CreatedAt < range.ToUtc);

        var webUserIds = await webUsers.Select(u => u.Id).ToListAsync(ct);
        var claimedBy = await _db.RealPreviews()
            .Where(p => p.ClaimedByUserId != null)
            .Select(p => p.ClaimedByUserId!.Value)
            .Distinct()
            .ToListAsync(ct);
        var savers = await _db.KeptSheets()
            .Where(t => webUserIds.Contains(t.UserId))
            .Select(t => t.UserId)
            .Distinct()
            .CountAsync(ct);
        var allWebIds = await _db.RealUsers().Where(u => u.SignupSource == "web").Select(u => u.Id).ToListAsync(ct);
        var proConversions = await _db.RealSubscriptions()
            // Paid only: a gift from the console is not a conversion.
            .Where(s => s.CreatedAtUtc >= range.FromUtc && s.CreatedAtUtc < range.ToUtc && s.Provider != null && allWebIds.Contains(s.UserId))
            .Select(s => s.UserId)
            .Distinct()
            .CountAsync(ct);

        var previewsPerDay = await DailySeries(previews.Select(p => p.CreatedAtUtc), range, ct);

        return new WebFunnelDto(
            Previews: await previews.CountAsync(ct),
            PreviewsPrevious: await _db.RealPreviews().CountAsync(p => p.CreatedAtUtc >= previous.FromUtc && p.CreatedAtUtc < previous.ToUtc, ct),
            PreviewDevices: await previews.Where(p => p.DeviceFingerprint != null).Select(p => p.DeviceFingerprint).Distinct().CountAsync(ct),
            PreviewsSucceeded: await previews.CountAsync(p => p.Succeeded, ct),
            WebSignups: webUserIds.Count,
            WebSignupsPrevious: await _db.RealUsers().CountAsync(u => u.SignupSource == "web" && u.CreatedAt >= previous.FromUtc && u.CreatedAt < previous.ToUtc, ct),
            SignupsFromPreview: webUserIds.Count(id => claimedBy.Contains(id)),
            WebSignupsWhoSaved: savers,
            SharesCreated: await _db.RealSheets().CountAsync(t => t.SharedAtUtc != null && t.SharedAtUtc >= range.FromUtc && t.SharedAtUtc < range.ToUtc, ct),
            ShareViews: await _db.RealSheets().SumAsync(t => (long?)t.ShareViews, ct) ?? 0L,
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
        var rows = await _db.RealSubscriptions()
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

        // Choirs whose plan runs: one paid membership each (the director's), at the choir plan's price, once.
        // Their singers are Pro through a seat nobody paid for separately, so they are reported apart.
        var choirs = await _db.RealChoirs()
            .Where(c => c.CurrentPeriodEndUtc > utcNow)
            .Select(c => new { c.Id, c.PlanId, c.Provider })
            .ToListAsync(ct);
        var choirIds = choirs.Select(c => c.Id).ToList();
        var choirSingers = choirIds.Count == 0
            ? 0
            : await _db.ChoirMembers.CountAsync(m => choirIds.Contains(m.ChoirId), ct);
        var paidChoirs = choirs.Where(c => c.Provider is not null).ToList();

        var runRate = active
            .Where(s => s.Provider is not null && s.CurrentPeriodEndUtc < NoteFusion.Core.Entities.Billing.Subscription.LifetimeEndUtc)
            .Select(s => planById.GetValueOrDefault(s.PlanId))
            .Concat(paidChoirs.Select(c => planById.GetValueOrDefault(c.PlanId)))
            .Where(p => p is not null && p.Interval != BillingInterval.Lifetime)
            .GroupBy(p => p!.Currency)
            .Select(g => new CurrencyAmountDto(g.Key, g.Sum(p => p!.Interval == BillingInterval.Yearly ? p.AmountMinor / 12 : p.AmountMinor)))
            .OrderByDescending(c => c.AmountMinor)
            .ToList();

        var byPlan = active
            .GroupBy(s => s.Provider is null
                ? "Gift"
                : planById.GetValueOrDefault(s.PlanId)?.Name ?? "Unknown plan")
            .Select(g => (g.Key, Count: g.Count()))
            .Concat(choirs
                .GroupBy(c => planById.GetValueOrDefault(c.PlanId)?.Name ?? "Choir")
                .Select(g => (g.Key, Count: g.Count())))
            .GroupBy(g => g.Key)
            .Select(g => new CategoryCountDto(g.Key, g.Sum(x => x.Count)))
            .OrderByDescending(c => c.Count)
            .ToList();

        // Revenue collected counts one-song purchases too (money in is money in); the run-rate above does not,
        // because it is read from memberships and a one-off purchase never starts one.
        var charges = await _db.RealLedger()
            .Where(e => (e.Reason == LedgerEntryReason.SubscriptionCharge || e.Reason == LedgerEntryReason.TranscriptionPurchase)
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
        var spent = await _db.RealJobs()
            .Where(j => j.SongCreditConsumedAtUtc != null && j.SongCreditConsumedAtUtc >= monthStart)
            .Select(j => new { j.UserId, j.ChoirId })
            .ToListAsync(ct);
        // Out of their own twenty; songs drawn from a choir's pool are the choir's, not the singer's.
        var outOfSongs = spent
            .Where(j => j.ChoirId == null)
            .GroupBy(j => j.UserId)
            .Count(g => g.Count() >= NoteFusion.Application.Common.SongCredits.ProMonthlyAllowance);

        return new MembershipDto(
            active.Count + choirs.Count, active.Count - gifted + choirs.Count, gifted, lifetime,
            newMembers, lapsed, revenue, runRate, byPlan, spent.Count, outOfSongs,
            ActiveChoirs: choirs.Count, ChoirSingers: choirSingers);
    }

    private async Task<WebTrafficDto> BuildWebTraffic(AnalyticsRange range, AnalyticsRange previous, CancellationToken ct)
    {
        var inRange = _db.RealWebEvents().Where(e => e.OccurredAtUtc >= range.FromUtc && e.OccurredAtUtc < range.ToUtc);
        var inPrevious = _db.RealWebEvents().Where(e => e.OccurredAtUtc >= previous.FromUtc && e.OccurredAtUtc < previous.ToUtc);
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
        AnalyticsRange range, AnalyticsRange previous, CancellationToken ct)
    {
        var utcNow = _clock.UtcNow;

        return new UserMetricsDto(
            TotalUsers: await _db.RealUsers().CountAsync(ct),
            NewUsers: await _db.RealUsers().CountAsync(u => u.CreatedAt >= range.FromUtc && u.CreatedAt < range.ToUtc, ct),
            NewUsersPrevious: await _db.RealUsers().CountAsync(u => u.CreatedAt >= previous.FromUtc && u.CreatedAt < previous.ToUtc, ct),
            ActiveUsers: await ActiveInAsync(range.FromUtc, range.ToUtc, ct),
            ActiveUsersPrevious: await ActiveInAsync(previous.FromUtc, previous.ToUtc, ct),
            GoogleVerifiedUsers: await _db.RealUsers().CountAsync(u => u.GoogleId != null, ct),
            PasswordOnlyUsers: await _db.RealUsers().CountAsync(u => u.GoogleId == null && u.PasswordHash != null, ct),
            LockedOutUsers: await _db.RealUsers().CountAsync(u => u.LockoutEndAt != null && u.LockoutEndAt > utcNow, ct),
            DeactivatedUsers: await _db.RealUsers().CountAsync(u => !u.IsActive, ct),
            ActiveToday: await _db.RealUsers().CountAsync(u => (u.LastSeenAtUtc ?? u.LastLoginAt) >= LocalMidnightUtc(utcNow), ct));
    }

    /// <summary>The instant local (reporting-time) midnight began today.</summary>
    private static DateTime LocalMidnightUtc(DateTime utcNow)
        => AnalyticsRange.LocalDateOf(utcNow).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc) - AnalyticsRange.ReportingOffset;

    /// <summary>
    /// Accounts that did something in [from, to): started a transcription, used the web app, signed up,
    /// or were last seen (or last signed in) then. "Active" used to be "signed in within 30 days of now",
    /// whatever window was picked, which counted nearly every account and never moved with the dates.
    /// </summary>
    private async Task<int> ActiveInAsync(DateTime fromUtc, DateTime toUtc, CancellationToken ct)
    {
        var ids = new HashSet<Guid>();
        ids.UnionWith(await _db.RealJobs().Where(j => j.CreatedAtUtc >= fromUtc && j.CreatedAtUtc < toUtc)
            .Select(j => j.UserId).Distinct().ToListAsync(ct));
        ids.UnionWith(await _db.RealWebEvents().Where(e => e.UserId != null && e.OccurredAtUtc >= fromUtc && e.OccurredAtUtc < toUtc)
            .Select(e => e.UserId!.Value).Distinct().ToListAsync(ct));
        ids.UnionWith(await _db.RealUsers().Where(u =>
                (u.CreatedAt >= fromUtc && u.CreatedAt < toUtc)
                || ((u.LastSeenAtUtc ?? u.LastLoginAt) >= fromUtc && (u.LastSeenAtUtc ?? u.LastLoginAt) < toUtc))
            .Select(u => u.Id).ToListAsync(ct));
        return ids.Count;
    }

    private async Task<TranscriptionMetricsDto> BuildTranscriptionMetrics(
        AnalyticsRange range, AnalyticsRange previous, CancellationToken ct)
    {
        var inRange = _db.RealSheets().Where(t => t.CreatedAtUtc >= range.FromUtc && t.CreatedAtUtc < range.ToUtc);

        // Outcomes come from the jobs themselves — account transcriptions and free previews — not from
        // saved sheets: a sheet only exists for a job that worked, so counting sheets could never show a
        // failure and stopped at however many people pressed Save.
        var jobs = _db.RealJobs().Where(j => j.CreatedAtUtc >= range.FromUtc && j.CreatedAtUtc < range.ToUtc);
        var previews = _db.RealPreviews().Where(p => p.CreatedAtUtc >= range.FromUtc && p.CreatedAtUtc < range.ToUtc);
        var succeeded = await jobs.CountAsync(j => j.ResultJson != null, ct)
            + await previews.CountAsync(p => p.Succeeded, ct);
        var failed = await jobs.CountAsync(j => j.ResultJson == null && j.SettledAtUtc != null, ct)
            + await previews.CountAsync(p => p.CompletedAtUtc != null && !p.Succeeded, ct);
        var inFlight = await jobs.CountAsync(j => j.ResultJson == null && j.SettledAtUtc == null, ct)
            + await previews.CountAsync(p => p.CompletedAtUtc == null, ct);

        var terminal = succeeded + failed;

        // Confidence is read from the sheets that were kept. AverageAsync over an empty set throws on
        // some providers and returns NaN on others, so the emptiness check happens here.
        var savedCount = await inRange.CountAsync(ct);
        double? averageConfidence = savedCount == 0
            ? null
            : Math.Round(await inRange.AverageAsync(t => t.OverallConfidence, ct), 4);

        // Storage is an all-time figure, not windowed: it answers "how much are we holding right
        // now". Summed in the database as the MusicXml character length; audio is deleted per job,
        // so this is the complete stored footprint. Sum over no rows is null on Npgsql, hence ?? 0.
        var storedBytes = await _db.RealSheets()
            .SumAsync(t => (long?)t.MusicXml.Length, ct) ?? 0L;

        return new TranscriptionMetricsDto(
            TotalSaved: await inRange.CountAsync(ct),
            TotalSavedPrevious: await _db.RealSheets().CountAsync(
                t => t.CreatedAtUtc >= previous.FromUtc && t.CreatedAtUtc < previous.ToUtc, ct),
            SucceededCount: succeeded,
            FailedCount: failed,
            InFlightCount: inFlight,
            SuccessRate: terminal == 0 ? null : Math.Round(succeeded / (double)terminal, 4),
            AverageConfidence: averageConfidence,
            StoredBytes: storedBytes,
            TotalTranscribed: await Common.TranscriptionCounts.InWindowAsync(_db, range.FromUtc, range.ToUtc, ct),
            TotalTranscribedPrevious: await Common.TranscriptionCounts.InWindowAsync(_db, previous.FromUtc, previous.ToUtc, ct),
            // How often hymn recognition fires, and how often the hymnbook version is taken. The cached result is
            // camelCase JSON with nulls written out, so an offer is the one place an object follows the name.
            HymnMatchesOffered: await jobs.CountAsync(j => j.ResultJson != null && j.ResultJson.Contains("\"hymnMatch\":{"), ct),
            HymnVersionsSaved: await inRange.CountAsync(t => t.HymnSlug != null, ct));
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
        var googleOnly = await _db.RealUsers().CountAsync(u => u.GoogleId != null && u.PasswordHash == null, ct);
        var passwordOnly = await _db.RealUsers().CountAsync(u => u.GoogleId == null && u.PasswordHash != null, ct);
        var both = await _db.RealUsers().CountAsync(u => u.GoogleId != null && u.PasswordHash != null, ct);

        return
        [
            new CategoryCountDto("Google", googleOnly),
            new CategoryCountDto("Password", passwordOnly),
            new CategoryCountDto("Both", both)
        ];
    }

    private async Task<IReadOnlyList<CategoryCountDto>> BuildDevicePlatforms(CancellationToken ct)
    {
        var rows = await _db.RealDeviceTokens()
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
    private async Task<IReadOnlyList<CategoryCountDto>> BuildTopKeys(AnalyticsRange range, CancellationToken ct)
    {
        // The window's sheets, like every other card on the page (it was all-time, so the date picker
        // never moved it). Every finished transcription is now kept, so these are the transcribed keys.
        var rows = await _db.RealSheets()
            .Where(t => t.CreatedAtUtc >= range.FromUtc && t.CreatedAtUtc < range.ToUtc)
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

        var rows = await _db.RealUsers()
            .Where(u => u.CreatedAt >= since)
            .Select(u => new { u.Id, u.CreatedAt, Last = u.LastSeenAtUtc ?? u.LastLoginAt })
            .ToListAsync(ct);
        // The latest transcription per account counts as coming back too: someone who stays signed in
        // and transcribes the next day never signs in again, so a sign-in-only rule missed them.
        var ids = rows.Select(r => r.Id).ToList();
        var lastJob = (await _db.RealJobs().Where(j => ids.Contains(j.UserId))
                .Select(j => new { j.UserId, j.CreatedAtUtc }).ToListAsync(ct))
            .GroupBy(j => j.UserId).ToDictionary(g => g.Key, g => g.Max(j => j.CreatedAtUtc));

        var cohorts = rows
            .GroupBy(r => StartOfLocalWeek(AnalyticsRange.LocalDateOf(r.CreatedAt)))
            .Select(g =>
            {
                var size = g.Count();
                var returned = g.Count(r =>
                {
                    var joined = AnalyticsRange.LocalDateOf(r.CreatedAt);
                    var seen = r.Last is { } last && AnalyticsRange.LocalDateOf(last) > joined;
                    var worked = lastJob.TryGetValue(r.Id, out var job) && AnalyticsRange.LocalDateOf(job) > joined;
                    return seen || worked;
                });

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
    /// The newest things customers did, as one feed: sign-ups, transcriptions that finished or failed,
    /// payments, feedback and sheets shared. Each is a real event with its own timestamp.
    /// </summary>
    /// <remarks>
    /// It used to mix in "signed in", read from each account's single <c>LastLoginAt</c>: one row per
    /// account at most, its time moving whenever they signed in again, and no trace of the sign-ins before,
    /// so the feed reordered history and repeated the same people. Sign-ins are left out; what people did
    /// is what the feed shows. Each source is capped in the database, then merged and re-capped. Times are
    /// stamped UTC so the console never has to guess the zone.
    /// </remarks>
    private async Task<IReadOnlyList<ActivityItemDto>> BuildRecentActivity(CancellationToken ct)
    {
        static DateTime Utc(DateTime at) => DateTime.SpecifyKind(at, DateTimeKind.Utc);
        static string KindName(TranscriptionJobKind kind)
            => kind == TranscriptionJobKind.Link ? "a song link" : kind == TranscriptionJobKind.Song ? "a song upload" : "a recording";

        var signups = await _db.RealUsers()
            .OrderByDescending(u => u.CreatedAt)
            .Take(RecentActivityCount)
            .Select(u => new { u.Id, u.FullName, u.Email, u.Country, u.CreatedAt, u.SignupSource, Google = u.GoogleId != null })
            .ToListAsync(ct);

        var jobs = await _db.RealJobs()
            .Where(j => j.SettledAtUtc != null)
            .OrderByDescending(j => j.SettledAtUtc)
            .Take(RecentActivityCount)
            .Select(j => new { j.UserId, j.Kind, At = j.SettledAtUtc!.Value, Done = j.ResultJson != null })
            .ToListAsync(ct);

        var payments = await _db.RealPayments()
            .Where(p => p.Status == PaymentStatus.Completed)
            .OrderByDescending(p => p.UpdatedAtUtc)
            .Take(RecentActivityCount)
            .Select(p => new { p.UserId, At = p.UpdatedAtUtc, p.AmountMinor, p.Currency })
            .ToListAsync(ct);

        var feedback = await _db.RealFeedback()
            .Where(f => f.Kind == UserFeedback.RatingKind || f.Kind == UserFeedback.FeedbackKind || f.Kind == UserFeedback.TranscriptionKind)
            .OrderByDescending(f => f.CreatedAtUtc)
            .Take(RecentActivityCount)
            .Select(f => new { f.UserId, f.Kind, f.Rating, f.Category, At = f.CreatedAtUtc })
            .ToListAsync(ct);

        var shares = await _db.RealSheets()
            .Where(t => t.SharedAtUtc != null)
            .OrderByDescending(t => t.SharedAtUtc)
            .Take(RecentActivityCount)
            .Select(t => new { t.UserId, t.Title, At = t.SharedAtUtc!.Value })
            .ToListAsync(ct);

        var ids = jobs.Select(j => j.UserId).Concat(payments.Select(p => p.UserId)).Concat(feedback.Select(f => f.UserId))
            .Concat(shares.Select(s => s.UserId)).Distinct().ToList();
        var people = await _db.RealUsers().Where(u => ids.Contains(u.Id))
            .Select(u => new { u.Id, u.FullName, u.Email, u.Country })
            .ToDictionaryAsync(u => u.Id, ct);

        ActivityItemDto? For(Guid userId, string kind, DateTime at, string detail)
            => people.TryGetValue(userId, out var u)
                ? new ActivityItemDto(kind, u.FullName, u.Email, Utc(at), u.Id, u.Email, u.Country, detail)
                : null;

        var items = new List<ActivityItemDto?>();
        items.AddRange(signups.Select(u => new ActivityItemDto("signup", u.FullName, u.Email, Utc(u.CreatedAt), u.Id, u.Email, u.Country,
            $"signed up{(u.SignupSource == "mobile" ? " in the app" : u.SignupSource == "web" ? " on the web" : "")}{(u.Google ? " with Google" : "")}")));
        items.AddRange(jobs.Select(j => j.Done
            ? For(j.UserId, "transcription", j.At, $"transcribed {KindName(j.Kind)}")
            : For(j.UserId, "transcription_failed", j.At, $"had {KindName(j.Kind)} fail to transcribe")));
        items.AddRange(payments.Select(p => For(p.UserId, "payment", p.At, $"paid {FormatMoney(p.AmountMinor, p.Currency)} for Pro")));
        items.AddRange(feedback.Select(f => For(f.UserId, "feedback", f.At, f.Kind switch
        {
            UserFeedback.RatingKind => $"rated the app {f.Rating}★",
            UserFeedback.TranscriptionKind => f.Rating == 5 ? "said a transcription was spot on"
                : $"said a transcription was {(f.Rating == 3 ? "close" : "off")}{(f.Category is { } c ? $" ({c})" : "")}",
            _ => "sent feedback"
        })));
        items.AddRange(shares.Select(s => For(s.UserId, "share", s.At, $"shared “{s.Title}” with a link")));

        // The founder's outreach emails (OutreachService), joined to their accounts here so the sources above
        // are left as they are.
        var outreach = await _db.OutreachMessages
            .Where(m => m.Channel == OutreachChannel.Email && m.Status == OutreachStatus.Sent)
            .OrderByDescending(m => m.CreatedAtUtc)
            .Take(RecentActivityCount)
            .Join(_db.RealUsers(), m => m.UserId, u => u.Id,
                (m, u) => new { u.Id, u.FullName, u.Email, u.Country, m.Segment, At = m.CreatedAtUtc })
            .ToListAsync(ct);
        items.AddRange(outreach.Select(o => new ActivityItemDto("outreach", o.FullName, o.Email, Utc(o.At), o.Id, o.Email, o.Country,
            o.Segment switch
            {
                OutreachSegment.CheckoutAbandoned => "was asked what stopped them getting Pro",
                OutreachSegment.ActiveUser => "was invited to a 10-minute chat",
                OutreachSegment.TriedOnce => "was asked whether their sheet came out right",
                _ => "was asked what's in the way of a first song",
            })));

        return [.. items.OfType<ActivityItemDto>().OrderByDescending(a => a.OccurredAtUtc).Take(RecentActivityCount)];
    }

    private static string FormatMoney(long amountMinor, string currency)
    {
        var symbol = currency.ToUpperInvariant() switch { "NGN" => "₦", "USD" => "$", "GBP" => "£", "EUR" => "€", _ => currency + " " };
        var major = amountMinor / 100m;
        return symbol + major.ToString(major % 1 == 0 ? "#,0" : "#,0.00", System.Globalization.CultureInfo.InvariantCulture);
    }
}
