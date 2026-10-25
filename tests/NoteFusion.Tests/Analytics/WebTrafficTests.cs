using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Web;
using NoteFusion.Application.Web.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Analytics;

/// <summary>The website's own tracker: what the browser posts is kept, and the dashboard reads it back as traffic.</summary>
public class WebTrafficTests
{
    private static readonly DateTime Now = new(2026, 8, 11, 12, 0, 0, DateTimeKind.Utc);

    private static WebEventInput Ev(string kind, string? name = null, string path = "/", string? target = null, string? referrer = null, string device = "desktop", int? ageMs = null)
        => new(kind, name, path, target, referrer, device, ageMs);

    [Fact]
    public async Task A_batch_keeps_the_well_formed_events_and_drops_the_rest()
    {
        using var h = new TestHarness(Now);
        var handler = new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock);

        var result = await handler.Handle(new RecordWebEventsCommand("visitor-a", "session-1",
        [
            Ev("pageview", path: "/", referrer: "google.com"),
            Ev("click", "Sign up", "/", "/app?signup=1"),
            Ev("click", null, "/"),                        // a click with no label is noise
            Ev("hover", "x"),                              // unknown kind
            Ev("action", "Preview started", "/", device: "mobile", ageMs: 4000),
            Ev("pageview", path: new string('p', 500)),   // clipped, not refused
        ]), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(4, result.Value);
        var rows = h.Db.WebEvents.OrderBy(e => e.OccurredAtUtc).ThenBy(e => e.Kind).ToList();
        Assert.Equal(4, rows.Count);
        Assert.All(rows, e => { Assert.Equal("visitor-a", e.VisitorId); Assert.Equal("session-1", e.SessionId); Assert.Null(e.UserId); });
        var action = rows.Single(e => e.Kind == WebEvent.Action);
        Assert.Equal("mobile", action.Device);
        Assert.Equal(Now.AddSeconds(-4), action.OccurredAtUtc);
        Assert.Equal(WebEvent.PathMaxLength, rows.Single(e => e.Path.StartsWith('p')).Path.Length);
        Assert.Equal("/app?signup=1", rows.Single(e => e.Kind == WebEvent.Click).Target);
    }

    [Fact]
    public async Task Events_without_browser_ids_or_an_empty_batch_are_a_no_op()
    {
        using var h = new TestHarness(Now);
        var handler = new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock);

