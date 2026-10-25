namespace NoteFusion.Application.Analytics.Dtos;

/// <summary>
/// The console's Traffic page: the website's and the web app's visits, read from the site's own tracker
/// (<c>web_events</c>), customers only. Every figure follows the filters in <see cref="Filters"/>.
/// </summary>
/// <param name="FromUtc">Inclusive start of the window.</param>
/// <param name="ToUtc">Exclusive end of the window.</param>
/// <param name="ReportingOffsetMinutes">The offset the days (or hours) were bucketed in.</param>
/// <param name="Hourly">The series is by hour (a window of two days or less), else by day.</param>
/// <param name="Filters">The filters applied, echoed; empty for all visits.</param>
/// <param name="Summary">The headline numbers, each with the same figure over the window before.</param>
/// <param name="Series">Visitors and page views per day (or hour), zero-filled.</param>
/// <param name="Sources">Where visits came from: the referring site, else "Direct".</param>
/// <param name="UtmSources">The <c>utm_source</c> of tagged links.</param>
/// <param name="UtmMediums">The <c>utm_medium</c> of tagged links.</param>
/// <param name="UtmCampaigns">The <c>utm_campaign</c> of tagged links.</param>
/// <param name="RefLinks">The <c>?ref=</c> (or <c>?via=</c>) of shared links.</param>
/// <param name="Pages">Pages by page views.</param>
/// <param name="EntryPages">The first page of each visit.</param>
/// <param name="ExitPages">The last page of each visit.</param>
/// <param name="Countries">Visits by country (two letters; "Unknown" when the address told nothing).</param>
/// <param name="Browsers">Visits by browser family.</param>
/// <param name="Systems">Visits by operating system family.</param>
/// <param name="Devices">Visits by screen: Mobile or Desktop.</param>
/// <param name="Goals">What visitors went on to do: the web app's actions and the links and buttons clicked.</param>
/// <param name="Truncated">The window held more events than one read takes; the figures cover its newest part.</param>
public sealed record TrafficDto(
    DateTime FromUtc,
    DateTime ToUtc,
    int ReportingOffsetMinutes,
    bool Hourly,
    IReadOnlyDictionary<string, string> Filters,
    TrafficSummaryDto Summary,
    IReadOnlyList<TrafficPointDto> Series,
    IReadOnlyList<TrafficRowDto> Sources,
    IReadOnlyList<TrafficRowDto> UtmSources,
    IReadOnlyList<TrafficRowDto> UtmMediums,
    IReadOnlyList<TrafficRowDto> UtmCampaigns,
    IReadOnlyList<TrafficRowDto> RefLinks,
    IReadOnlyList<TrafficRowDto> Pages,
    IReadOnlyList<TrafficRowDto> EntryPages,
    IReadOnlyList<TrafficRowDto> ExitPages,
    IReadOnlyList<TrafficRowDto> Countries,
    IReadOnlyList<TrafficRowDto> Browsers,
    IReadOnlyList<TrafficRowDto> Systems,
    IReadOnlyList<TrafficRowDto> Devices,
    IReadOnlyList<TrafficGoalDto> Goals,
    bool Truncated);

/// <param name="Visitors">Distinct browsers (the tracker's visitor id) that viewed a page.</param>
/// <param name="Visits">Distinct tab sessions that viewed a page.</param>
/// <param name="Pageviews">Pages viewed.</param>
/// <param name="ViewsPerVisit">Page views per visit; null without visits.</param>
/// <param name="BounceRate">Share of visits that viewed one page and clicked or did nothing (0–1); null without visits.</param>
/// <param name="AvgVisitSeconds">Mean time from a visit's first event to its last (0 for a one-event visit); null without visits.</param>
public sealed record TrafficSummaryDto(
    int Visitors,
    int VisitorsPrevious,
    int Visits,
    int VisitsPrevious,
    int Pageviews,
    int PageviewsPrevious,
    double? ViewsPerVisit,
    double? ViewsPerVisitPrevious,
    double? BounceRate,
    double? BounceRatePrevious,
    double? AvgVisitSeconds,
    double? AvgVisitSecondsPrevious);

/// <param name="At">The bucket's start: a local date at midnight, or a local hour (reporting offset).</param>
public sealed record TrafficPointDto(DateTime At, int Visitors, int Pageviews);

/// <param name="Label">The page, the source, the country code…</param>
/// <param name="Visitors">Distinct browsers.</param>
/// <param name="Count">Page views for the page lists; visits for every other list.</param>
public sealed record TrafficRowDto(string Label, int Visitors, int Count);

/// <param name="Kind">"action" (a named step in the web app) or "click" (a link or button).</param>
/// <param name="Name">The action's name or the control's label.</param>
/// <param name="Visitors">Distinct browsers that did it.</param>
/// <param name="Count">How many times it was done.</param>
/// <param name="Rate">Visitors who did it over all the window's visitors (0–1); null without visitors.</param>
public sealed record TrafficGoalDto(string Kind, string Name, int Visitors, int Count, double? Rate);

/// <summary>Who is on the site right now: browsers with an event in the last <see cref="Minutes"/> minutes.</summary>
/// <param name="Visitors">Distinct browsers.</param>
/// <param name="Pages">Where they are: each browser's latest page.</param>
public sealed record TrafficLiveDto(int Minutes, int Visitors, IReadOnlyList<TrafficRowDto> Pages);
