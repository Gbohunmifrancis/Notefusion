using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Web.Commands;
using NoteFusion.Infrastructure.Web;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Analytics;

/// <summary>
/// The console's Traffic page: visits put together from the tracker's events, their sources and tags, filters that
/// pick visits, the series, goals and who is on the site now.
/// </summary>
public class TrafficTests
{
    private static readonly DateTime Now = new(2026, 8, 11, 12, 0, 0, DateTimeKind.Utc);

    private static void Add(
        TestHarness h, string visitor, string session, DateTime at, string kind, string path,
        string? name = null, string? referrer = null, string device = "mobile",
        WebCampaign? campaign = null, string? country = null, string? browser = null, string? os = null)
    {
        var e = WebEvent.TryCreate(kind, name, path, null, referrer, visitor, session, null, device, at)!
            .WithVisit(campaign, country, browser, os);
        h.Db.WebEvents.Add(e);
        h.Db.SaveChanges();
    }

    private static async Task<TrafficDto> Read(TestHarness h, Dictionary<string, string>? filters = null, DateTime? from = null, DateTime? to = null)
    {
        h.Clock.UtcNow = Now;
        var result = await new GetTrafficQueryHandler(h.Db, h.Clock).Handle(new GetTrafficQuery(from, to, filters), default);
        Assert.True(result.IsSuccess);
        return result.Value;
    }

    /// <summary>Three visits by two browsers in the window, one visit the week before.</summary>
    private static void Seed(TestHarness h)
    {
        var t = Now.AddDays(-3);
        // v1, visit a: came from Google on a phone in Nigeria, read two pages, clicked to the app: not a bounce, 90 s.
        Add(h, "v1", "a", t, WebEvent.Pageview, "/blog/how-to-read-tonic-solfa/", referrer: "www.google.com",
            campaign: new WebCampaign("google", "organic", null, null, null, null), country: "NG", browser: "Chrome", os: "Android");
        Add(h, "v1", "a", t.AddSeconds(60), WebEvent.Pageview, "/hymns/abide-with-me", country: "NG", browser: "Chrome", os: "Android");
        Add(h, "v1", "a", t.AddSeconds(90), WebEvent.Click, "/hymns/abide-with-me", name: "Try it free", country: "NG", browser: "Chrome", os: "Android");
        // v1, visit b: came back directly the next day, one page, nothing else: a bounce.
        Add(h, "v1", "b", t.AddDays(1), WebEvent.Pageview, "/", country: "NG", browser: "Chrome", os: "Android");
        // v2: a shared link with ?ref=choir on a desktop in Ghana; opened the app and recorded.
        Add(h, "v2", "c", t, WebEvent.Pageview, "/app", device: "desktop",
            campaign: new WebCampaign(null, null, null, null, null, "choir"), country: "GH", browser: "Safari", os: "macOS");
        Add(h, "v2", "c", t.AddSeconds(30), WebEvent.Action, "/app", name: "Recorded a tune", device: "desktop", country: "GH", browser: "Safari", os: "macOS");
        // The window before: one bounce.
        Add(h, "v3", "d", Now.AddDays(-40), WebEvent.Pageview, "/", referrer: "t.co", country: "US", browser: "Firefox", os: "Windows");
    }

    [Fact]
    public async Task Visits_visitors_bounces_and_length_are_read_from_the_sessions()
    {
        using var h = new TestHarness(Now);
        Seed(h);

        var d = await Read(h);

        Assert.Equal(2, d.Summary.Visitors);
        Assert.Equal(3, d.Summary.Visits);
        Assert.Equal(4, d.Summary.Pageviews);
        Assert.Equal(1, d.Summary.VisitorsPrevious);
        Assert.Equal(1, d.Summary.PageviewsPrevious);
        Assert.Equal(4.0 / 3, d.Summary.ViewsPerVisit!.Value, 6);
        Assert.Equal(1.0 / 3, d.Summary.BounceRate!.Value, 6); // only visit b
        Assert.Equal(1.0, d.Summary.BounceRatePrevious!.Value, 6);
        Assert.Equal((90 + 0 + 30) / 3.0, d.Summary.AvgVisitSeconds!.Value, 6);
        Assert.False(d.Hourly);
        Assert.False(d.Truncated);
        Assert.Equal(4, d.Series.Sum(p => p.Pageviews));
    }

