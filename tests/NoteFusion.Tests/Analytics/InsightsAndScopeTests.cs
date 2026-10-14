using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Analytics;

/// <summary>
/// Internal accounts (admins and those flagged) stay out of every figure and list, their browsers' anonymous
/// traffic included; and the Insights page cuts by country, platform and plan.
/// </summary>
public class InsightsAndScopeTests
{
    private static readonly DateTime Now = new(2026, 10, 14, 15, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Admins_and_internal_accounts_are_left_out_of_the_overview_users_and_live()
    {
        using var h = new TestHarness(Now);
        var customer = Signup(h, "customer@example.com", "NG");
        var admin = Signup(h, "admin@example.com", "NG");
        var tester = Signup(h, "tester@example.com", "NG");
        h.Db.Users.Single(u => u.Id == admin).PromoteToAdmin();
        h.Db.Users.Single(u => u.Id == tester).SetInternal(true);
        foreach (var id in new[] { customer, admin, tester })
        {
            h.Db.Users.Single(u => u.Id == id).MarkSeen(Now.AddMinutes(-1));
            var job = TranscriptionJob.Record("job-" + id.ToString("N"), id, Now.AddMinutes(-5));
            job.Settle("{}", Now.AddMinutes(-4));
            h.Db.TranscriptionJobs.Add(job);
        }
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "Pro", 750_000, "NGN", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(Subscription.Grant(tester, plan.Id, Now.AddDays(-1), Now.AddDays(29), Now.AddDays(-1)));
        // The tester's browser, signed in once, then browsing signed out: still the team's traffic.
        h.Db.WebEvents.Add(WebEvent.TryCreate("pageview", null, "/app", null, null, "v-team", "s1", tester, "desktop", Now.AddHours(-2))!);
        h.Db.WebEvents.Add(WebEvent.TryCreate("pageview", null, "/", null, null, "v-team", "s2", null, "desktop", Now.AddHours(-1))!);
        h.Db.WebEvents.Add(WebEvent.TryCreate("pageview", null, "/", null, null, "v-public", "s3", null, "mobile", Now.AddHours(-1))!);
        h.Db.SaveChanges();

        var overview = (await new GetAnalyticsOverviewQueryHandler(h.Db, h.Clock).Handle(new GetAnalyticsOverviewQuery(), default)).Value;
        Assert.Equal(1, overview.Users.TotalUsers);
        Assert.Equal(1, overview.Users.ActiveToday);
        Assert.Equal(1, overview.Transcriptions.TotalTranscribed);
        Assert.Equal(0, overview.Membership!.ActiveMembers);
        Assert.Equal(1, overview.WebTraffic.Pageviews);
        Assert.All(overview.RecentActivity, a => Assert.Equal(customer, a.UserId));

        var list = (await new GetAdminUsersQueryHandler(h.Db, h.Clock).Handle(new GetAdminUsersQuery(), default)).Value;
        Assert.Equal("customer@example.com", Assert.Single(list.Items).Email);
        var team = (await new GetAdminUsersQueryHandler(h.Db, h.Clock).Handle(new GetAdminUsersQuery(IncludeInternal: true), default)).Value;
        Assert.Equal(3, team.TotalCount);
        Assert.Equal(2, team.Items.Count(i => i.IsInternal));

        var live = (await new GetLiveActivityQueryHandler(h.Db, h.Clock).Handle(new GetLiveActivityQuery(), default)).Value;
        Assert.Equal("customer@example.com", Assert.Single(live.Online).Email);
        Assert.Single(live.Transcribing);
    }

    [Fact]
    public async Task Insights_cut_by_country_platform_and_plan_and_trace_the_path_to_paying()
    {
        using var h = new TestHarness(Now);
        var ada = Signup(h, "ada@example.com", "NG", "web", Now.AddDays(-5));
        var bola = Signup(h, "bola@example.com", "NG", "mobile", Now.AddDays(-4));
        var carl = Signup(h, "carl@example.com", "US", "web", Now.AddDays(-3));
        foreach (var (id, n) in new[] { (ada, 2), (bola, 1), (carl, 0) })
            for (var i = 0; i < n; i++)
            {
                var job = TranscriptionJob.RecordLink($"j-{id:N}-{i}", id, Now.AddDays(-2).AddMinutes(i), null, false);
                job.Settle("{}", Now.AddDays(-2).AddMinutes(i + 1));
                h.Db.TranscriptionJobs.Add(job);
            }
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "Pro", 750_000, "NGN", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(Subscription.Start(ada, plan.Id, PaymentProvider.Paystack, Now.AddDays(-1), Now.AddDays(29), "s1", Now.AddDays(-1)));
        h.Db.SaveChanges();

        var all = await Insights(h);
        Assert.Equal(3, all.Kpis.Accounts);
        Assert.Equal([3, 2, 1, 0, 0, 1], all.Funnel.Select(f => f.Count));
        Assert.Equal(1, all.Kpis.PaidConversions);
        Assert.Equal(("NG", 2), (all.Countries[0].Country, all.Countries[0].Accounts));
        Assert.Equal(3, all.Kpis.Transcriptions);
        Assert.Equal(60, Assert.Single(all.JobDurations, d => d.Kind == "Song link").MedianSeconds);

        Assert.Equal(2, (await Insights(h, country: "NG")).Kpis.Accounts);
        Assert.Equal(1, (await Insights(h, platform: "app")).Kpis.Accounts);
        var pro = await Insights(h, plan: "pro");
        Assert.Equal((1, 2), (pro.Kpis.Accounts, pro.Kpis.Transcriptions));
        Assert.Contains(all.Filters.Countries, c => c.Label == "US");
    }

    private static async Task<InsightsDto> Insights(TestHarness h, string? country = null, string? platform = null, string? plan = null)
        => (await new GetInsightsQueryHandler(h.Db, h.Clock).Handle(new GetInsightsQuery(null, null, country, platform, plan), default)).Value;

    private static Guid Signup(TestHarness h, string email, string country, string? source = null, DateTime? at = null)
    {
        var user = User.Create(email.Split('@')[0], email, "hash", at ?? Now.AddDays(-3));
        user.RecordSignupSource(source);
        user.RecordCountry(country);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user.Id;
    }
}
