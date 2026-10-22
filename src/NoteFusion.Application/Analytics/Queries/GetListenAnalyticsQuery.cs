using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Analytics.Queries;

/// <summary>
/// The console's Listen from anywhere page for a window (default the last 30 days). See <see cref="ListenAnalyticsDto"/>.
/// </summary>
/// <param name="From">Inclusive start date (WAT). Null means <paramref name="To"/> minus 30 days.</param>
/// <param name="To">Inclusive end date (WAT). Null means now.</param>
public sealed record GetListenAnalyticsQuery(DateTime? From = null, DateTime? To = null)
    : IRequest<Result<ListenAnalyticsDto>>;

/// <remarks>
/// The events are the native service's and the app's own (<c>listen_*</c> names, see mobile lib/appEvents): a take's
/// start, its end with why and whether it was sent, the reminders, refusals and settings. A sent take's job is named by
/// <c>listen_take_queued</c>, which is how a take is followed to a finished sheet. Folded in memory, as the console's
/// other analytics are, so it reads the same on Npgsql and on the tests' SQLite.
/// </remarks>
public sealed class GetListenAnalyticsQueryHandler : IRequestHandler<GetListenAnalyticsQuery, Result<ListenAnalyticsDto>>
{
    private const int DefaultWindowDays = 30;

    /// <summary>A Pro-lock tap converts when its account pays for Pro (or a choir) within this many days.</summary>
    public const int UpgradeWindowDays = 7;

    public const string TakeStart = "listen_take_start";
    public const string TakeEnd = "listen_take_end";
    public const string TakeQueued = "listen_take_queued";
    public const string TakeRefused = "listen_take_refused";
    public const string Reminder = "listen_reminder";
    public const string Setting = "listen_setting";
    public const string ProLock = "listen_pro_lock";

    private static readonly string[] SelfEndings = ["cap", "music_stopped", "nothing_heard"];

    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetListenAnalyticsQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    private sealed record Row(Guid UserId, string Name, IReadOnlyDictionary<string, string> D, DateTime At);

    public async Task<Result<ListenAnalyticsDto>> Handle(GetListenAnalyticsQuery request, CancellationToken ct)
    {
        var rangeResult = AnalyticsRange.Create(request.From, request.To, DefaultWindowDays, _clock.UtcNow);
        if (rangeResult.IsFailure)
            return rangeResult.Error;
        var range = rangeResult.Value;

        var rows = (await _db.AppEvents.AsNoTracking()
                .Where(e => e.Name.StartsWith("listen_") && e.OccurredAtUtc >= range.FromUtc && e.OccurredAtUtc < range.ToUtc)
                .Select(e => new { e.UserId, e.Name, e.Detail, e.OccurredAtUtc })
                .ToListAsync(ct))
            .Select(e => new Row(e.UserId, e.Name, AppEvent.ParseDetail(e.Detail), e.OccurredAtUtc))
            .ToList();

        var starts = rows.Where(r => r.Name == TakeStart).ToList();
        var ends = rows.Where(r => r.Name == TakeEnd).ToList();
        var sent = ends.Where(r => Get(r, "sent") == "1").ToList();

        // ── What the sent takes became ──
        var jobIds = rows.Where(r => r.Name == TakeQueued).Select(r => Get(r, "job")).OfType<string>().Distinct().ToList();
        var jobs = jobIds.Count == 0
            ? []
            : await _db.TranscriptionJobs.AsNoTracking()
                .Where(j => jobIds.Contains(j.JobId))
                .Select(j => new { j.JobId, Settled = j.SettledAtUtc != null, Done = j.ResultJson != null })
                .ToListAsync(ct);
        var done = jobs.Count(j => j.Settled && j.Done);
        var failed = jobs.Count(j => j.Settled && !j.Done);

        var summary = new ListenSummaryDto(
            People: rows.Select(r => r.UserId).Distinct().Count(),
            ProPeople: starts.Where(r => Get(r, "pro") == "1").Select(r => r.UserId).Distinct().Count(),
            TakesStarted: starts.Count,
            TakesSent: sent.Count,
            TakesUnsent: ends.Count - sent.Count,
            Transcriptions: done,
            TranscriptionsFailed: failed,
            TranscriptionsPending: Math.Max(0, jobIds.Count - done - failed),
            Reminders: rows.Count(r => r.Name == Reminder),
            StoppedFromReminder: ends.Count(r => Get(r, "via") == "reminder"),
            EndedByThemselves: ends.Count(r => SelfEndings.Contains(Get(r, "reason"))),
            AverageSentSeconds: sent.Count == 0 ? 0 : (int)Math.Round(sent.Average(r => Int(r, "sec"))),
            CaptureBlocked: rows.Count(r => r.Name == "listen_capture_blocked"),
            ButtonHidden: rows.Count(r => r.Name == "listen_button_hidden"),
            NoticeDismissed: rows.Count(r => r.Name == "listen_notice_dismissed"),
            NoticeHidden: rows.Count(r => r.Name == "listen_notice_hidden"),
            BuySongTaps: rows.Count(r => r.Name == "listen_buy_song"));

        var byEntry = Breakdown(starts, sent, "from", ["bubble", "notification", "tile"]);
        var bySource = Breakdown(starts, sent, "source", ["room", "phone"]);

        var endings = ends
            .GroupBy(r => Get(r, "reason") ?? "unknown")
            .Select(g => new ListenCountDto(g.Key, g.Count(), g.Count(r => Get(r, "sent") == "1")))
            .OrderByDescending(c => c.Count).ThenBy(c => c.Key, StringComparer.Ordinal)
            .ToList();
        var refusals = rows.Where(r => r.Name == TakeRefused)
            .GroupBy(r => Get(r, "reason") ?? "unknown")
            .Select(g => new ListenCountDto(g.Key, g.Count(), 0))
            .OrderByDescending(c => c.Count).ThenBy(c => c.Key, StringComparer.Ordinal)
            .ToList();

        var settings = await SettingsAsync(rows, range.ToUtc, ct);

        var days = new List<ListenDayDto>();
        var first = AnalyticsRange.LocalDateOf(range.FromUtc);
        var last = AnalyticsRange.LocalDateOf(range.ToUtc.AddTicks(-1));
        for (var d = first; d <= last; d = d.AddDays(1))
        {
            var day = d;
            bool On(Row r) => AnalyticsRange.LocalDateOf(r.At) == day;
            days.Add(new ListenDayDto(
                day,
                starts.Count(On),
                sent.Count(On),
                rows.Where(On).Select(r => r.UserId).Distinct().Count()));
        }

        return new ListenAnalyticsDto(range.FromUtc, range.ToUtc, summary, byEntry, bySource, endings, refusals, settings, days);
    }