    [Fact]
    public async Task Sources_tags_pages_and_places_are_broken_down_by_visit()
    {
        using var h = new TestHarness(Now);
        Seed(h);

        var d = await Read(h);

        Assert.Equal(("Direct", 2), (d.Sources[0].Label, d.Sources[0].Count)); // visits b and c
        Assert.Contains(d.Sources, r => r.Label == "www.google.com" && r.Count == 1);
        Assert.Equal("google", Assert.Single(d.UtmSources).Label);
        Assert.Equal("organic", Assert.Single(d.UtmMediums).Label);
        Assert.Equal("choir", Assert.Single(d.RefLinks).Label);
        Assert.Empty(d.UtmCampaigns);
        Assert.Contains(d.Pages, r => r.Label == "/blog/how-to-read-tonic-solfa" && r.Count == 1); // the trailing slash is one page
        Assert.Contains(d.EntryPages, r => r.Label == "/blog/how-to-read-tonic-solfa");
        Assert.Contains(d.ExitPages, r => r.Label == "/hymns/abide-with-me");
        Assert.Equal(("NG", 1, 2), (d.Countries[0].Label, d.Countries[0].Visitors, d.Countries[0].Count));
        Assert.Contains(d.Browsers, r => r.Label == "Safari");
        Assert.Contains(d.Systems, r => r.Label == "Android");
        Assert.Equal(["Mobile", "Desktop"], d.Devices.Select(r => r.Label));
    }

    [Fact]
    public async Task A_filter_picks_whole_visits_and_everything_follows_it()
    {
        using var h = new TestHarness(Now);
        Seed(h);

        var google = await Read(h, new() { ["source"] = "WWW.GOOGLE.COM", ["nonsense"] = "x" });
        Assert.Equal(new Dictionary<string, string> { ["source"] = "WWW.GOOGLE.COM" }, google.Filters);
        Assert.Equal(1, google.Summary.Visits);
        Assert.Equal(2, google.Summary.Pageviews); // the visit's second page comes with it
        Assert.Equal(0, google.Summary.VisitsPrevious);

        var hymnReaders = await Read(h, new() { ["page"] = "/hymns/abide-with-me" });
        Assert.Equal(1, hymnReaders.Summary.Visits);

        var ghanaApp = await Read(h, new() { ["country"] = "gh", ["entry"] = "/app" });
        Assert.Equal(1, ghanaApp.Summary.Visitors);
        Assert.Equal("Recorded a tune", Assert.Single(ghanaApp.Goals).Name);
    }

    [Fact]
    public async Task Goals_count_the_visitors_who_did_them_against_all_visitors()
    {
        using var h = new TestHarness(Now);
        Seed(h);

        var d = await Read(h);

        var click = Assert.Single(d.Goals, g => g.Kind == WebEvent.Click);
        Assert.Equal(("Try it free", 1, 1, 0.5), (click.Name, click.Visitors, click.Count, click.Rate));
        Assert.Single(d.Goals, g => g.Kind == WebEvent.Action && g.Name == "Recorded a tune");
    }

