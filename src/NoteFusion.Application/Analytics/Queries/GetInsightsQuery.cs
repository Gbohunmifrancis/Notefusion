using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Analytics.Queries;

/// <summary>
/// The Insights page: one window of customer behaviour, cut by country, platform and plan, shaped for
/// decisions — who comes, who comes back, what they do, how long they stay, where they drop out of the
/// path to paying, and when they are around.
/// </summary>
/// <param name="Country">ISO country code, or null for every country.</param>
/// <param name="Platform">"web" or "app" (where the account signed up, else where its traces are), or null.</param>
/// <param name="Plan">"pro" (has Pro now) or "free", or null.</param>
public sealed record GetInsightsQuery(
    DateTime? From = null, DateTime? To = null, string? Country = null, string? Platform = null, string? Plan = null)
    : IRequest<Result<InsightsDto>>;

public sealed record InsightsFiltersDto(IReadOnlyList<CategoryCountDto> Countries, string? Country, string? Platform, string? Plan);

/// <summary>Headline figures for the filtered population and window.</summary>
public sealed record InsightsKpisDto(
    int Accounts, int NewAccounts, int ActiveAccounts, int Transcriptions, int PaidConversions,
    double? MedianSessionMinutes, double? MedianMinutesToFirstTranscription, double? SuccessRate);

public sealed record DailyActiveDto(DateOnly Date, int New, int Returning);
public sealed record DailySignupsDto(DateOnly Date, int Web, int App);
public sealed record DailyTranscriptionsDto(DateOnly Date, int Recording, int SongLink, int SongUpload, int Preview, int Failed);
public sealed record CountryRowDto(string Country, int Accounts, int Active, int Transcriptions, int Pro);
public sealed record FunnelStepDto(string Step, int Count);
public sealed record HeatCellDto(int Weekday, int Hour, int Count);
public sealed record RetentionRowDto(DateOnly CohortStart, int Size, IReadOnlyList<double?> Weeks);
public sealed record JobDurationDto(string Kind, int Count, double? MedianSeconds, double? P90Seconds);

public sealed record InsightsDto(
    DateTime FromUtc, DateTime ToUtc, int ReportingOffsetMinutes,
    InsightsFiltersDto Filters,
    InsightsKpisDto Kpis,
    IReadOnlyList<DailyActiveDto> DailyActive,
    IReadOnlyList<DailySignupsDto> DailySignups,
    IReadOnlyList<DailyTranscriptionsDto> DailyTranscriptions,
    IReadOnlyList<CountryRowDto> Countries,
    IReadOnlyList<FunnelStepDto> Funnel,
    IReadOnlyList<CategoryCountDto> SessionLengths,
    IReadOnlyList<CategoryCountDto> TimeToFirstTranscription,
    IReadOnlyList<HeatCellDto> Heatmap,
    IReadOnlyList<RetentionRowDto> Retention,
    IReadOnlyList<JobDurationDto> JobDurations);

public sealed class GetInsightsQueryHandler : IRequestHandler<GetInsightsQuery, Result<InsightsDto>>
{
    private const int DefaultWindowDays = 30;
    private const int TopCountries = 10;
    private const int RetentionWeeks = 8;

    /// <summary>The funnel step for accounts that spent every free transcription and so met the paywall.</summary>
    public const string ReachedFreeLimitStep = "Reached the free limit";

    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetInsightsQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    private sealed record Person(Guid Id, DateTime CreatedAt, string? Country, string Platform, bool Pro);

