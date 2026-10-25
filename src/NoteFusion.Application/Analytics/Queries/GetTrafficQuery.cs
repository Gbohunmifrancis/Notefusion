using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Analytics.Queries;

/// <summary>
/// The console's Traffic page for a window: visitors, visits, page views, bounce rate and visit length against the
/// window before, a series, and every breakdown (sources, campaign tags, pages, entry and exit pages, countries,
/// browsers, systems, devices, goals). Dates are inclusive reporting-local days, as on the overview.
/// </summary>
/// <remarks>
/// <para>
/// <b>A visit</b> is one tab session of track.js (<see cref="WebEvent.SessionId"/>) with a page view in the window;
/// <b>a visitor</b> is one browser (<see cref="WebEvent.VisitorId"/>). Customers only (<see cref="AnalyticsScope"/>).
/// </para>
/// <para>
/// <b>Filters pick visits.</b> A visit belongs to the filtered set when it matches every filter: <c>page</c> = it
/// viewed that page, <c>entry</c>/<c>exit</c> = its first/last page, <c>source</c> = the site it came from
/// ("Direct" for none), <c>utmSource</c>, <c>utmMedium</c>, <c>utmCampaign</c>, <c>ref</c> = its link's tags,
/// <c>country</c>, <c>browser</c>, <c>os</c>, <c>device</c> = where and on what it was. A visit's source and tags
/// are the first the tracker sent in it (only a page load's first page view carries them), its country, browser
/// and system the first known. Everything on the page is then read over the filtered visits only.
/// </para>
/// </remarks>
public sealed record GetTrafficQuery(
    DateTime? From = null,
    DateTime? To = null,
    IReadOnlyDictionary<string, string>? Filters = null) : IRequest<Result<TrafficDto>>;

/// <summary>Who is on the site in the last few minutes; not filtered.</summary>
public sealed record GetTrafficLiveQuery : IRequest<Result<TrafficLiveDto>>;