    [Fact]
    public async Task A_day_or_two_is_charted_by_the_hour()
    {
        using var h = new TestHarness(Now);
        Add(h, "v1", "a", Now.AddHours(-2), WebEvent.Pageview, "/");
        Add(h, "v2", "b", Now.AddHours(-2).AddMinutes(10), WebEvent.Pageview, "/");

        var today = DateOnly.FromDateTime(Now).ToDateTime(TimeOnly.MinValue);
        var d = await Read(h, from: today, to: today);

        Assert.True(d.Hourly);
        Assert.Equal(24, d.Series.Count);
        var busy = Assert.Single(d.Series, p => p.Pageviews > 0);
        Assert.Equal((2, 2), (busy.Visitors, busy.Pageviews));
        Assert.Equal(11, busy.At.Hour); // 10:00 UTC is 11:00 in Lagos
    }

    [Fact]
    public async Task Live_counts_browsers_seen_in_the_last_minutes_at_their_latest_page()
    {
        using var h = new TestHarness(Now);
        Add(h, "v1", "a", Now.AddMinutes(-4), WebEvent.Pageview, "/");
        Add(h, "v1", "a", Now.AddMinutes(-1), WebEvent.Pageview, "/hymns/");
        Add(h, "v2", "b", Now.AddMinutes(-2), WebEvent.Pageview, "/hymns");
        Add(h, "v3", "c", Now.AddMinutes(-20), WebEvent.Pageview, "/");

        h.Clock.UtcNow = Now;
        var result = await new GetTrafficQueryHandler(h.Db, h.Clock).Handle(new GetTrafficLiveQuery(), default);

        Assert.Equal(2, result.Value.Visitors);
        var page = Assert.Single(result.Value.Pages);
        Assert.Equal(("/hymns", 2), (page.Label, page.Visitors));
    }

    [Fact]
    public async Task A_reader_known_only_by_heartbeats_is_on_the_site_now_but_not_the_team_or_one_gone_quiet()
    {
        using var h = new TestHarness(Now);
        var admin = User.CreateAdmin("Admin", "admin@example.com", "hash", Now.AddDays(-50));
        h.Db.Users.Add(admin);
        h.Db.WebEvents.Add(WebEvent.TryCreate(WebEvent.Pageview, null, "/", null, null, "team", "t", admin.Id, "mobile", Now.AddDays(-3))!);
        h.Db.SaveChanges();
        var presence = new InMemoryWebPresence();
        // Reading one hymn for twenty minutes: its page view is long past, its heartbeats are not.
        Add(h, "reader", "r", Now.AddMinutes(-20), WebEvent.Pageview, "/hymns/amazing-grace");
        presence.Touch("reader", "/hymns/amazing-grace", Now.AddSeconds(-40));
        presence.Touch("team", "/hymns/amazing-grace", Now.AddSeconds(-30));   // the founder's own browser
        presence.Touch("gone", "/", Now.AddMinutes(-3));                        // hid the tab three minutes ago
        Add(h, "clicker", "c", Now.AddMinutes(-1), WebEvent.Pageview, "/tools");

        h.Clock.UtcNow = Now;
        var live = (await new GetTrafficQueryHandler(h.Db, h.Clock, presence).Handle(new GetTrafficLiveQuery(), default)).Value;

        Assert.Equal(2, live.Visitors);
        Assert.Equal(["/hymns/amazing-grace", "/tools"], live.Pages.Select(p => p.Label).Order().ToArray());
    }

    [Fact]
    public async Task A_heartbeat_from_a_bot_or_without_a_page_is_not_kept()
    {
        using var h = new TestHarness(Now);
        var presence = new InMemoryWebPresence();
        var record = new RecordPresenceCommandHandler(presence, h.Clock);

        await record.Handle(new RecordPresenceCommand("v1", "/hymns", "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36"), default);
        await record.Handle(new RecordPresenceCommand("v2", "/hymns", "Mozilla/5.0 (compatible; Googlebot/2.1)"), default);
        await record.Handle(new RecordPresenceCommand("v3", null, null), default);
        await record.Handle(new RecordPresenceCommand(new string('x', 65), "/", null), default);

        Assert.Equal(["v1"], presence.Since(Now.AddMinutes(-1)).Select(b => b.VisitorId).ToArray());
    }
}