    public async Task<Result<InsightsDto>> Handle(GetInsightsQuery request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var rangeResult = AnalyticsRange.Create(request.From, request.To, DefaultWindowDays, now);
        if (rangeResult.IsFailure)
            return rangeResult.Error;
        var range = rangeResult.Value;
        bool In(DateTime at) => at >= range.FromUtc && at < range.ToUtc;
        var country = string.IsNullOrWhiteSpace(request.Country) ? null : request.Country.Trim().ToUpperInvariant();
        var platform = request.Platform is "web" or "app" ? request.Platform : null;
        var plan = request.Plan is "pro" or "free" ? request.Plan : null;

        // ── The population: customers, with what the filters need to know about each ──
        var users = await _db.RealUsers().AsNoTracking()
            .Select(u => new { u.Id, u.CreatedAt, u.Country, u.SignupSource, Seen = u.LastSeenAtUtc ?? u.LastLoginAt })
            .ToListAsync(ct);
        var phones = (await _db.RealDeviceTokens().Select(d => d.UserId).Distinct().ToListAsync(ct)).ToHashSet();
        var pro = (await _db.RealSubscriptions()
                .Where(s => (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.Canceled) && s.CurrentPeriodEndUtc > now)
                .Select(s => s.UserId).Distinct().ToListAsync(ct)).ToHashSet();
        var everyone = users.Select(u => new Person(u.Id, u.CreatedAt, u.Country?.ToUpperInvariant(),
                u.SignupSource == "mobile" || (u.SignupSource == null && phones.Contains(u.Id)) ? "app" : "web",
                pro.Contains(u.Id)))
            .ToList();

        var countryOptions = everyone.GroupBy(p => p.Country ?? "??")
            .Select(g => new CategoryCountDto(g.Key, g.Count()))
            .OrderByDescending(c => c.Count).ThenBy(c => c.Label, StringComparer.Ordinal).ToList();

        var people = everyone
            .Where(p => country is null || p.Country == country)
            .Where(p => platform is null || p.Platform == platform)
            .Where(p => plan is null || (plan == "pro") == p.Pro)
            .ToDictionary(p => p.Id);
        var ids = people.Keys.ToHashSet();
        var lastSeen = users.Where(u => ids.Contains(u.Id) && u.Seen != null).ToDictionary(u => u.Id, u => u.Seen!.Value);

        // ── What they did: jobs, web events, payments (only the columns needed, within the window) ──
        var allJobs = await _db.RealJobs().AsNoTracking()
            .Select(j => new
            {
                j.UserId, j.Kind, j.CreatedAtUtc, j.SettledAtUtc, Done = j.ResultJson != null,
                Charged = j.TrialConsumedAtUtc != null, j.DeviceFingerprint
            })
            .ToListAsync(ct);
        var jobs = allJobs.Where(j => ids.Contains(j.UserId)).ToList();
        var windowJobs = jobs.Where(j => In(j.CreatedAtUtc)).ToList();

        var events = await _db.RealWebEvents().AsNoTracking()
            .Where(e => e.OccurredAtUtc >= range.FromUtc && e.OccurredAtUtc < range.ToUtc)
            .Select(e => new { e.UserId, e.VisitorId, e.SessionId, e.OccurredAtUtc, e.Kind })
            .ToListAsync(ct);
        var anyFilter = country is not null || platform is not null || plan is not null;
        // Anonymous traffic has no country or plan: it counts only when nothing narrows the population.
        var myEvents = events.Where(e => e.UserId is { } id ? ids.Contains(id) : !anyFilter).ToList();

        var previews = anyFilter
            ? []
            : await _db.RealPreviews().AsNoTracking()
                .Where(p => p.CreatedAtUtc >= range.FromUtc && p.CreatedAtUtc < range.ToUtc)
                .Select(p => new { p.CreatedAtUtc, p.CompletedAtUtc, p.Succeeded })
                .ToListAsync(ct);

        var payments = (await _db.RealPayments().AsNoTracking()
                .Select(p => new { p.UserId, p.Status, p.CreatedAtUtc, Opened = p.CheckoutUrl != null })
                .ToListAsync(ct))
            .Where(p => ids.Contains(p.UserId)).ToList();
        var paidSubs = (await _db.RealSubscriptions().AsNoTracking()
                .Where(s => s.Provider != null)
                .Select(s => new { s.UserId, s.CreatedAtUtc })
                .ToListAsync(ct))
            .Where(s => ids.Contains(s.UserId)).ToList();
        var sheets = (await _db.RealSheets().AsNoTracking().Select(t => new { t.UserId, t.CreatedAtUtc }).ToListAsync(ct))
            .Where(t => ids.Contains(t.UserId)).ToList();

        // ── Activity signals per account: a job, a signed-in web event, or being last seen ──
        var signals = jobs.Select(j => (j.UserId, At: j.CreatedAtUtc))
            .Concat(events.Where(e => e.UserId is { } id && ids.Contains(id)).Select(e => (UserId: e.UserId!.Value, At: e.OccurredAtUtc)))
            .Concat(lastSeen.Select(kv => (UserId: kv.Key, At: kv.Value)))
            .ToList();
        var windowSignals = signals.Where(s => In(s.At)).ToList();

        // Daily active, split into accounts made that day and accounts coming back.
        var dailyActive = range.LocalDates().Select(d =>
        {
            var active = windowSignals.Where(s => AnalyticsRange.LocalDateOf(s.At) == d).Select(s => s.UserId).Distinct().ToList();
            var fresh = active.Count(id => AnalyticsRange.LocalDateOf(people[id].CreatedAt) == d);
            return new DailyActiveDto(d, fresh, active.Count - fresh);
        }).ToList();

        var dailySignups = range.LocalDates().Select(d =>
        {
            var joined = people.Values.Where(p => In(p.CreatedAt) && AnalyticsRange.LocalDateOf(p.CreatedAt) == d).ToList();
            return new DailySignupsDto(d, joined.Count(p => p.Platform == "web"), joined.Count(p => p.Platform == "app"));
        }).ToList();

        var dailyTranscriptions = range.LocalDates().Select(d =>
        {
            var day = windowJobs.Where(j => AnalyticsRange.LocalDateOf(j.CreatedAtUtc) == d).ToList();
            return new DailyTranscriptionsDto(d,
                day.Count(j => j.Done && j.Kind == TranscriptionJobKind.Upload),
                day.Count(j => j.Done && j.Kind == TranscriptionJobKind.Link),
                day.Count(j => j.Done && j.Kind == TranscriptionJobKind.Song),
                previews.Count(p => p.Succeeded && AnalyticsRange.LocalDateOf(p.CreatedAtUtc) == d),
                day.Count(j => !j.Done && j.SettledAtUtc != null)
                    + previews.Count(p => !p.Succeeded && p.CompletedAtUtc != null && AnalyticsRange.LocalDateOf(p.CreatedAtUtc) == d));
        }).ToList();

        // Countries: the top ten by accounts, the rest folded into "Other".
        var activeIds = windowSignals.Select(s => s.UserId).ToHashSet();
        var countryRows = people.Values.GroupBy(p => p.Country ?? "??")
            .Select(g => new CountryRowDto(g.Key, g.Count(), g.Count(p => activeIds.Contains(p.Id)),
                windowJobs.Count(j => j.Done && g.Any(p => p.Id == j.UserId)), g.Count(p => p.Pro)))
            .OrderByDescending(c => c.Accounts).ThenBy(c => c.Country, StringComparer.Ordinal).ToList();
        if (countryRows.Count > TopCountries)
        {
            var rest = countryRows.Skip(TopCountries).ToList();
            countryRows = [.. countryRows.Take(TopCountries),
                new CountryRowDto("Other", rest.Sum(r => r.Accounts), rest.Sum(r => r.Active), rest.Sum(r => r.Transcriptions), rest.Sum(r => r.Pro))];
        }

        // Met the paywall: every free transcription of some week spent, counted as TrialUsage counts them —
        // charged jobs on the account, or on a handset the account submitted from (the gate refuses either),
        // in the free week they were submitted in (FreeTier.WeekStart). Any week ever, not only in the window,
        // like every other step.
        var charged = allJobs.Where(j => j.Charged).ToList();
        var devicesOf = allJobs.Where(j => j.DeviceFingerprint != null)
            .GroupBy(j => j.UserId)
            .ToDictionary(g => g.Key, g => g.Select(j => j.DeviceFingerprint!).ToHashSet(StringComparer.Ordinal));
        bool ReachedFreeLimit(Guid id)
        {
            var devices = devicesOf.GetValueOrDefault(id);
            return charged
                .Where(j => j.UserId == id || (j.DeviceFingerprint != null && devices?.Contains(j.DeviceFingerprint) == true))
                .GroupBy(j => FreeTier.WeekStart(j.CreatedAtUtc))
                .Any(week => week.Count() >= FreeTier.TrialGenerations);
        }

        // The path to paying, for the accounts that signed up in the window.
        var cohort = people.Values.Where(p => In(p.CreatedAt)).Select(p => p.Id).ToHashSet();
        var funnel = new List<FunnelStepDto>
        {
            new("Signed up", cohort.Count),
            new("Transcribed", jobs.Where(j => j.Done && cohort.Contains(j.UserId)).Select(j => j.UserId).Distinct().Count()),
            new("Transcribed twice", jobs.Where(j => j.Done && cohort.Contains(j.UserId)).GroupBy(j => j.UserId).Count(g => g.Count() >= 2)),
            new("Kept a sheet", sheets.Where(t => cohort.Contains(t.UserId)).Select(t => t.UserId).Distinct().Count()),
            new(ReachedFreeLimitStep, cohort.Count(ReachedFreeLimit)),
            new("Opened checkout", payments.Where(p => p.Opened && cohort.Contains(p.UserId)).Select(p => p.UserId).Distinct().Count()),
            new("Paid", paidSubs.Where(s => cohort.Contains(s.UserId)).Select(s => s.UserId).Distinct().Count()),
        };

        // Time spent: web sessions (first to last event), signed-in ones of the population, or all when unfiltered.
        var sessions = myEvents.GroupBy(e => e.SessionId)
            .Select(g => (g.Max(e => e.OccurredAtUtc) - g.Min(e => e.OccurredAtUtc)).TotalMinutes)
            .ToList();
        string[] sessionBuckets = ["Under 1 min", "1–5 min", "5–15 min", "15–30 min", "30+ min"];
        string SessionBucket(double m) => m < 1 ? sessionBuckets[0] : m < 5 ? sessionBuckets[1] : m < 15 ? sessionBuckets[2] : m < 30 ? sessionBuckets[3] : sessionBuckets[4];
        var sessionLengths = sessionBuckets.Select(b => new CategoryCountDto(b, sessions.Count(m => SessionBucket(m) == b))).ToList();

        // Time to a first transcription, for the window's sign-ups.
        var firstJob = jobs.Where(j => j.Done).GroupBy(j => j.UserId).ToDictionary(g => g.Key, g => g.Min(j => j.CreatedAtUtc));
        var waits = cohort.Select(id => firstJob.TryGetValue(id, out var at) ? (at - people[id].CreatedAt).TotalMinutes : (double?)null).ToList();
        string[] waitBuckets = ["Within 10 min", "Within an hour", "Within a day", "Within a week", "Later", "Not yet"];
        string WaitBucket(double? m) => m is null ? waitBuckets[5] : m <= 10 ? waitBuckets[0] : m <= 60 ? waitBuckets[1] : m <= 1440 ? waitBuckets[2] : m <= 10080 ? waitBuckets[3] : waitBuckets[4];
        var timeToFirst = waitBuckets.Select(b => new CategoryCountDto(b, waits.Count(w => WaitBucket(w) == b))).ToList();

        // When people are around: transcriptions and signed-in actions by local weekday and hour.
        var moments = windowJobs.Select(j => j.CreatedAtUtc)
            .Concat(myEvents.Where(e => e.Kind == Core.Entities.WebEvent.Action).Select(e => e.OccurredAtUtc))
            .Select(at => at + AnalyticsRange.ReportingOffset).ToList();
        var heatmap = (from wd in Enumerable.Range(0, 7)
                       from h in Enumerable.Range(0, 24)
                       select new HeatCellDto(wd, h, moments.Count(m => ((int)m.DayOfWeek + 6) % 7 == wd && m.Hour == h))).ToList();

        // Weekly cohorts: of each week's sign-ups, the share active N weeks later (null: not reached yet).
        var since = now.AddDays(-7 * RetentionWeeks);
        var activityDays = signals.GroupBy(s => s.UserId).ToDictionary(g => g.Key, g => g.Select(s => s.At).ToList());
        var retention = people.Values.Where(p => p.CreatedAt >= since)
            .GroupBy(p => StartOfWeek(AnalyticsRange.LocalDateOf(p.CreatedAt)))
            .OrderBy(g => g.Key)
            .Select(g =>
            {
                var weeks = Enumerable.Range(0, RetentionWeeks).Select(w =>
                {
                    var weekStart = g.Key.AddDays(7 * w);
                    if (weekStart > AnalyticsRange.LocalDateOf(now)) return (double?)null;
                    var weekEnd = weekStart.AddDays(7);
                    var back = g.Count(p => activityDays.TryGetValue(p.Id, out var ats)
                        && ats.Any(a => { var d = AnalyticsRange.LocalDateOf(a); return d >= weekStart && d < weekEnd && (w > 0 || d > AnalyticsRange.LocalDateOf(p.CreatedAt)); }));
                    return Math.Round(back / (double)g.Count(), 4);
                }).ToList();
                return new RetentionRowDto(g.Key, g.Count(), weeks);
            }).ToList();

        // How long transcriptions take, from start to settled, by kind.
        static (double? Median, double? P90) Percentiles(List<double> xs)
        {
            if (xs.Count == 0) return (null, null);
            xs.Sort();
            double At(double q) => xs[Math.Min(xs.Count - 1, (int)Math.Floor(q * (xs.Count - 1) + 0.5))];
            return (Math.Round(At(0.5), 1), Math.Round(At(0.9), 1));
        }
        var durations = new[] { (TranscriptionJobKind.Upload, "Recording"), (TranscriptionJobKind.Link, "Song link"), (TranscriptionJobKind.Song, "Song upload") }
            .Select(k =>
            {
                var xs = windowJobs.Where(j => j.Kind == k.Item1 && j.Done && j.SettledAtUtc != null)
                    .Select(j => (j.SettledAtUtc!.Value - j.CreatedAtUtc).TotalSeconds).Where(x => x >= 0).ToList();
                var (median, p90) = Percentiles(xs);
                return new JobDurationDto(k.Item2, xs.Count, median, p90);
            }).ToList();

        var ended = windowJobs.Count(j => j.Done || j.SettledAtUtc != null) + previews.Count(p => p.CompletedAtUtc != null);
        var succeeded = windowJobs.Count(j => j.Done) + previews.Count(p => p.Succeeded);
        var sessionMedian = Percentiles([.. sessions]).Median;
        var waitMedian = Percentiles([.. waits.Where(w => w is not null).Select(w => w!.Value)]).Median;

        var kpis = new InsightsKpisDto(
            Accounts: people.Count,
            NewAccounts: cohort.Count,
            ActiveAccounts: activeIds.Count,
            Transcriptions: succeeded,
            PaidConversions: paidSubs.Where(s => In(s.CreatedAtUtc)).Select(s => s.UserId).Distinct().Count(),
            MedianSessionMinutes: sessionMedian,
            MedianMinutesToFirstTranscription: waitMedian,
            SuccessRate: ended == 0 ? null : Math.Round(succeeded / (double)ended, 4));

        return new InsightsDto(range.FromUtc, range.ToUtc, (int)AnalyticsRange.ReportingOffset.TotalMinutes,
            new InsightsFiltersDto(countryOptions, country, platform, plan), kpis,
            dailyActive, dailySignups, dailyTranscriptions, countryRows, funnel, sessionLengths, timeToFirst, heatmap, retention, durations);
    }

    private static DateOnly StartOfWeek(DateOnly date) => date.AddDays(-(((int)date.DayOfWeek + 6) % 7));
}
