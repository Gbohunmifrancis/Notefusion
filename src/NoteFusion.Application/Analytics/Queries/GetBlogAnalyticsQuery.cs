using System.Linq.Expressions;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Analytics.Queries;

/// <summary>
/// The blog's funnel for a window: who read the blog and hymn pages, and whether they went on to open the
/// app, sign up, transcribe and pay. Dates are inclusive reporting-local days, as on the overview.
/// </summary>
/// <remarks>
/// <para>
/// <b>Who is counted.</b> A visitor is a browser: track.js's random visitor id (<see cref="WebEvent.VisitorId"/>).
/// Customers only (<see cref="AnalyticsScope"/>): a browser ever signed in as an admin or internal account is
/// left out, and so are internal accounts' jobs, previews and payments.
/// </para>
/// <para>
/// <b>Attribution: first touch, 30 days.</b> The funnel follows the window's <em>new</em> blog visitors: browsers
/// whose first blog or hymn page on record (web events are kept <see cref="TranscriptionLog.RetentionDays"/> days)
/// was viewed in the window. That first page gets the credit for everything the browser does in the
/// <see cref="AttributionWindowDays"/> days after it, even when they run past the window's end. A browser that had
/// read the blog before the window is a returning visitor: counted in the traffic figures, not in the funnel.
/// "Assisted" counts are the looser reading: accounts created in the window whose browser saw any blog page,
/// at any time, before the account was made.
/// </para>
/// <para>
/// <b>How a browser is tied to an account</b>, strongest first: (1) the browser later sent the web app's access
/// token with its events, so its rows carry the account (exact for that browser); (2) the web app's device id,
/// which track.js sends too, made a transcription or claimed a preview for the account (the same browser
/// storage, so near-exact). Neither sees a reader who signs up on another device or in the phone app, so the
/// sign-up, transcription and payment steps are floors. An account that existed before the browser's first blog
/// page is an existing customer reading the blog, never a sign-up from it, and its transcriptions and payments
/// are not credited to the blog either.
/// </para>
/// <para>
/// <b>A read</b> is a page load with at least half the article scrolled past and 30 seconds with the tab
/// visible (<see cref="BlogEvents.IsGenuineRead"/>): the script's <c>blog_read</c> when its own numbers meet that,
/// or its final engagement report when they do. Reads exist only from the day blog-track.js shipped.
/// </para>
/// </remarks>
public sealed record GetBlogAnalyticsQuery(DateTime? From = null, DateTime? To = null) : IRequest<Result<BlogAnalyticsDto>>;

public sealed class GetBlogAnalyticsQueryHandler : IRequestHandler<GetBlogAnalyticsQuery, Result<BlogAnalyticsDto>>
{
    private const int DefaultWindowDays = 30;

    /// <summary>How long after a browser's first blog page a step still counts for the blog.</summary>
    public const int AttributionWindowDays = 30;

    /// <summary>Ranked lists are read at a glance; the per-page table is not cut.</summary>
    private const int TopCount = 10;

    private static readonly string[] BlogActionNames =
        [BlogEvents.View, BlogEvents.Read, BlogEvents.ReadComplete, BlogEvents.Engagement, BlogEvents.CtaClick, BlogEvents.Share, BlogEvents.HymnPlay];

    /// <summary><see cref="BlogEvents.IsContentPath"/> as an expression, so it runs in the database.</summary>
    private static readonly Expression<Func<WebEvent, bool>> OnContent =
        e => e.Path == "/blog" || e.Path.StartsWith("/blog/") || e.Path == "/hymns" || e.Path.StartsWith("/hymns/");

    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetBlogAnalyticsQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    private sealed record Row(string VisitorId, string Kind, string? Name, string Path, string? Detail, string? Referrer, DateTime At);

