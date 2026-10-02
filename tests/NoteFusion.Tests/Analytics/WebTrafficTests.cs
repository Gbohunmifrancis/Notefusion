using NoteFusion.Application.Analytics.Queries;
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
