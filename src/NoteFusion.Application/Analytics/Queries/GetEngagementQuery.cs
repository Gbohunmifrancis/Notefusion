using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Analytics.Queries;

/// <summary>One of the most active accounts in a window.</summary>
/// <param name="Score">Transcriptions ×3 + active days ×2 + saved sheets: the leaderboard's order.</param>
public sealed record EngagedUserDto(
    Guid UserId,
    string FullName,
    string Email,
    string? Country,
    bool IsPro,
    int Transcriptions,
    int Saved,
    int ActiveDays,
    int WebSessions,
    DateTime LastActiveUtc,
    int Score);

/// <summary>How engaged accounts were in a window: who, how often, how much and when.</summary>
public sealed record EngagementDto(
    DateTime FromUtc,
    DateTime ToUtc,
    int ActiveUsers,
    int NewActiveUsers,
    int ReturningActiveUsers,
    int Dau,
    int Wau,
    int Mau,
    double AverageDau,
    /// <summary>Average DAU over the window's MAU, 0–1: how many of the month's users come on a given day.</summary>
    double? Stickiness,
    IReadOnlyList<DailyCountDto> DailyActiveUsers,
    IReadOnlyList<EngagedUserDto> TopUsers,
    IReadOnlyList<CategoryCountDto> UsersByTranscriptions,
    IReadOnlyList<CategoryCountDto> TranscriptionsByHour,
    IReadOnlyList<CategoryCountDto> TranscriptionsByWeekday,
    IReadOnlyList<CategoryCountDto> TranscriptionsByClient,
    IReadOnlyList<CategoryCountDto> TranscriptionsByKind);

/// <summary>
/// Engagement over a window (default the last 30 days). An account is active on a day when it ran a
/// transcription, saved a sheet, did something in the web app or signed in that day. Times are bucketed in
/// the dashboard's reporting zone, like the rest of the analytics.
/// </summary>
public sealed record GetEngagementQuery(DateTime? From = null, DateTime? To = null, int Top = 20)
    : IRequest<Result<EngagementDto>>;