    /// <summary>One page load, put together from its actions by their shared <c>pv</c>.</summary>
    private sealed class Load
    {
        public required string Visitor { get; init; }
        public required string Path { get; init; }
        public DateTime FirstAt { get; set; }
        public bool ReadReported { get; set; }
        public bool CompleteReported { get; set; }
        public int? EngagedDepth { get; set; }
        public int? EngagedActive { get; set; }
        public bool IsRead => ReadReported || BlogEvents.IsGenuineRead(EngagedDepth, EngagedActive);
        public bool IsComplete => CompleteReported || (EngagedDepth >= BlogEvents.CompleteDepthPercent && EngagedActive >= BlogEvents.ReadActiveSeconds);
    }

    public async Task<Result<BlogAnalyticsDto>> Handle(GetBlogAnalyticsQuery request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var rangeResult = AnalyticsRange.Create(request.From, request.To, DefaultWindowDays, now);
        if (rangeResult.IsFailure)
            return rangeResult.Error;
        var range = rangeResult.Value;
        var window = TimeSpan.FromDays(AttributionWindowDays);

        var content = _db.RealWebEvents().Where(OnContent);

        // ── The window's own activity on the blog and hymn pages: every visitor, new or returning. ──
        var rows = (await content
                .Where(e => e.OccurredAtUtc >= range.FromUtc && e.OccurredAtUtc < range.ToUtc)
                .Where(e => e.Kind == WebEvent.Pageview || (e.Kind == WebEvent.Action && BlogActionNames.Contains(e.Name!)))
                .Select(e => new { e.VisitorId, e.Kind, e.Name, e.Path, e.Detail, e.Referrer, e.OccurredAtUtc })
                .ToListAsync(ct))
            .Select(e => new Row(e.VisitorId, e.Kind, e.Name, BlogEvents.NormalisePath(e.Path), e.Detail, e.Referrer, e.OccurredAtUtc))
            .ToList();

        var views = rows.Where(r => r.Kind == WebEvent.Pageview).ToList();
        var actions = rows.Where(r => r.Kind == WebEvent.Action).ToList();
        var loads = Loads(actions);

        // ── The funnel's cohort: browsers whose first blog page on record is in the window. ──
        var visitors = views.Select(v => v.VisitorId).Distinct().ToList();
        var returning = (await content
                .Where(e => e.Kind == WebEvent.Pageview && e.OccurredAtUtc < range.FromUtc && visitors.Contains(e.VisitorId))
                .Select(e => e.VisitorId)
                .Distinct()
                .ToListAsync(ct))
            .ToHashSet(StringComparer.Ordinal);
        var firstTouch = views
            .Where(v => !returning.Contains(v.VisitorId))
            .GroupBy(v => v.VisitorId)
            .ToDictionary(g => g.Key, g => g.OrderBy(v => v.At).First(), StringComparer.Ordinal);
        var cohort = firstTouch.Keys.ToList();

        // Everything the cohort did inside its attribution windows, on the blog and in the app.
        var windowEnd = range.ToUtc + window;
        var cohortRows = (await _db.RealWebEvents()
                .Where(e => cohort.Contains(e.VisitorId) && e.OccurredAtUtc >= range.FromUtc && e.OccurredAtUtc < windowEnd)
                .Where(e => (e.Kind == WebEvent.Action && BlogActionNames.Contains(e.Name!))
                            || (e.Kind == WebEvent.Pageview && (e.Path == "/app" || e.Path.StartsWith("/app/"))))
                .Select(e => new { e.VisitorId, e.Kind, e.Name, e.Path, e.Detail, e.Referrer, e.OccurredAtUtc })
                .ToListAsync(ct))
            .Select(e => new Row(e.VisitorId, e.Kind, e.Name, BlogEvents.NormalisePath(e.Path), e.Detail, e.Referrer, e.OccurredAtUtc))
            .Where(r => r.At >= firstTouch[r.VisitorId].At && r.At <= firstTouch[r.VisitorId].At + window)
            .ToList();
        var cohortLoads = Loads(cohortRows.Where(r => r.Kind == WebEvent.Action));
        var cohortReaders = cohortLoads.Where(l => l.IsRead).Select(l => l.Visitor).ToHashSet(StringComparer.Ordinal);
        var cohortCta = cohortRows.Where(r => r.Name == BlogEvents.CtaClick).Select(r => r.VisitorId).ToHashSet(StringComparer.Ordinal);
        var cohortApp = cohortRows.Where(r => r.Kind == WebEvent.Pageview && BlogEvents.IsAppPath(r.Path)).Select(r => r.VisitorId).ToHashSet(StringComparer.Ordinal);

        var outcomes = await Outcomes(cohort, firstTouch.ToDictionary(kv => kv.Key, kv => kv.Value.At, StringComparer.Ordinal), window, ct);

        // Where each new visitor came from: the label the script sent with its first page, else the page view's referrer.
        var firstView = cohortRows
            .Where(r => r.Name == BlogEvents.View)
            .GroupBy(r => r.VisitorId)
            .ToDictionary(g => g.Key, g => BlogEvents.ParseDetail(g.OrderBy(r => r.At).First().Detail), StringComparer.Ordinal);
        string SourceOf(string visitor) => firstView.TryGetValue(visitor, out var d) && d.TryGetValue("src", out var s)
            ? BlogEvents.KnownSource(s)
            : BlogEvents.SourceOfHost(firstTouch[visitor].Referrer);

        var assisted = await Assisted(range, ct);

        // ── Per page. ──
        var actionsByPath = actions.ToLookup(a => a.Path);
        var loadsByPath = loads.ToLookup(l => l.Path);
        var entriesByPath = firstTouch.ToLookup(kv => kv.Value.Path, kv => kv.Key);
        var posts = views.Select(v => v.Path).Concat(actions.Select(a => a.Path)).Distinct()
            .Select(path =>
            {
                var pageViews = views.Where(v => v.Path == path).ToList();
                var pageLoads = loadsByPath[path].ToList();
                var pageVisitors = pageViews.Select(v => v.VisitorId).Distinct().Count();
                var readers = pageLoads.Where(l => l.IsRead).Select(l => l.Visitor).Distinct().Count();
                var entries = entriesByPath[path].ToList();
                return new BlogPostRowDto(
                    Path: path,
                    Kind: BlogEvents.KindOf(path),
                    Views: pageViews.Count,
                    Visitors: pageVisitors,
                    Reads: pageLoads.Count(l => l.IsRead),
                    Readers: readers,
                    ReadRate: pageVisitors > 0 ? Math.Min(1.0, (double)readers / pageVisitors) : null,
                    CompleteReads: pageLoads.Count(l => l.IsComplete),
                    AvgActiveSeconds: Mean(pageLoads.Where(l => l.EngagedActive != null).Select(l => (double)l.EngagedActive!.Value)),
                    CtaClicks: actionsByPath[path].Count(a => a.Name == BlogEvents.CtaClick),
                    Shares: actionsByPath[path].Count(a => a.Name == BlogEvents.Share),
                    HymnPlays: actionsByPath[path].Count(a => a.Name == BlogEvents.HymnPlay),
                    EntryVisitors: entries.Count,
                    Signups: entries.Count(outcomes.SignedUp.Contains),
                    Transcribers: entries.Count(outcomes.Transcribed.Contains),
                    Payers: entries.Count(outcomes.Paid.Contains));
            })
            .OrderByDescending(p => p.Views).ThenByDescending(p => p.EntryVisitors).ThenBy(p => p.Path, StringComparer.Ordinal)
            .ToList();

        var readersInRange = loads.Where(l => l.IsRead).Select(l => l.Visitor).Distinct().Count();
        var kpis = new BlogKpisDto(
            Views: views.Count,
            Visitors: visitors.Count,
            NewVisitors: cohort.Count,
            Readers: readersInRange,
            ReadRate: visitors.Count > 0 ? Math.Min(1.0, (double)readersInRange / visitors.Count) : null,
            CompleteReads: loads.Count(l => l.IsComplete),
            AvgActiveSeconds: Mean(loads.Where(l => l.EngagedActive != null).Select(l => (double)l.EngagedActive!.Value)),
            CtaClicks: actions.Count(a => a.Name == BlogEvents.CtaClick),
            SignupsFromBlog: outcomes.SignedUp.Count,
            TranscribersFromBlog: outcomes.Transcribed.Count,
            PayersFromBlog: outcomes.Paid.Count,
            AssistedSignups: assisted.Accounts.Count,
            AssistedTranscribers: assisted.Transcribers,
            AssistedPayers: assisted.Payers);

        const string BrowserJoin = "The browser's own id, kept in its storage (one person on two browsers is two visitors).";
        const string AccountJoin = "The browser later signed in to the web app, or its web-app device id ran a transcription or claimed a preview for the account. Sign-ups on another device or in the phone app are missed, so this is a floor.";
        var funnel = new List<BlogFunnelStageDto>
        {
            new("visitors", "New blog visitors", cohort.Count, false, BrowserJoin + " New: their first blog or hymn page on record was in this window."),
            new("readers", "Read a post", cohort.Count(cohortReaders.Contains), false, $"Half the article scrolled past and {BlogEvents.ReadActiveSeconds} s with the tab visible, within {AttributionWindowDays} days."),
            new("cta", "Clicked to the app", cohort.Count(cohortCta.Contains), false, "Clicked a link to /app on a blog or hymn page (Try it free, Transcribe a song)."),
            new("app", "Opened the app", cohort.Count(cohortApp.Contains), false, $"The same browser viewed /app within {AttributionWindowDays} days of its first blog page."),
            new("signup", "Signed up", outcomes.SignedUp.Count, true, $"An account created within {AttributionWindowDays} days of the first blog page. " + AccountJoin),
            new("transcribed", "Transcribed", outcomes.Transcribed.Count, true, "That account's first transcription or claimed preview, or an anonymous preview from the browser's device id, within the window. A preview needs no account, so this step can be larger than the one before."),
            new("paid", "Paid", outcomes.Paid.Count, true, "A verified payment by that account within the window."),
        };

        var newVisitorsBySource = cohort.GroupBy(SourceOf).ToList();
        var sources = newVisitorsBySource
            .Select(g => new BlogSourceRowDto(g.Key, g.Count(), g.Count(cohortReaders.Contains), g.Count(outcomes.SignedUp.Contains), g.Count(outcomes.Transcribed.Contains)))
            .OrderByDescending(s => s.Visitors).ThenBy(s => s.Source, StringComparer.Ordinal)
            .ToList();

        var topEntries = entriesByPath
            .Select(g => new BlogEntryRowDto(g.Key, g.Count(), g.Count(outcomes.SignedUp.Contains), g.Count(outcomes.Transcribed.Contains), g.Count(outcomes.Paid.Contains)))
            .OrderByDescending(e => e.Signups).ThenByDescending(e => e.Visitors).ThenBy(e => e.Path, StringComparer.Ordinal)
            .Take(TopCount)
            .ToList();

        var campaigns = cohort
            .Where(v => firstView.TryGetValue(v, out var d) && (d.ContainsKey("utm_source") || d.ContainsKey("utm_medium") || d.ContainsKey("utm_campaign")))
            .GroupBy(v => Campaign(firstView[v]))
            .Select(g => new BlogCampaignRowDto(g.Key, g.Count(), g.Count(outcomes.SignedUp.Contains)))
            .OrderByDescending(c => c.Visitors).ThenBy(c => c.Campaign, StringComparer.Ordinal)
            .Take(TopCount)
            .ToList();

        var shares = actions
            .Where(a => a.Name == BlogEvents.Share)
            .GroupBy(a => BlogEvents.ParseDetail(a.Detail).GetValueOrDefault("net") ?? "other")
            .Select(g => new BlogShareRowDto(g.Key, g.Count()))
            .OrderByDescending(s => s.Count).ThenBy(s => s.Network, StringComparer.Ordinal)
            .ToList();

        var viewsPerDay = views.GroupBy(v => AnalyticsRange.LocalDateOf(v.At)).ToDictionary(g => g.Key, g => g.Count());
        var readsPerDay = loads.Where(l => l.IsRead).GroupBy(l => AnalyticsRange.LocalDateOf(l.FirstAt)).ToDictionary(g => g.Key, g => g.Count());
        var signupsPerDay = assisted.Accounts.GroupBy(a => AnalyticsRange.LocalDateOf(a.CreatedAt)).ToDictionary(g => g.Key, g => g.Count());
        var daily = range.LocalDates()
            .Select(d => new BlogDailyDto(d, viewsPerDay.GetValueOrDefault(d), readsPerDay.GetValueOrDefault(d), signupsPerDay.GetValueOrDefault(d)))
            .ToList();

        return new BlogAnalyticsDto(
            range.FromUtc, range.ToUtc, (int)AnalyticsRange.ReportingOffset.TotalMinutes, AttributionWindowDays,
            kpis, funnel, posts, sources, topEntries, campaigns, shares, daily);
    }

