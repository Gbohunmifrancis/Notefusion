using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Analytics;

/// <summary>The dashboard's membership section: who has Pro now, what came and went, and the money.</summary>
public class MembershipMetricsTests
{
    private static readonly DateTime Now = new(2026, 8, 20, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Members_money_and_songs_are_counted_once_per_account_and_per_currency()
    {
        using var h = new TestHarness(Now);
        var monthly = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro (Monthly)", 999, "USD", BillingInterval.Monthly);
        var yearly = Plan.Create(Guid.NewGuid(), "pro_yearly_ngn", "NoteFusion Pro (Yearly)", 1_200_000, "NGN", BillingInterval.Yearly);
        h.Db.Plans.AddRange(monthly, yearly);

        // A monthly payer who joined in the window and paid twice; a yearly naira payer from long ago;
        // a gift; a lifetime holder; one who lapsed inside the window; one who lapsed before it.
        var payer = Seed(h, "payer@example.com");
        var naira = Seed(h, "naira@example.com");
        var gift = Seed(h, "gift@example.com");
        var forever = Seed(h, "forever@example.com");
        var lapsed = Seed(h, "lapsed@example.com");
        var old = Seed(h, "old@example.com");

        h.Db.Subscriptions.Add(Subscription.Start(payer.Id, monthly.Id, PaymentProvider.Bachs, Now.AddDays(-10), Now.AddDays(50), null, Now.AddDays(-10)));
        h.Db.Subscriptions.Add(Subscription.Start(naira.Id, yearly.Id, PaymentProvider.Paystack, Now.AddDays(-200), Now.AddDays(165), null, Now.AddDays(-200)));
        h.Db.Subscriptions.Add(Subscription.Grant(gift.Id, monthly.Id, Now.AddDays(-5), Now.AddDays(25), Now.AddDays(-5)));
        h.Db.Subscriptions.Add(Subscription.Start(forever.Id, monthly.Id, PaymentProvider.Bachs, Now.AddDays(-90), Subscription.LifetimeEndUtc, null, Now.AddDays(-90)));
        h.Db.Subscriptions.Add(Subscription.Start(lapsed.Id, monthly.Id, PaymentProvider.Bachs, Now.AddDays(-40), Now.AddDays(-3), null, Now.AddDays(-40)));
        h.Db.Subscriptions.Add(Subscription.Start(old.Id, monthly.Id, PaymentProvider.Bachs, Now.AddDays(-120), Now.AddDays(-60), null, Now.AddDays(-120)));

        Charge(h, payer.Id, monthly.Id, 999, "USD", Now.AddDays(-10));
        Charge(h, payer.Id, monthly.Id, 999, "USD", Now.AddDays(-2));
        Charge(h, naira.Id, yearly.Id, 1_200_000, "NGN", Now.AddDays(-200)); // outside the window

        // Songs this month: the payer used the whole allowance, the naira member two; one last month.
        for (var i = 0; i < 20; i++) Song(h, payer.Id, $"p{i}", new DateTime(2026, 8, 2 + i % 15, 9, 0, 0, DateTimeKind.Utc));
        Song(h, naira.Id, "n1", Now.AddDays(-1));
        Song(h, naira.Id, "n2", Now.AddDays(-1));
        Song(h, naira.Id, "n0", new DateTime(2026, 7, 30, 9, 0, 0, DateTimeKind.Utc));
        h.Db.SaveChanges();

        var overview = await new GetAnalyticsOverviewQueryHandler(h.Db, h.Clock).Handle(new GetAnalyticsOverviewQuery(), default);

        Assert.True(overview.IsSuccess);
        var m = overview.Value.Membership;
        Assert.Equal(4, m.ActiveMembers);          // payer, naira, gift, lifetime
        Assert.Equal(3, m.PaidMembers);
        Assert.Equal(1, m.GiftedMembers);
        Assert.Equal(1, m.LifetimeMembers);
        Assert.Equal(2, m.NewMembers);             // payer and gift started inside the 30-day window
        Assert.Equal(1, m.LapsedMembers);          // lapsed ran out inside it; old ran out before
        Assert.Equal([("USD", 1998L)], m.Revenue.Select(r => (r.Currency, r.AmountMinor)));
        // Monthly at face value; yearly at a twelfth; lifetime and gifts are not run-rate.
        Assert.Equal(999, m.MonthlyRunRate.Single(r => r.Currency == "USD").AmountMinor);
        Assert.Equal(100_000, m.MonthlyRunRate.Single(r => r.Currency == "NGN").AmountMinor);
        Assert.Equal(1, m.MembersByPlan.Single(p => p.Label == "Gift").Count);
        Assert.Equal(22, m.SongsUsedThisMonth);
        Assert.Equal(1, m.MembersOutOfSongs);
    }

    private static User Seed(TestHarness h, string email)
    {
        var user = User.Create("Member", email, h.Hasher.Hash("password123"), Now.AddDays(-300));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static void Charge(TestHarness h, Guid userId, Guid planId, long amount, string currency, DateTime at)
    {
        var reference = $"NF_{Guid.NewGuid():N}";
        var tx = PaymentTransaction.Create(userId, planId, PaymentProvider.Bachs, $"checkout:{reference}", reference, amount, currency, at);
        h.Db.PaymentTransactions.Add(tx);
        h.Db.LedgerEntries.Add(LedgerEntry.Create(userId, tx.Id, LedgerDirection.Credit, LedgerEntryReason.SubscriptionCharge, amount, currency, "Pro", at));
    }

    private static void Song(TestHarness h, Guid userId, string jobId, DateTime at)
    {
        var job = TranscriptionJob.RecordSong(jobId, userId, at.AddMinutes(-5), null);
        job.ConsumeSongCredit(at);
        h.Db.TranscriptionJobs.Add(job);
    }
}
