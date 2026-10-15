using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Library.Queries;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Analytics;

/// <summary>The dashboard's web funnel: every stage is a count of rows the schema keeps.</summary>
public class WebFunnelTests
{
    private static readonly DateTime Now = new(2026, 8, 11, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task The_funnel_counts_previews_web_signups_claims_saves_shares_views_and_upgrades()
    {
        using var h = new TestHarness(Now);

        // Three previews from two browsers in the window, one of them finished; one last month.
        h.Db.PreviewJobs.Add(PreviewJob.Record("p1", "upload", "browser-a", null, Now.AddDays(-2)));
        var done = PreviewJob.Record("p2", "link", "browser-a", null, Now.AddDays(-1));
        done.Complete(true, "Way Maker", Now.AddDays(-1));
        h.Db.PreviewJobs.Add(done);
        h.Db.PreviewJobs.Add(PreviewJob.Record("p3", "upload", "browser-b", null, Now.AddHours(-3)));
        h.Db.PreviewJobs.Add(PreviewJob.Record("p0", "upload", "browser-z", null, Now.AddDays(-40)));

        // Two web sign-ups, one mobile; the first web one claimed a preview, saved and shared a sheet,
        // and went Pro; the mobile one also went Pro but is not a web conversion.
        var web1 = Signup(h, "web1@example.com", "web", Now.AddDays(-1));
        var web2 = Signup(h, "web2@example.com", "web", Now.AddHours(-2));
        var mob = Signup(h, "mob@example.com", "mobile", Now.AddDays(-1));
        done.Claim(web1, Now.AddDays(-1));
        h.Db.SaveChanges();

        var saved = await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(web1), h.QuotaGate)
            .Handle(new SaveTranscriptionCommand("Way Maker", "C", 100, "4/4", "<score/>", [new NoteEventDto(60, 0, 1, 1, "", "", 1)], 0.9, null), default);
        // The window ends at "now" exclusive, so the share is made a little earlier than the query runs.
        h.Clock.UtcNow = Now.AddMinutes(-30);
        var share = await new ShareTranscriptionCommandHandler(h.Db, new StubCurrentUser(web1), h.Clock).Handle(new ShareTranscriptionCommand(saved.Value.Id), default);
        h.Clock.UtcNow = Now;
        await new GetSharedTranscriptionQueryHandler(h.Db).Handle(new GetSharedTranscriptionQuery(share.Value.Token), default);
        await new GetSharedTranscriptionQueryHandler(h.Db).Handle(new GetSharedTranscriptionQuery(share.Value.Token), default);
        GoPro(h, web1);
        GoPro(h, mob);

        var overview = await new GetAnalyticsOverviewQueryHandler(h.Db, h.Clock).Handle(new GetAnalyticsOverviewQuery(), default);

        Assert.True(overview.IsSuccess);
        var f = overview.Value.WebFunnel;
        Assert.Equal(3, f.Previews);
        Assert.Equal(1, f.PreviewsPrevious);
        Assert.Equal(2, f.PreviewDevices);
        Assert.Equal(1, f.PreviewsSucceeded);
        Assert.Equal(2, f.WebSignups);
        Assert.Equal(1, f.SignupsFromPreview);
        Assert.Equal(1, f.WebSignupsWhoSaved);
        Assert.Equal(1, f.SharesCreated);
        Assert.Equal(2, f.ShareViews);
        Assert.Equal(1, f.WebProConversions);
        Assert.Equal(3, f.PreviewsPerDay.Sum(d => d.Count));
        Assert.Equal(31, f.PreviewsPerDay.Count); // zero-filled across the default window
        Assert.Equal([("Web", 2), ("Mobile", 1), ("Unknown", 0)], overview.Value.SignupSources.Select(s => (s.Label, s.Count)));
        _ = web2;
    }

    [Fact]
    public async Task Registration_stamps_the_source_and_only_known_values()
    {
        using var h = new TestHarness(Now);
        var handler = new RegisterCommandHandler(h.Db, h.Hasher, h.Tokens, h.Clock, h.Email, h.Country);

        await handler.Handle(new RegisterCommand("Ada", "ada@example.com", "password123", "web"), default);
        await handler.Handle(new RegisterCommand("Bob", "bob@example.com", "password123", "toaster"), default);

        Assert.Equal("web", h.Db.Users.Single(u => u.Email == "ada@example.com").SignupSource);
        Assert.Null(h.Db.Users.Single(u => u.Email == "bob@example.com").SignupSource);
    }

    private static Guid Signup(TestHarness h, string email, string source, DateTime at)
    {
        var user = User.Create("Test User", email, h.Hasher.Hash("password123"), at);
        user.RecordSignupSource(source);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user.Id;
    }

    private static void GoPro(TestHarness h, Guid userId)
    {
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_usd_" + userId.ToString("N")[..6], "NoteFusion Pro", 999, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(Subscription.Start(userId, plan.Id, PaymentProvider.Paystack, Now.AddHours(-1), Now.AddDays(29), "sub-" + userId.ToString("N")[..6], Now.AddHours(-1)));
        h.Db.SaveChanges();
    }
}