    /// <summary>
    /// The page loads behind a set of blog actions, keyed by visitor and the script's page-load id. A read is kept
    /// only when the numbers it reports meet the thresholds; the engagement figures are the largest reported (the
    /// script reports again each time the tab is hidden, with running totals).
    /// </summary>
    private static List<Load> Loads(IEnumerable<Row> actions)
    {
        var byKey = new Dictionary<(string, string), Load>();
        var anonymous = 0;
        foreach (var a in actions.OrderBy(a => a.At))
        {
            var d = BlogEvents.ParseDetail(a.Detail);
            var key = (a.VisitorId, d.TryGetValue("pv", out var pv) ? pv : "#" + anonymous++);
            if (!byKey.TryGetValue(key, out var load))
                byKey[key] = load = new Load { Visitor = a.VisitorId, Path = a.Path, FirstAt = a.At };
            var depth = BlogEvents.Number(d, "depth");
            var active = BlogEvents.Number(d, "active");
            switch (a.Name)
            {
                case BlogEvents.Read:
                    load.ReadReported |= BlogEvents.IsGenuineRead(depth, active);
                    break;
                case BlogEvents.ReadComplete:
                    load.CompleteReported |= depth >= BlogEvents.CompleteDepthPercent && active >= BlogEvents.ReadActiveSeconds;
                    break;
                case BlogEvents.Engagement:
                    load.EngagedDepth = Max(load.EngagedDepth, depth is null ? null : Math.Min(100, depth.Value));
                    load.EngagedActive = Max(load.EngagedActive, active);
                    break;
            }
        }
        return [.. byKey.Values];
    }

