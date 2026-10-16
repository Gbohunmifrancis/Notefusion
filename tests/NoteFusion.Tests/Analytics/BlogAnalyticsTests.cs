using System.Text;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Api.Controllers;
using NoteFusion.Application.Analytics;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Web.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Analytics;

/// <summary>
/// The console's Blog analytics: blog readers followed through to the app, a sign-up, a transcription and a
/// payment, with first-touch credit inside a 30-day window and the team's own browsing left out.
/// </summary>
public class BlogAnalyticsTests
{
    private static readonly DateTime Now = new(2026, 8, 11, 12, 0, 0, DateTimeKind.Utc);
    private const string PostA = "/blog/how-to-read-tonic-solfa";
    private const string PostB = "/blog/how-to-find-the-doh-of-a-song";
    private const string Hymn = "/hymns/abide-with-me";

    private static WebEventInput View(string path, string? referrer = null) => new("pageview", null, path, null, referrer, "desktop", null);
    private static WebEventInput Act(string name, string path, string detail) => new("action", name, path, null, null, "mobile", null, detail);

    private static async Task Track(TestHarness h, DateTime at, string visitor, Guid? user, string? device, params WebEventInput[] events)
    {
        h.Clock.UtcNow = at;
        await new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(user), h.Clock)
            .Handle(new RecordWebEventsCommand(visitor, "s-" + visitor, events, device), default);
    }

    private static Guid Signup(TestHarness h, string email, DateTime at)
    {
        var user = User.Create(email.Split('@')[0], email, "hash", at);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user.Id;
    }

    private static void Job(TestHarness h, Guid user, DateTime at, string? device = null)
    {
        h.Db.TranscriptionJobs.Add(TranscriptionJob.Record("job-" + Guid.NewGuid().ToString("N"), user, at, device));
        h.Db.SaveChanges();
    }

    private static void Paid(TestHarness h, Guid user, DateTime at)
    {
        var plan = h.Db.Plans.FirstOrDefault() ?? Plan.Create(Guid.NewGuid(), "pro_monthly", "Pro Monthly", 1000, "USD", BillingInterval.Monthly);
        if (h.Db.Entry(plan).State == Microsoft.EntityFrameworkCore.EntityState.Detached)
            h.Db.Plans.Add(plan);
        var id = Guid.NewGuid().ToString("N");
        var tx = PaymentTransaction.Create(user, plan.Id, PaymentProvider.Paystack, "idem-" + id, "ref-" + id, 1000, "USD", at);
        tx.AttachCheckout("ps_" + id, "https://checkout.example/" + id, null, at);
        tx.MarkVerified("ps_" + id, null, at);
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();
    }

    private static async Task<BlogAnalyticsDto> Read(TestHarness h, DateTime? from = null, DateTime? to = null)
    {
        h.Clock.UtcNow = Now;
        var result = await new GetBlogAnalyticsQueryHandler(h.Db, h.Clock).Handle(new GetBlogAnalyticsQuery(from, to), default);
        Assert.True(result.IsSuccess);
        return result.Value;
    }

    private static int Stage(BlogAnalyticsDto d, string key) => d.Funnel.Single(s => s.Key == key).Count;

    [Fact]
    public async Task A_reader_is_followed_to_the_app_a_signup_a_transcription_and_a_payment()
    {
        using var h = new TestHarness(Now);

        // v1: found a post on Google, read it through, clicked to the app and signed up there (the web app then
        // sends its token, so the browser's later events carry the account), transcribed, paid.
        var t1 = Now.AddDays(-10);
        await Track(h, t1, "v1", null, "dev-a",
            View(PostA, "www.google.com"),
            Act(BlogEvents.View, PostA, "pv=p1;src=search;ref=www.google.com;type=post;slug=how-to-read-tonic-solfa;utm_source=google;utm_medium=organic"),
            Act(BlogEvents.Read, PostA, "pv=p1;depth=60;active=45"),
            Act(BlogEvents.ReadComplete, PostA, "pv=p1;depth=95;active=70"),
            Act(BlogEvents.Engagement, PostA, "pv=p1;depth=100;active=80"),
            Act(BlogEvents.CtaClick, PostA, "pv=p1;cta=CTA: blog;href=/app"));
        await Track(h, t1.AddMinutes(5), "v1", null, "dev-a", View("/app"));
        var ada = Signup(h, "ada@example.com", t1.AddMinutes(10));
        await Track(h, t1.AddMinutes(12), "v1", ada, "dev-a", new WebEventInput("action", "Saved sheet", "/app", null, null, "desktop", null));
        Job(h, ada, t1.AddDays(1), "dev-a");
        Paid(h, ada, t1.AddDays(2));

        // v2: came from WhatsApp to a hymn, skimmed it, then ran an anonymous preview from the same browser.
        var t2 = Now.AddDays(-5);
        await Track(h, t2, "v2", null, "dev-b",
            View(Hymn, "l.facebook.com"),
            Act(BlogEvents.View, Hymn, "pv=q1;src=social;ref=wa.me;type=hymn"),
            Act(BlogEvents.HymnPlay, Hymn, "pv=q1"),
            Act(BlogEvents.Engagement, Hymn, "pv=q1;depth=25;active=10"),
            Act(BlogEvents.Share, Hymn, "pv=q1;net=whatsapp"));
        h.Db.PreviewJobs.Add(PreviewJob.Record("prev-1", "upload", "dev-b", null, t2.AddHours(1)));
        h.Db.SaveChanges();

        // v3: an older tracker (no blog_view), never signed in on the web app's tracker, but its device id made
        // the account's first transcription: tied by the device join.
        var t3 = Now.AddDays(-7);
        await Track(h, t3, "v3", null, "dev-c", View(PostB));
        var bob = Signup(h, "bob@example.com", t3.AddDays(1));
        Job(h, bob, t3.AddDays(1).AddHours(1), "dev-c");

        var d = await Read(h);

        Assert.Equal(3, d.Kpis.Visitors);
        Assert.Equal(3, d.Kpis.NewVisitors);
        Assert.Equal(3, d.Kpis.Views);
        Assert.Equal(1, d.Kpis.Readers);
        Assert.Equal(1, d.Kpis.CompleteReads);
        Assert.Equal(1, d.Kpis.CtaClicks);
        Assert.Equal([3, 1, 1, 1, 2, 3, 1], d.Funnel.Select(s => s.Count));
        Assert.Equal(["visitors", "readers", "cta", "app", "signup", "transcribed", "paid"], d.Funnel.Select(s => s.Key));
        Assert.Equal(2, d.Kpis.SignupsFromBlog);
        Assert.Equal(3, d.Kpis.TranscribersFromBlog);
        Assert.Equal(1, d.Kpis.PayersFromBlog);
        Assert.Equal(2, d.Kpis.AssistedSignups);
        Assert.Equal(2, d.Kpis.AssistedTranscribers);
        Assert.Equal(1, d.Kpis.AssistedPayers);

        var a = d.Posts.Single(p => p.Path == PostA);
        Assert.Equal(("post", 1, 1, 1, 1.0, 1, 80.0, 1), (a.Kind, a.Views, a.Reads, a.Readers, a.ReadRate!.Value, a.CompleteReads, a.AvgActiveSeconds!.Value, a.CtaClicks));
        Assert.Equal((1, 1, 1, 1), (a.EntryVisitors, a.Signups, a.Transcribers, a.Payers));
        var hymn = d.Posts.Single(p => p.Path == Hymn);
        Assert.Equal(("hymn", 0, 1, 1, 10.0), (hymn.Kind, hymn.Reads, hymn.HymnPlays, hymn.Shares, hymn.AvgActiveSeconds!.Value));
        Assert.Equal((1, 0, 1, 0), (hymn.EntryVisitors, hymn.Signups, hymn.Transcribers, hymn.Payers));
        var b = d.Posts.Single(p => p.Path == PostB);
        Assert.Equal((1, 1, 1, 0), (b.EntryVisitors, b.Signups, b.Transcribers, b.Payers));

        // The script's label wins over the referrer; with no label the page view's referrer is read (none: direct).
        Assert.Equal([("direct", 1, 0, 1), ("search", 1, 1, 1), ("social", 1, 0, 0)],
            d.Sources.Select(s => (s.Source, s.Visitors, s.Readers, s.Signups)));
        Assert.Equal(("google / organic / —", 1, 1), (d.Campaigns.Single().Campaign, d.Campaigns.Single().Visitors, d.Campaigns.Single().Signups));
        Assert.Equal(("whatsapp", 1), (d.Shares.Single().Network, d.Shares.Single().Count));
        Assert.Equal(3, d.Daily.Sum(x => x.Views));
        Assert.Equal(1, d.Daily.Sum(x => x.Reads));
        Assert.Equal(2, d.Daily.Sum(x => x.Signups));
        Assert.Equal([PostB, PostA, Hymn], d.TopEntries.Select(e => e.Path));   // by sign-ups, then visitors, then path
    }

    [Fact]
    public async Task Credit_goes_to_the_first_blog_page_and_only_within_thirty_days_of_it()
    {
        using var h = new TestHarness(Now);
        var from = Now.AddDays(-90);

        // v1 entered on post A, then read post B and signed up 20 days later: post A gets the sign-up.
        var t1 = Now.AddDays(-30);
        await Track(h, t1, "v1", null, null, View(PostA));
        await Track(h, t1.AddDays(19), "v1", null, null, View(PostB));
        var ada = Signup(h, "ada@example.com", t1.AddDays(20));
        await Track(h, t1.AddDays(20).AddMinutes(1), "v1", ada, null, View("/app"));

        // v2 signed up 40 days after its first blog page: too late for the blog's credit, still "assisted".
        var t2 = Now.AddDays(-80);
        await Track(h, t2, "v2", null, null, View(PostB));
        var bob = Signup(h, "bob@example.com", t2.AddDays(40));
        await Track(h, t2.AddDays(40).AddMinutes(1), "v2", bob, null, View("/app"));
        Job(h, bob, t2.AddDays(41));

        // v3 is an existing customer reading the blog: neither a sign-up nor a transcription from it.
        var cy = Signup(h, "cy@example.com", Now.AddDays(-100));
        await Track(h, Now.AddDays(-3), "v3", cy, null, View(PostA));
        Job(h, cy, Now.AddDays(-2));

        var d = await Read(h, from, Now);

        Assert.Equal(3, Stage(d, "visitors"));
        Assert.Equal(1, Stage(d, "signup"));
        Assert.Equal(0, Stage(d, "transcribed"));
        Assert.Equal(1, Stage(d, "app"));     // v2 opened the app too late, v3 never did
        Assert.Equal(1, d.Posts.Single(p => p.Path == PostA).Signups);
        Assert.Equal(0, d.Posts.Single(p => p.Path == PostB).Signups);
        Assert.Equal(2, d.Kpis.AssistedSignups);   // Ada and Bob both saw the blog before signing up
        Assert.Equal(1, d.Kpis.AssistedTranscribers);

        // A browser that read the blog before the window is returning: traffic, not the funnel.
        var recent = await Read(h, Now.AddDays(-15), Now);
        Assert.Equal(2, recent.Kpis.Visitors);      // v1 (post B) and v3
        Assert.Equal(1, recent.Kpis.NewVisitors);   // v3 only: v1's first blog page was earlier
    }

    [Fact]
    public async Task Admins_and_internal_accounts_are_left_out_everywhere()
    {
        using var h = new TestHarness(Now);
        var staff = Signup(h, "staff@example.com", Now.AddDays(-50));
        h.Db.Users.Single(u => u.Id == staff).SetInternal(true);
        var admin = User.CreateAdmin("Admin", "admin@example.com", "hash", Now.AddDays(-50));
        h.Db.Users.Add(admin);
        h.Db.SaveChanges();

        // The team's browsers: anonymous on the blog, signed in once, so every event from them is internal.
        await Track(h, Now.AddDays(-4), "team-1", null, "dev-t", View(PostA), Act(BlogEvents.Read, PostA, "pv=x;depth=80;active=60"));
        await Track(h, Now.AddDays(-4).AddMinutes(5), "team-1", staff, "dev-t", View("/app"));
        await Track(h, Now.AddDays(-3), "team-2", admin.Id, null, View(PostB));
        Job(h, staff, Now.AddDays(-3), "dev-t");

        // One customer.
        await Track(h, Now.AddDays(-2), "c1", null, null, View(PostA));

        var d = await Read(h);

        Assert.Equal(1, d.Kpis.Visitors);
        Assert.Equal(1, d.Kpis.Views);
        Assert.Equal(0, d.Kpis.Readers);
        Assert.Equal([1, 0, 0, 0, 0, 0, 0], d.Funnel.Select(s => s.Count));
        Assert.Equal([PostA], d.Posts.Select(p => p.Path));
        Assert.Equal(0, d.Kpis.AssistedSignups);
    }

    [Fact]
    public async Task A_read_is_half_the_article_and_thirty_visible_seconds_whatever_the_browser_claims()
    {
        using var h = new TestHarness(Now);
        var at = Now.AddDays(-1);
        await Track(h, at, "a", null, null, View(PostA), Act(BlogEvents.Read, PostA, "pv=1;depth=50;active=30"));           // on the line: a read
        await Track(h, at, "b", null, null, View(PostA), Act(BlogEvents.Read, PostA, "pv=2;depth=90;active=5"));            // a skim, mislabelled
        await Track(h, at, "c", null, null, View(PostA), Act(BlogEvents.Read, PostA, "pv=3;depth=40;active=300"));          // left open, never scrolled
        await Track(h, at, "d", null, null, View(PostA), Act(BlogEvents.Engagement, PostA, "pv=4;depth=75;active=31"));     // read lost, report kept
        await Track(h, at, "e", null, null, View(PostA),
            Act(BlogEvents.Engagement, PostA, "pv=5;depth=50;active=20"),                                                    // reported again when hidden twice:
            Act(BlogEvents.Engagement, PostA, "pv=5;depth=50;active=36"));                                                   // the running total counts
        await Track(h, at, "f", null, null, View(PostA), Act(BlogEvents.Read, PostA, "depth=junk;active=99"));

        var d = await Read(h);

        var post = d.Posts.Single();
        Assert.Equal(6, post.Visitors);
        Assert.Equal(3, post.Reads);
        Assert.Equal(0.5, post.ReadRate);
        Assert.Equal(Math.Round((31 + 36) / 2.0, 1), post.AvgActiveSeconds);

        Assert.True(BlogEvents.IsGenuineRead(50, 30));
        Assert.False(BlogEvents.IsGenuineRead(49, 300));
        Assert.False(BlogEvents.IsGenuineRead(100, 29));
        Assert.False(BlogEvents.IsGenuineRead(null, 60));
    }

    [Theory]
    [InlineData(null, "direct")]
    [InlineData("www.google.com", "search")]
    [InlineData("www.google.com.ng", "search")]
    [InlineData("android-app://com.google.android.googlequicksearchbox", "search")]
    [InlineData("duckduckgo.com", "search")]
    [InlineData("l.facebook.com", "social")]
    [InlineData("t.co", "social")]
    [InlineData("web.whatsapp.com", "social")]
    [InlineData("reddit.com", "social")]
    [InlineData("notefusion.studio", "internal")]
    [InlineData("stackoverflow.com", "other")]
    [InlineData("mygoogle.blog", "other")]
    public void A_referring_host_is_put_under_its_source(string? host, string source)
        => Assert.Equal(source, BlogEvents.SourceOfHost(host));

    [Theory]
    [InlineData("/blog", "index")]
    [InlineData("/blog/page/2", "index")]
    [InlineData("/blog/tag/choir", "index")]
    [InlineData("/blog/author/francis", "index")]
    [InlineData("/hymns", "index")]
    [InlineData("/blog/how-to-read-tonic-solfa", "post")]
    [InlineData("/hymns/abide-with-me", "hymn")]
    public void Pages_are_told_apart(string path, string kind) => Assert.Equal(kind, BlogEvents.KindOf(path));

    [Fact]
    public async Task A_beacon_is_read_as_json_from_a_plain_text_body_with_its_device_id_hashed()
    {
        var sender = new CapturingSender();
        var controller = new WebEventsController(sender);
        var json = """{"visitorId":"v1","sessionId":"s1","deviceId":"browser-device-0001","events":[{"kind":"action","name":"blog_engagement","path":"/blog/x","detail":"pv=1;depth=75;active=40","ageMs":10}]}""";
        controller.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() };
        controller.Request.ContentType = "text/plain;charset=UTF-8";
        controller.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(json));

        var result = await controller.Beacon(default);

        Assert.IsType<NoContentResult>(result);
        var command = Assert.IsType<RecordWebEventsCommand>(sender.Sent.Single());
        Assert.Equal(("v1", "s1"), (command.VisitorId, command.SessionId));
        Assert.Equal(RequestDeviceFingerprint.Hash("browser-device-0001"), command.DeviceHash);
        Assert.Equal("pv=1;depth=75;active=40", command.Events.Single().Detail);

        // Junk is a no-op, not an error.
        controller.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes("not json"));
        Assert.IsType<NoContentResult>(await controller.Beacon(default));
        Assert.Single(sender.Sent);
    }

    private sealed class CapturingSender : ISender
    {
        public List<object> Sent { get; } = [];

        public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default)
        {
            Sent.Add(request);
            return Task.FromResult(default(TResponse)!);
        }

        public Task Send<TRequest>(TRequest request, CancellationToken cancellationToken = default) where TRequest : IRequest
        {
            Sent.Add(request!);
            return Task.CompletedTask;
        }

        public Task<object?> Send(object request, CancellationToken cancellationToken = default)
        {
            Sent.Add(request);
            return Task.FromResult<object?>(null);
        }

        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public IAsyncEnumerable<object?> CreateStream(object request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();
    }
}