public sealed class GetTrafficQueryHandler :
    IRequestHandler<GetTrafficQuery, Result<TrafficDto>>,
    IRequestHandler<GetTrafficLiveQuery, Result<TrafficLiveDto>>
{
    private const int DefaultWindowDays = 30;
    private const int TopCount = 10;
    private const int GoalCount = 12;

    /// <summary>A window of this many days or fewer is charted by the hour.</summary>
    public const int HourlyUpToDays = 2;

    /// <summary>The most events one read takes; past it the newest are read and the page says so.</summary>
    public const int MaxEvents = 300_000;

    /// <summary>"On the site now" means an event in this many minutes.</summary>
    public const int LiveMinutes = 5;

    public const string Direct = "Direct";
    public const string Unknown = "Unknown";

    /// <summary>The filters a visit can be picked by, as the query string names them.</summary>
    public static readonly IReadOnlySet<string> FilterKeys = new HashSet<string>(StringComparer.Ordinal)
    {
        "page", "entry", "exit", "source", "utmSource", "utmMedium", "utmCampaign", "ref", "country", "browser", "os", "device",
    };

    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetTrafficQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    private sealed record Row(
        string SessionId, string VisitorId, string Kind, string? Name, string Path, string? Referrer, string Device,
        string? Country, string? Browser, string? Os, string? UtmSource, string? UtmMedium, string? UtmCampaign, string? Ref,
        DateTime At);

    /// <summary>One tab session, read from its events in order.</summary>
    private sealed class Visit
    {
        public required string VisitorId { get; init; }
        public required IReadOnlyList<Row> Events { get; init; }
        public required IReadOnlyList<Row> Views { get; init; }
        public string Entry => Views[0].Path;
        public string Exit => Views[^1].Path;
        public string Source { get; init; } = Direct;
        public string? UtmSource { get; init; }
        public string? UtmMedium { get; init; }
        public string? UtmCampaign { get; init; }
        public string? Ref { get; init; }
        public string Country { get; init; } = Unknown;
        public string Browser { get; init; } = Unknown;
        public string Os { get; init; } = Unknown;
        public string Device { get; init; } = "Desktop";
        public bool Bounced => Views.Count == 1 && Events.All(e => e.Kind == WebEvent.Pageview);
        public double Seconds => (Events[^1].At - Events[0].At).TotalSeconds;
    }

    public async Task<Result<TrafficDto>> Handle(GetTrafficQuery request, CancellationToken ct)
    {
        var rangeResult = AnalyticsRange.Create(request.From, request.To, DefaultWindowDays, _clock.UtcNow);
        if (rangeResult.IsFailure)
            return rangeResult.Error;
        var range = rangeResult.Value;
        var filters = Clean(request.Filters);

        var (rows, truncated) = await ReadAsync(range, ct);
        var visits = Visits(rows).Where(v => Matches(v, filters)).ToList();
        var (previousRows, _) = await ReadAsync(range.PreviousPeriod(), ct);
        var previous = Visits(previousRows).Where(v => Matches(v, filters)).ToList();

        var views = visits.SelectMany(v => v.Views).ToList();
        var visitorCount = visits.Select(v => v.VisitorId).Distinct(StringComparer.Ordinal).Count();
        var hourly = range.ToUtc - range.FromUtc <= TimeSpan.FromDays(HourlyUpToDays);

        return new TrafficDto(
            range.FromUtc,
            range.ToUtc,
            (int)AnalyticsRange.ReportingOffset.TotalMinutes,
            hourly,
            filters,
            Summary(visits, previous),
            Series(views, range, hourly),
            Sources: ByVisit(visits, v => v.Source),
            UtmSources: ByVisit(visits, v => v.UtmSource),
            UtmMediums: ByVisit(visits, v => v.UtmMedium),
            UtmCampaigns: ByVisit(visits, v => v.UtmCampaign),
            RefLinks: ByVisit(visits, v => v.Ref),
            Pages: [.. Top(views.GroupBy(r => r.Path, StringComparer.Ordinal)
                .Select(g => new TrafficRowDto(g.Key, g.Select(r => r.VisitorId).Distinct(StringComparer.Ordinal).Count(), g.Count())))],
            EntryPages: ByVisit(visits, v => v.Entry),
            ExitPages: ByVisit(visits, v => v.Exit),
            Countries: ByVisit(visits, v => v.Country),
            Browsers: ByVisit(visits, v => v.Browser),
            Systems: ByVisit(visits, v => v.Os),
            Devices: ByVisit(visits, v => v.Device),
            Goals: Goals(visits, visitorCount),
            Truncated: truncated);
    }

    public async Task<Result<TrafficLiveDto>> Handle(GetTrafficLiveQuery request, CancellationToken ct)
    {
        var since = _clock.UtcNow.AddMinutes(-LiveMinutes);
        var recent = await _db.RealWebEvents()
            .Where(e => e.OccurredAtUtc >= since)
            .Select(e => new { e.VisitorId, e.Path, e.OccurredAtUtc })
            .ToListAsync(ct);
        var latest = recent
            .GroupBy(e => e.VisitorId, StringComparer.Ordinal)
            .Select(g => BlogEvents.NormalisePath(g.MaxBy(e => e.OccurredAtUtc)!.Path))
            .ToList();
        var pages = Top(latest.GroupBy(p => p, StringComparer.Ordinal).Select(g => new TrafficRowDto(g.Key, g.Count(), g.Count())));
        return new TrafficLiveDto(LiveMinutes, latest.Count, [.. pages]);
    }

    /// <summary>Known keys with a value, trimmed; anything else is ignored.</summary>
    private static Dictionary<string, string> Clean(IReadOnlyDictionary<string, string>? filters)
    {
        var clean = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (key, value) in filters ?? new Dictionary<string, string>())
            if (FilterKeys.Contains(key) && !string.IsNullOrWhiteSpace(value))
                clean[key] = value.Trim();
        return clean;
    }

    private async Task<(List<Row> Rows, bool Truncated)> ReadAsync(AnalyticsRange range, CancellationToken ct)
    {
        var rows = await _db.RealWebEvents()
            .Where(e => e.OccurredAtUtc >= range.FromUtc && e.OccurredAtUtc < range.ToUtc)
            .OrderByDescending(e => e.OccurredAtUtc)
            .Take(MaxEvents + 1)
            .Select(e => new Row(
                e.SessionId, e.VisitorId, e.Kind, e.Name, e.Path, e.Referrer, e.Device, e.Country, e.Browser, e.Os,
                e.UtmSource, e.UtmMedium, e.UtmCampaign, e.Ref, e.OccurredAtUtc))
            .ToListAsync(ct);
        var truncated = rows.Count > MaxEvents;
        if (truncated)
            rows.RemoveAt(rows.Count - 1);
        return (rows.Select(r => r with { Path = BlogEvents.NormalisePath(r.Path) }).ToList(), truncated);
    }

    /// <summary>The window's sessions that viewed a page, each with its own attributes.</summary>
    private static IEnumerable<Visit> Visits(List<Row> rows)
    {
        foreach (var session in rows.GroupBy(r => r.SessionId, StringComparer.Ordinal))
        {
            var events = session.OrderBy(r => r.At).ToList();
            var views = events.Where(r => r.Kind == WebEvent.Pageview).ToList();
            if (views.Count == 0)
                continue;
            yield return new Visit
            {
                VisitorId = events[0].VisitorId,
                Events = events,
                Views = views,
                Source = First(events, r => r.Referrer) ?? Direct,
                UtmSource = First(events, r => r.UtmSource),
                UtmMedium = First(events, r => r.UtmMedium),
                UtmCampaign = First(events, r => r.UtmCampaign),
                Ref = First(events, r => r.Ref),
                Country = First(events, r => r.Country) ?? Unknown,
                Browser = First(events, r => r.Browser) ?? Unknown,
                Os = First(events, r => r.Os) ?? Unknown,
                Device = events[0].Device == "mobile" ? "Mobile" : "Desktop",
            };
        }
    }

    private static string? First(List<Row> events, Func<Row, string?> pick)
        => events.Select(pick).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));

    private static bool Matches(Visit v, IReadOnlyDictionary<string, string> filters)
    {
        foreach (var (key, value) in filters)
        {
            var ok = key switch
            {
                "page" => v.Views.Any(r => Same(r.Path, value)),
                "entry" => Same(v.Entry, value),
                "exit" => Same(v.Exit, value),
                "source" => Same(v.Source, value),
                "utmSource" => Same(v.UtmSource, value),
                "utmMedium" => Same(v.UtmMedium, value),
                "utmCampaign" => Same(v.UtmCampaign, value),
                "ref" => Same(v.Ref, value),
                "country" => Same(v.Country, value),
                "browser" => Same(v.Browser, value),
                "os" => Same(v.Os, value),
                "device" => Same(v.Device, value),
                _ => true,
            };
            if (!ok)
                return false;
        }
        return true;
    }

    private static bool Same(string? a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    private static TrafficSummaryDto Summary(List<Visit> visits, List<Visit> previous)
    {
        static int Visitors(List<Visit> vs) => vs.Select(v => v.VisitorId).Distinct(StringComparer.Ordinal).Count();
        static int Views(List<Visit> vs) => vs.Sum(v => v.Views.Count);
        static double? Mean(List<Visit> vs, Func<Visit, double> f) => vs.Count == 0 ? null : vs.Average(f);

        return new TrafficSummaryDto(
            Visitors(visits), Visitors(previous),
            visits.Count, previous.Count,
            Views(visits), Views(previous),
            Mean(visits, v => v.Views.Count), Mean(previous, v => v.Views.Count),
            Mean(visits, v => v.Bounced ? 1 : 0), Mean(previous, v => v.Bounced ? 1 : 0),
            Mean(visits, v => v.Seconds), Mean(previous, v => v.Seconds));
    }

    private static IReadOnlyList<TrafficPointDto> Series(List<Row> views, AnalyticsRange range, bool hourly)
    {
        var offset = AnalyticsRange.ReportingOffset;
        var step = hourly ? TimeSpan.FromHours(1) : TimeSpan.FromDays(1);
        DateTime Bucket(DateTime utc)
        {
            var local = utc + offset;
            return hourly ? new DateTime(local.Year, local.Month, local.Day, local.Hour, 0, 0, DateTimeKind.Unspecified) : local.Date;
        }

        var grouped = views.GroupBy(r => Bucket(r.At))
            .ToDictionary(g => g.Key, g => (Visitors: g.Select(r => r.VisitorId).Distinct(StringComparer.Ordinal).Count(), Views: g.Count()));
        var points = new List<TrafficPointDto>();
        for (var at = Bucket(range.FromUtc); at <= Bucket(range.ToUtc.AddTicks(-1)); at += step)
        {
            var (visitors, count) = grouped.TryGetValue(at, out var c) ? c : (0, 0);
            points.Add(new TrafficPointDto(at, visitors, count));
        }
        return points;
    }

    /// <summary>Visits and their visitors by one attribute; visits without it are left out.</summary>
    private static IReadOnlyList<TrafficRowDto> ByVisit(List<Visit> visits, Func<Visit, string?> key)
        => [.. Top(visits
            .Select(v => (Visit: v, Key: key(v)))
            .Where(x => !string.IsNullOrWhiteSpace(x.Key))
            .GroupBy(x => x.Key!, StringComparer.OrdinalIgnoreCase)
            .Select(g => new TrafficRowDto(g.First().Key!, g.Select(x => x.Visit.VisitorId).Distinct(StringComparer.Ordinal).Count(), g.Count())))];

    private static IEnumerable<TrafficRowDto> Top(IEnumerable<TrafficRowDto> rows, int count = TopCount)
        => rows.OrderByDescending(r => r.Visitors)
            .ThenByDescending(r => r.Count)
            .ThenBy(r => r.Label, StringComparer.Ordinal)
            .Take(count);

    private static IReadOnlyList<TrafficGoalDto> Goals(List<Visit> visits, int visitorCount)
        => [.. visits
            .SelectMany(v => v.Events)
            .Where(e => e.Kind is WebEvent.Action or WebEvent.Click && !string.IsNullOrWhiteSpace(e.Name))
            .GroupBy(e => (e.Kind, e.Name!))
            .Select(g =>
            {
                var who = g.Select(e => e.VisitorId).Distinct(StringComparer.Ordinal).Count();
                return new TrafficGoalDto(g.Key.Kind, g.Key.Item2, who, g.Count(), visitorCount == 0 ? null : (double)who / visitorCount);
            })
            .OrderByDescending(g => g.Visitors)
            .ThenByDescending(g => g.Count)
            .ThenBy(g => g.Name, StringComparer.Ordinal)
            .Take(GoalCount)];
}