    private sealed record Outcome(HashSet<string> SignedUp, HashSet<string> Transcribed, HashSet<string> Paid);

    /// <summary>
    /// Which of the cohort's browsers signed up, transcribed and paid within the window after their first blog
    /// page, through the joins described on the query.
    /// </summary>
    private async Task<Outcome> Outcomes(List<string> cohort, Dictionary<string, DateTime> firstTouch, TimeSpan window, CancellationToken ct)
    {
        var signedUp = new HashSet<string>(StringComparer.Ordinal);
        var transcribed = new HashSet<string>(StringComparer.Ordinal);
        var paid = new HashSet<string>(StringComparer.Ordinal);
        if (cohort.Count == 0)
            return new Outcome(signedUp, transcribed, paid);

        var tokenLinks = await _db.RealWebEvents()
            .Where(e => e.UserId != null && cohort.Contains(e.VisitorId))
            .Select(e => new { e.VisitorId, UserId = e.UserId!.Value })
            .Distinct()
            .ToListAsync(ct);
        var deviceLinks = await _db.RealWebEvents()
            .Where(e => e.DeviceHash != null && cohort.Contains(e.VisitorId))
            .Select(e => new { e.VisitorId, Hash = e.DeviceHash! })
            .Distinct()
            .ToListAsync(ct);
        var hashes = deviceLinks.Select(l => l.Hash).Distinct().ToList();

        var jobDevices = await _db.RealJobs()
            .Where(j => j.DeviceFingerprint != null && hashes.Contains(j.DeviceFingerprint))
            .Select(j => new { Hash = j.DeviceFingerprint!, j.UserId })
            .Distinct()
            .ToListAsync(ct);
        var devicePreviews = await _db.RealPreviews()
            .Where(p => p.DeviceFingerprint != null && hashes.Contains(p.DeviceFingerprint))
            .Select(p => new { Hash = p.DeviceFingerprint!, p.CreatedAtUtc, p.ClaimedByUserId })
            .ToListAsync(ct);

        var usersByHash = jobDevices.Select(j => (j.Hash, j.UserId))
            .Concat(devicePreviews.Where(p => p.ClaimedByUserId != null).Select(p => (p.Hash, p.ClaimedByUserId!.Value)))
            .ToLookup(x => x.Hash, x => x.Item2);
        var hashesByVisitor = deviceLinks.ToLookup(l => l.VisitorId, l => l.Hash);
        var previewsByHash = devicePreviews.ToLookup(p => p.Hash, p => p.CreatedAtUtc);
        var tokenUsers = tokenLinks.ToLookup(l => l.VisitorId, l => l.UserId);

        var linked = cohort.ToDictionary(
            v => v,
            v => tokenUsers[v].Concat(hashesByVisitor[v].SelectMany(h => usersByHash[h])).Distinct().ToList(),
            StringComparer.Ordinal);
        var ids = linked.Values.SelectMany(x => x).Distinct().ToList();
        var nullableIds = ids.Select(id => (Guid?)id).ToList();

        var created = await _db.RealUsers().Where(u => ids.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.CreatedAt, ct);
        var jobs = (await _db.RealJobs().Where(j => ids.Contains(j.UserId)).Select(j => new { j.UserId, j.CreatedAtUtc }).ToListAsync(ct))
            .ToLookup(j => j.UserId, j => j.CreatedAtUtc);
        var claims = (await _db.RealPreviews().Where(p => nullableIds.Contains(p.ClaimedByUserId))
                .Select(p => new { UserId = p.ClaimedByUserId!.Value, p.CreatedAtUtc }).ToListAsync(ct))
            .ToLookup(p => p.UserId, p => p.CreatedAtUtc);
        var payments = (await _db.RealPayments()
                .Where(p => ids.Contains(p.UserId) && (p.Status == PaymentStatus.Verified || p.Status == PaymentStatus.Completed))
                .Select(p => new { p.UserId, p.UpdatedAtUtc }).ToListAsync(ct))
            .ToLookup(p => p.UserId, p => p.UpdatedAtUtc);

        foreach (var visitor in cohort)
        {
            var start = firstTouch[visitor];
            var end = start + window;
            bool InWindow(DateTime t) => t >= start && t <= end;

            var accounts = linked[visitor].Where(created.ContainsKey).ToList();
            var existingCustomer = accounts.Any(a => created[a] < start);
            var account = accounts.Where(a => InWindow(created[a])).OrderBy(a => created[a]).Cast<Guid?>().FirstOrDefault();
            if (account is { } id && !existingCustomer)
            {
                signedUp.Add(visitor);
                if (jobs[id].Any(InWindow) || claims[id].Any(InWindow))
                    transcribed.Add(visitor);
                if (payments[id].Any(InWindow))
                    paid.Add(visitor);
            }
            if (!existingCustomer && hashesByVisitor[visitor].Any(h => previewsByHash[h].Any(InWindow)))
                transcribed.Add(visitor);
        }
        return new Outcome(signedUp, transcribed, paid);
    }