        Assert.Equal(0, (await handler.Handle(new RecordWebEventsCommand(null, "s", [Ev("pageview")]), default)).Value);
        Assert.Equal(0, (await handler.Handle(new RecordWebEventsCommand("v", "s", []), default)).Value);
        Assert.Empty(h.Db.WebEvents);
    }

    [Fact]
    public async Task A_signed_in_browser_attaches_the_account_and_a_batch_is_capped()
    {
        using var h = new TestHarness(Now);
        var user = Guid.NewGuid();
        var handler = new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(user), h.Clock);
        var many = Enumerable.Range(0, RecordWebEventsCommandHandler.MaxBatch + 10).Select(_ => Ev("pageview", path: "/app")).ToList();

        var result = await handler.Handle(new RecordWebEventsCommand("v", "s", many), default);

        Assert.Equal(RecordWebEventsCommandHandler.MaxBatch, result.Value);
        Assert.All(h.Db.WebEvents, e => Assert.Equal(user, e.UserId));
    }

    private const string AndroidChrome = "Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

    private sealed class FixedCountry(string? country) : ICountryResolver
    {
        public int Calls { get; private set; }
        public Task<string?> ResolveAsync(CancellationToken ct = default) { Calls++; return Task.FromResult(country); }
    }

    [Fact]
    public async Task A_visit_keeps_its_link_tags_on_the_first_page_view_and_the_browser_system_and_country_on_every_event()
    {
        using var h = new TestHarness(Now);
        var country = new FixedCountry("ng");
        var handler = new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock, country);

        await handler.Handle(new RecordWebEventsCommand("v", "s",
        [
            Ev("pageview", referrer: "t.co") with { UtmSource = "X", UtmMedium = "Social", UtmCampaign = "Launch tweet", UtmTerm = "solfa app", Ref = "launch" },
            Ev("click", "Try it", "/", "/app") with { UtmSource = "x" },   // tags on anything but a page view are ignored
        ], UserAgent: AndroidChrome), default);

        var view = h.Db.WebEvents.Single(e => e.Kind == WebEvent.Pageview);
        Assert.Equal(("x", "social", "Launch tweet", "solfa app", "launch"), (view.UtmSource, view.UtmMedium, view.UtmCampaign, view.UtmTerm, view.Ref));
        Assert.Null(h.Db.WebEvents.Single(e => e.Kind == WebEvent.Click).UtmSource);
        Assert.All(h.Db.WebEvents, e => Assert.Equal(("NG", "Chrome", "Android"), (e.Country, e.Browser, e.Os)));
        Assert.Equal(1, country.Calls);   // once per batch
    }

    [Theory]
    [InlineData("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")]
    [InlineData("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36")]
    [InlineData("Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 Chrome-Lighthouse")]
    public async Task A_crawler_that_runs_scripts_is_not_a_visitor(string agent)
    {
        using var h = new TestHarness(Now);
        var country = new FixedCountry("US");
        var handler = new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock, country);

        var result = await handler.Handle(new RecordWebEventsCommand("v", "s", [Ev("pageview")], UserAgent: agent), default);

        Assert.Equal(0, result.Value);
        Assert.Empty(h.Db.WebEvents);
        Assert.Equal(0, country.Calls);
    }

    [Fact]
    public async Task A_batch_with_nothing_worth_keeping_never_asks_for_a_country()
    {
        using var h = new TestHarness(Now);
        var country = new FixedCountry("US");
        var handler = new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock, country);

        await handler.Handle(new RecordWebEventsCommand("v", "s", [Ev("hover", "x")], UserAgent: AndroidChrome), default);

        Assert.Equal(0, country.Calls);
    }

    [Theory]
    [InlineData(AndroidChrome, "Chrome", "Android")]
    [InlineData("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari", "iOS")]
    [InlineData("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1", "Chrome", "iOS")]
    [InlineData("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0", "Edge", "Windows")]
    [InlineData("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox", "macOS")]
    [InlineData("Opera/9.80 (Android; Opera Mini/36.2.2254/119.132; U; id) Presto/2.12.423 Version/12.16", "Opera Mini", "Android")]
    [InlineData("Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36", "Samsung Internet", "Android")]
    [InlineData("Mozilla/5.0 (Linux; Android 14; Infinix X6833B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/484.0.0.53.104;]", "Facebook in-app", "Android")]
    [InlineData("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", "Chrome", "ChromeOS")]
    [InlineData("SomethingElse/1.0", "Other", "Other")]
    public void A_user_agent_is_read_as_a_browser_and_system_family(string agent, string browser, string os)
    {
        var read = UserAgentFamily.Read(agent);
        Assert.False(read.IsBot);
        Assert.Equal((browser, os), (read.Browser, read.Os));
    }

    [Fact]
    public void No_user_agent_reads_as_nothing_known()
    {
        Assert.Equal(new UserAgentFamily.Agent(null, null, false), UserAgentFamily.Read(null));
        Assert.Equal(new UserAgentFamily.Agent(null, null, false), UserAgentFamily.Read("  "));
    }

    [Fact]
    public void A_country_that_is_not_two_letters_is_not_kept()
    {
        var e = WebEvent.TryCreate("pageview", null, "/", null, null, "v", "s", null, "desktop", Now)!;
        Assert.Null(e.WithVisit(null, "Undefined", null, null).Country);
        Assert.Null(e.WithVisit(null, "1A", null, null).Country);
        Assert.Equal("GB", e.WithVisit(null, "gb", null, null).Country);
        Assert.Null(WebCampaign.From(null, " ", null, null, null, null));
    }

    [Fact]
    public async Task The_overview_reads_the_events_back_as_web_traffic()
    {
        using var h = new TestHarness(Now);
        var ada = Signup(h, "ada@example.com", "Ada Lovelace");
        var bob = Signup(h, "bob@example.com", "Bob Marley");

        // Two visitors this window, one of them in two sessions; one page view last window. The
        // window ends at "now" exclusive, so everything is recorded a little earlier than the query runs.
        h.Clock.UtcNow = Now.AddHours(-1);
        var visitorA = new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock);
        await visitorA.Handle(new RecordWebEventsCommand("a", "a1",
        [
            Ev("pageview", path: "/", referrer: "google.com"),
            Ev("click", "Sign up", "/", "/app?signup=1"),
            Ev("click", "Pricing", "/", "/#pricing"),
            Ev("pageview", path: "/app", referrer: null, device: "mobile"),
            Ev("action", "Preview started", "/app", device: "mobile"),
        ]), default);
        await visitorA.Handle(new RecordWebEventsCommand("a", "a2", [Ev("pageview", path: "/")]), default);
        await new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock)
            .Handle(new RecordWebEventsCommand("b", "b1", [Ev("pageview", path: "/", referrer: "t.co"), Ev("click", "Sign up", "/", "/app?signup=1")]), default);

        // Ada acts in the app, signed in; Bob too, a little later.
        h.Clock.UtcNow = Now.AddMinutes(-20);
        await new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(ada), h.Clock)
            .Handle(new RecordWebEventsCommand("a", "a2", [Ev("action", "Saved sheet", "/app"), Ev("action", "Shared sheet", "/app")]), default);
        h.Clock.UtcNow = Now.AddMinutes(-10);
        await new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(bob), h.Clock)
            .Handle(new RecordWebEventsCommand("c", "c1", [Ev("pageview", path: "/app"), Ev("action", "Saved sheet", "/app")]), default);

        // Last window: one view that must not be counted now.
        h.Clock.UtcNow = Now.AddDays(-40);
        await new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock)
            .Handle(new RecordWebEventsCommand("z", "z1", [Ev("pageview", path: "/")]), default);
        h.Clock.UtcNow = Now;

        var overview = await new GetAnalyticsOverviewQueryHandler(h.Db, h.Clock).Handle(new GetAnalyticsOverviewQuery(), default);

        Assert.True(overview.IsSuccess);
        var t = overview.Value.WebTraffic;
        Assert.Equal(5, t.Pageviews);
        Assert.Equal(1, t.PageviewsPrevious);
        Assert.Equal(3, t.Visitors);
        Assert.Equal(1, t.VisitorsPrevious);
        Assert.Equal(4, t.Sessions);
        Assert.Equal(3, t.Clicks);
        Assert.Equal(2, t.SignupClicks);
        Assert.Equal(4, t.Actions);
        Assert.Equal(2, t.ActiveWebUsers);
        Assert.Equal(5, t.PageviewsPerDay.Sum(d => d.Count));
        Assert.Equal([("/", 3), ("/app", 2)], t.TopPages.Select(c => (c.Label, c.Count)));
        Assert.Equal([("Direct", 3), ("google.com", 1), ("t.co", 1)], t.TopReferrers.Select(c => (c.Label, c.Count)));
        Assert.Equal([("Sign up", 2), ("Pricing", 1)], t.TopClicks.Select(c => (c.Label, c.Count)));
        Assert.Equal([("Desktop", 4), ("Mobile", 1)], t.Devices.Select(c => (c.Label, c.Count)));
        Assert.Equal([("Saved sheet", 2), ("Preview started", 1), ("Shared sheet", 1)], t.TopActions.Select(c => (c.Label, c.Count)));
        Assert.Equal(["Bob Marley", "Ada Lovelace", "Ada Lovelace"], t.RecentActions.Select(a => a.FullName));
        Assert.Equal("Saved sheet", t.RecentActions[0].Action);
        Assert.Equal("bob@example.com", t.RecentActions[0].Email);
    }

    private static Guid Signup(TestHarness h, string email, string name)
    {
        var user = User.Create(name, email, "hash", h.Clock.UtcNow);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user.Id;
    }
}