public sealed class GetEngagementQueryHandler : IRequestHandler<GetEngagementQuery, Result<EngagementDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetEngagementQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    private sealed record Signal(Guid UserId, DateTime AtUtc);

    public async Task<Result<EngagementDto>> Handle(GetEngagementQuery request, CancellationToken ct)
    {
        var rangeResult = AnalyticsRange.Create(request.From, request.To, 30, _clock.UtcNow);
        if (rangeResult.IsFailure)
            return rangeResult.Error;
        var range = rangeResult.Value;

        // MAU looks back 30 days from the window's end, which may reach before the window's start.
        var monthStart = range.ToUtc.AddDays(-30);
        var since = monthStart < range.FromUtc ? monthStart : range.FromUtc;
        var until = range.ToUtc;

        // Each source pulls only (user, time) for the bounded window; everything else is folded in memory,
        // the same way the overview's series are, so it reads the same on Npgsql and the tests' SQLite.
        var jobs = await _db.RealJobs().AsNoTracking()
            .Where(j => j.CreatedAtUtc >= since && j.CreatedAtUtc < until)
            .Select(j => new { j.UserId, j.CreatedAtUtc, j.JobId, Done = j.ResultJson != null })
            .ToListAsync(ct);
        var saves = await _db.RealSheets().AsNoTracking()
            .Where(t => t.CreatedAtUtc >= since && t.CreatedAtUtc < until)
            .Select(t => new Signal(t.UserId, t.CreatedAtUtc))
            .ToListAsync(ct);
        var web = await _db.RealWebEvents().AsNoTracking()
            .Where(e => e.UserId != null && e.OccurredAtUtc >= since && e.OccurredAtUtc < until)
            .Select(e => new { UserId = e.UserId!.Value, e.OccurredAtUtc, e.SessionId })
            .ToListAsync(ct);
        // The last time each account was seen (any signed-in request), or, before presence was recorded,
        // its last sign-in.
        var logins = await _db.RealUsers().AsNoTracking()
            .Where(u => (u.LastSeenAtUtc ?? u.LastLoginAt) != null
                        && (u.LastSeenAtUtc ?? u.LastLoginAt) >= since && (u.LastSeenAtUtc ?? u.LastLoginAt) < until)
            .Select(u => new Signal(u.Id, (u.LastSeenAtUtc ?? u.LastLoginAt)!.Value))
            .ToListAsync(ct);

        var signals = jobs.Select(j => new Signal(j.UserId, j.CreatedAtUtc))
            .Concat(saves)
            .Concat(web.Select(w => new Signal(w.UserId, w.OccurredAtUtc)))
            .Concat(logins)
            .ToList();
        bool InWindow(DateTime at) => at >= range.FromUtc && at < range.ToUtc;
        var windowSignals = signals.Where(s => InWindow(s.AtUtc)).ToList();

        // Daily active users across the window, zero-filled.
        var activeByDay = windowSignals
            .GroupBy(s => AnalyticsRange.LocalDateOf(s.AtUtc))
            .ToDictionary(g => g.Key, g => g.Select(s => s.UserId).Distinct().Count());
        var daily = range.LocalDates().Select(d => new DailyCountDto(d, activeByDay.GetValueOrDefault(d))).ToList();

        var lastDay = AnalyticsRange.LocalDateOf(range.ToUtc.AddTicks(-1));
        int ActiveSince(DateOnly firstDay) => signals
            .Where(s => AnalyticsRange.LocalDateOf(s.AtUtc) >= firstDay && s.AtUtc < until)
            .Select(s => s.UserId).Distinct().Count();
        var dau = activeByDay.GetValueOrDefault(lastDay);
        var wau = ActiveSince(lastDay.AddDays(-6));
        var mau = ActiveSince(lastDay.AddDays(-29));
        var averageDau = daily.Count == 0 ? 0 : Math.Round(daily.Average(d => d.Count), 2);

        var activeIds = windowSignals.Select(s => s.UserId).Distinct().ToList();
        var accounts = await _db.RealUsers().AsNoTracking()
            .Where(u => activeIds.Contains(u.Id))
            .Select(u => new { u.Id, u.FullName, u.Email, u.Country, u.CreatedAt })
            .ToListAsync(ct);
        var now = _clock.UtcNow;
        var pro = (await _db.RealSubscriptions().AsNoTracking()
                .Where(s => activeIds.Contains(s.UserId)
                    && (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.Canceled)
                    && s.CurrentPeriodEndUtc > now)
                .Select(s => s.UserId).ToListAsync(ct))
            .ToHashSet();
        var newActive = accounts.Count(a => InWindow(a.CreatedAt));

        var windowJobs = jobs.Where(j => InWindow(j.CreatedAtUtc)).ToList();
        var top = accounts
            .Select(a =>
            {
                var transcriptions = windowJobs.Count(j => j.UserId == a.Id && j.Done);
                var saved = saves.Count(s => s.UserId == a.Id && InWindow(s.AtUtc));
                var days = windowSignals.Where(s => s.UserId == a.Id).Select(s => AnalyticsRange.LocalDateOf(s.AtUtc)).Distinct().Count();
                var sessions = web.Where(w => w.UserId == a.Id && InWindow(w.OccurredAtUtc)).Select(w => w.SessionId).Distinct().Count();
                var last = windowSignals.Where(s => s.UserId == a.Id).Max(s => s.AtUtc);
                return new EngagedUserDto(a.Id, a.FullName, a.Email, a.Country, pro.Contains(a.Id),
                    transcriptions, saved, days, sessions, last, transcriptions * 3 + days * 2 + saved);
            })
            .ToList();

        // How much each active account transcribed, in brackets; the zero bucket is "came, did not transcribe".
        string Bucket(int n) => n switch { 0 => "0", 1 => "1", <= 5 => "2–5", <= 10 => "6–10", <= 25 => "11–25", _ => "26+" };
        string[] bucketOrder = ["0", "1", "2–5", "6–10", "11–25", "26+"];
        var buckets = top.GroupBy(u => Bucket(u.Transcriptions)).ToDictionary(g => g.Key, g => g.Count());

        var localTimes = windowJobs.Select(j => j.CreatedAtUtc + AnalyticsRange.ReportingOffset).ToList();
        string[] weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

        var logs = await _db.RealLogs().AsNoTracking()
            .Where(l => l.CreatedAtUtc >= range.FromUtc && l.CreatedAtUtc < range.ToUtc)
            .Select(l => new { l.Client, l.Kind })
            .ToListAsync(ct);
        static IReadOnlyList<CategoryCountDto> Ranked(IEnumerable<string> labels) => [.. labels
            .GroupBy(l => l).Select(g => new CategoryCountDto(g.Key, g.Count()))
            .OrderByDescending(c => c.Count).ThenBy(c => c.Label, StringComparer.Ordinal)];

        return new EngagementDto(
            range.FromUtc, range.ToUtc,
            ActiveUsers: activeIds.Count,
            NewActiveUsers: newActive,
            ReturningActiveUsers: activeIds.Count - newActive,
            Dau: dau, Wau: wau, Mau: mau,
            AverageDau: averageDau,
            Stickiness: mau == 0 ? null : Math.Round(averageDau / mau, 4),
            DailyActiveUsers: daily,
            TopUsers: [.. top.OrderByDescending(u => u.Score).ThenByDescending(u => u.LastActiveUtc).Take(Math.Clamp(request.Top, 1, 100))],
            UsersByTranscriptions: [.. bucketOrder.Select(b => new CategoryCountDto(b, buckets.GetValueOrDefault(b)))],
            TranscriptionsByHour: [.. Enumerable.Range(0, 24).Select(h => new CategoryCountDto($"{h:00}", localTimes.Count(t => t.Hour == h)))],
            TranscriptionsByWeekday: [.. Enumerable.Range(0, 7).Select(d => new CategoryCountDto(weekdays[d],
                localTimes.Count(t => ((int)t.DayOfWeek + 6) % 7 == d)))],
            TranscriptionsByClient: Ranked(logs.Select(l => l.Client == "app" ? "Mobile app" : l.Client == "web" ? "Web" : "Unknown")),
            TranscriptionsByKind: Ranked(logs.Select(l => l.Kind)));
    }
}