    private sealed record AssistedResult(List<(Guid Id, DateTime CreatedAt)> Accounts, int Transcribers, int Payers);

    /// <summary>Accounts created in the window whose browser (by either join) saw any blog page before the account was made.</summary>
    private async Task<AssistedResult> Assisted(AnalyticsRange range, CancellationToken ct)
    {
        var accounts = await _db.RealUsers()
            .Where(u => u.CreatedAt >= range.FromUtc && u.CreatedAt < range.ToUtc)
            .Select(u => new { u.Id, u.CreatedAt })
            .ToListAsync(ct);
        if (accounts.Count == 0)
            return new AssistedResult([], 0, 0);

        var ids = accounts.Select(a => a.Id).ToList();
        var nullableIds = ids.Select(id => (Guid?)id).ToList();

        var tokenLinks = await _db.RealWebEvents()
            .Where(e => nullableIds.Contains(e.UserId))
            .Select(e => new { e.VisitorId, UserId = e.UserId!.Value })
            .Distinct()
            .ToListAsync(ct);
        var accountHashes = (await _db.RealJobs()
                .Where(j => ids.Contains(j.UserId) && j.DeviceFingerprint != null)
                .Select(j => new { j.UserId, Hash = j.DeviceFingerprint! })
                .Distinct()
                .ToListAsync(ct))
            .Concat(await _db.RealPreviews()
                .Where(p => nullableIds.Contains(p.ClaimedByUserId) && p.DeviceFingerprint != null)
                .Select(p => new { UserId = p.ClaimedByUserId!.Value, Hash = p.DeviceFingerprint! })
                .Distinct()
                .ToListAsync(ct))
            .ToList();
        var hashes = accountHashes.Select(h => h.Hash).Distinct().ToList();
        var hashVisitors = await _db.RealWebEvents()
            .Where(e => e.DeviceHash != null && hashes.Contains(e.DeviceHash))
            .Select(e => new { e.VisitorId, Hash = e.DeviceHash! })
            .Distinct()
            .ToListAsync(ct);

        var visitorsByHash = hashVisitors.ToLookup(h => h.Hash, h => h.VisitorId);
        var visitorsByAccount = tokenLinks.Select(l => (l.UserId, l.VisitorId))
            .Concat(accountHashes.SelectMany(h => visitorsByHash[h.Hash].Select(v => (h.UserId, v))))
            .ToLookup(x => x.Item1, x => x.Item2);
        var visitors = visitorsByAccount.SelectMany(g => g).Distinct().ToList();

        var firstBlog = await _db.RealWebEvents().Where(OnContent)
            .Where(e => e.Kind == WebEvent.Pageview && visitors.Contains(e.VisitorId))
            .GroupBy(e => e.VisitorId)
            .Select(g => new { VisitorId = g.Key, First = g.Min(e => e.OccurredAtUtc) })
            .ToDictionaryAsync(x => x.VisitorId, x => x.First, ct);

        var assisted = accounts
            .Where(a => visitorsByAccount[a.Id].Any(v => firstBlog.TryGetValue(v, out var first) && first < a.CreatedAt))
            .Select(a => (a.Id, a.CreatedAt))
            .ToList();
        if (assisted.Count == 0)
            return new AssistedResult([], 0, 0);

        var assistedIds = assisted.Select(a => a.Id).ToList();
        var assistedNullable = assistedIds.Select(id => (Guid?)id).ToList();
        var withJob = await _db.RealJobs().Where(j => assistedIds.Contains(j.UserId)).Select(j => j.UserId).Distinct().ToListAsync(ct);
        var withClaim = await _db.RealPreviews().Where(p => assistedNullable.Contains(p.ClaimedByUserId)).Select(p => p.ClaimedByUserId!.Value).Distinct().ToListAsync(ct);
        var payers = await _db.RealPayments()
            .Where(p => assistedIds.Contains(p.UserId) && (p.Status == PaymentStatus.Verified || p.Status == PaymentStatus.Completed))
            .Select(p => p.UserId).Distinct().CountAsync(ct);

        return new AssistedResult(assisted, withJob.Union(withClaim).Count(), payers);
    }

    private static string Campaign(IReadOnlyDictionary<string, string> d)
        => $"{d.GetValueOrDefault("utm_source") ?? "—"} / {d.GetValueOrDefault("utm_medium") ?? "—"} / {d.GetValueOrDefault("utm_campaign") ?? "—"}";

    private static int? Max(int? a, int? b) => a is null ? b : b is null ? a : Math.Max(a.Value, b.Value);

    private static double? Mean(IEnumerable<double> values)
    {
        var list = values.ToList();
        return list.Count == 0 ? null : Math.Round(list.Average(), 1);
    }
}