    /// <summary>
    /// Settings as people left them by the window's end (each account's last word on each switch, from every setting event
    /// kept), and the window's Pro-lock taps with the upgrades that followed them.
    /// </summary>
    private async Task<ListenSettingsDto> SettingsAsync(IReadOnlyList<Row> window, DateTime toUtc, CancellationToken ct)
    {
        var settingRows = (await _db.AppEvents.AsNoTracking()
                .Where(e => e.Name == Setting && e.OccurredAtUtc < toUtc)
                .Select(e => new { e.UserId, e.Detail, e.OccurredAtUtc })
                .ToListAsync(ct))
            .Select(e => new Row(e.UserId, Setting, AppEvent.ParseDetail(e.Detail), e.OccurredAtUtc))
            .ToList();

        int LastOn(string setting) => settingRows
            .Where(r => Get(r, "setting") == setting)
            .GroupBy(r => r.UserId)
            .Count(g => Get(g.OrderBy(r => r.At).Last(), "on") == "1");

        var tile = settingRows.Where(r => Get(r, "setting") == "tile" && Get(r, "on") == "1").Select(r => r.UserId).Distinct().Count();
        var phone = settingRows
            .Where(r => Get(r, "setting") == "source")
            .GroupBy(r => r.UserId)
            .Count(g => Get(g.OrderBy(r => r.At).Last(), "value") == "phone");

        var locks = window.Where(r => r.Name == ProLock).ToList();
        var firstLock = locks.GroupBy(r => r.UserId).ToDictionary(g => g.Key, g => g.Min(r => r.At));
        var upgraded = 0;
        if (firstLock.Count > 0)
        {
            var lockers = firstLock.Keys.ToList();
            var latest = firstLock.Values.Max().AddDays(UpgradeWindowDays);
            var paid = await _db.PaymentTransactions.AsNoTracking()
                .Where(t => lockers.Contains(t.UserId) && t.Status == PaymentStatus.Completed && t.UpdatedAtUtc <= latest)
                .Join(_db.Plans.AsNoTracking(), t => t.PlanId, p => p.Id, (t, p) => new { t.UserId, t.UpdatedAtUtc, p.Interval })
                .ToListAsync(ct);
            upgraded = firstLock.Count(kv => paid.Any(p =>
                p.UserId == kv.Key && p.Interval != BillingInterval.Single
                && p.UpdatedAtUtc >= kv.Value && p.UpdatedAtUtc <= kv.Value.AddDays(UpgradeWindowDays)));
        }

        return new ListenSettingsDto(
            ButtonOn: LastOn("button"),
            NotificationOn: LastOn("notification"),
            TileAdded: tile,
            PhoneSound: phone,
            ProLockTaps: locks.Count,
            ProLockPeople: firstLock.Count,
            UpgradedAfterLock: upgraded);
    }

    /// <summary>Started and sent per value of a key, the known values first (always listed), then any others.</summary>
    private static List<ListenBreakdownDto> Breakdown(List<Row> starts, List<Row> sent, string key, string[] known)
    {
        var keys = known.Concat(starts.Select(r => Get(r, key)).OfType<string>().Except(known)).ToList();
        return keys.Select(k => new ListenBreakdownDto(
                k,
                starts.Count(r => Get(r, key) == k),
                sent.Count(r => Get(r, key) == k),
                starts.Where(r => Get(r, key) == k).Select(r => r.UserId).Distinct().Count()))
            .ToList();
    }

    private static string? Get(Row r, string key) => r.D.TryGetValue(key, out var v) ? v : null;

    private static int Int(Row r, string key) => int.TryParse(Get(r, key), out var v) ? v : 0;
}
