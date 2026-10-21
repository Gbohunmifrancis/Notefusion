using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Offers;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Offers;

/// <summary>The plans, accounts and offers the seasonal-offer tests share: Halloween 2026 at 30%, on the seeded prices.</summary>
internal static class OfferFixtures
{
    /// <summary>The board's start, Mon 26 Oct 2026 09:00 UK time: the UK left summer time on Sun 25 Oct, so 09:00 UTC.</summary>
    public static readonly DateTime Start = new(2026, 10, 26, 9, 0, 0, DateTimeKind.Utc);

    public static readonly DateOnly LastDay = new(2026, 10, 31);

    /// <summary>Wed 28 Oct 10:00 UTC: 10:00 in London, inside its sending hours; 03:00 in Los Angeles, 23:00 in Auckland.</summary>
    public static readonly DateTime Midweek = new(2026, 10, 28, 10, 0, 0, DateTimeKind.Utc);

    public const string PostalAddress = "NoteFusion Ltd, 1 Example Street, London N1 1AA";

    public sealed record SeededPlans(
        Plan Monthly, Plan Yearly, Plan RegionalMonthly, Plan RegionalYearly, Plan NairaMonthly, Plan OneSong, Plan ChoirMonthly);

    /// <summary>The live plan set, as <c>BillingSeeder</c> sells it.</summary>
    public static SeededPlans AddPlans(TestHarness h)
    {
        var plans = new SeededPlans(
            Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro (Monthly)", 999, "USD", BillingInterval.Monthly),
            Plan.Create(Guid.NewGuid(), "pro_yearly_usd", "NoteFusion Pro (Yearly)", 7_900, "USD", BillingInterval.Yearly),
            Plan.Create(Guid.NewGuid(), "pro_monthly_usd_regional", "NoteFusion Pro (Monthly)", 499, "USD", BillingInterval.Monthly),
            Plan.Create(Guid.NewGuid(), "pro_yearly_usd_regional", "NoteFusion Pro (Yearly)", 3_999, "USD", BillingInterval.Yearly),
            Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "NoteFusion Pro (Monthly)", 750_000, "NGN", BillingInterval.Monthly),
            Plan.Create(Guid.NewGuid(), "one_song_usd", "One song", 199, "USD", BillingInterval.Single),
            Plan.Create(Guid.NewGuid(), "choir_monthly_usd", "NoteFusion Choir (Monthly)", 1_999, "USD", BillingInterval.Monthly, 25));
        h.Db.Plans.AddRange(plans.Monthly, plans.Yearly, plans.RegionalMonthly, plans.RegionalYearly, plans.NairaMonthly, plans.OneSong, plans.ChoirMonthly);
        h.Db.SaveChanges();
        return plans;
    }

    public static Offer AddOffer(
        TestHarness h,
        bool enabled = true,
        int pct = 30,
        bool monthly = true,
        bool yearly = true,
        string template = OfferTemplates.Halloween,
        DateTime? start = null,
        DateOnly? lastDay = null,
        string? key = null,
        bool seasonOn = true)
    {
        if (seasonOn)
            Season(h, template, on: true);
        var t = OfferTemplates.Find(template)!;
        var day = lastDay ?? LastDay;
        var offer = Offer.Create(
            key ?? $"{template}-{day.Year}", t.NameFor(day), template, pct, monthly, yearly, start ?? Start, day,
            t.Words.Subject, t.Words.Preheader, t.Words.Headline, t.Words.Body, Guid.NewGuid(), "francis@notefusion.studio",
            (start ?? Start).AddDays(-7));
        offer.SetEnabled(enabled, (start ?? Start).AddDays(-7));
        h.Db.Offers.Add(offer);
        h.Db.SaveChanges();
        return offer;
    }

    /// <summary>The offer's season (Feature flags) on or off for everyone; an offer shows only while its season is on.</summary>
    public static void Season(TestHarness h, string template, bool on)
    {
        var flag = h.Db.FeatureFlags.FirstOrDefault(f => f.Key == template);
        if (flag is null)
        {
            flag = FeatureFlag.Create(template, autoOffAtUtc: null, Start.AddDays(-30));
            h.Db.FeatureFlags.Add(flag);
        }
        flag.Set(on, adminPreview: false, autoOffAtUtc: null, Guid.NewGuid(), "francis@notefusion.studio", Start.AddDays(-30));
        h.Db.SaveChanges();
    }

    /// <summary>A verified account in <paramref name="country"/> (null: unknown), in <paramref name="zone"/> when given.</summary>
    public static User Account(
        TestHarness h, string email, string? country = "GB", string? zone = null, string name = "Grace Hopper",
        bool verified = true, DateTime? seen = null)
    {
        var user = User.Create(name, email, "hash", Start.AddDays(-60));
        if (verified) h.MarkEmailVerified(user);
        if (country is not null) user.RecordCountry(country);
        if (seen is { } at) user.MarkSeen(at);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        if (zone is not null)
        {
            h.Db.Entry(user).Property(u => u.TimeZone).CurrentValue = zone;
            h.Db.SaveChanges();
        }
        return user;
    }

    public static User AdminAccount(TestHarness h, string email = "francis@notefusion.studio")
    {
        var admin = User.CreateAdmin("Francis Admin", email, "hash", Start.AddDays(-90)); // verified from the start
        admin.RecordCountry("GB");
        h.Db.Users.Add(admin);
        h.Db.SaveChanges();
        return admin;
    }

    /// <summary>A membership of <paramref name="user"/>'s own, running until <paramref name="endsAtUtc"/>.</summary>
    public static void Subscribe(TestHarness h, User user, Plan plan, PaymentProvider provider, DateTime endsAtUtc)
    {
        h.Db.Subscriptions.Add(Subscription.Start(
            user.Id, plan.Id, provider, endsAtUtc.AddDays(-30), endsAtUtc, $"sub_{Guid.NewGuid():N}", endsAtUtc.AddDays(-30)));
        h.Db.SaveChanges();
    }

    /// <summary>A checkout at <paramref name="amountMinor"/>, paid and fulfilled when <paramref name="completed"/>.</summary>
    public static PaymentTransaction Payment(
        TestHarness h, User user, Plan plan, long amountMinor, Guid? offerId, DateTime at, bool completed = true)
    {
        var id = Guid.NewGuid().ToString("N");
        var tx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, $"checkout:NF_{id}", $"NF_{id}", amountMinor, "USD", at, CheckoutClient.Web, offerId);
        tx.AttachCheckout($"chk_{id}", $"https://pay.test/{id}", "{}", at);
        if (completed)
        {
            tx.MarkVerified($"chk_{id}", "{}", at);
            tx.MarkCompleted(at);
        }
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();
        return tx;
    }

    public static OfferSettings Settings(string postal = PostalAddress) => new() { PostalAddress = postal };

    /// <summary>A gateway that opens a session for anything and records what it was asked to charge.</summary>
    public sealed class FakeGateway : IPaymentGateway
    {
        public PaymentProvider Provider => PaymentProvider.Bachs;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["USD"];
        public List<GatewayInitiationRequest> Initiated { get; } = [];
        public int Verifications { get; private set; }

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
        {
            Initiated.Add(request);
            var n = Initiated.Count;
            return Task.FromResult(Result.Success(new GatewayInitiation($"https://pay.test/session-{n}", $"chk_{n}", "{}")));
        }

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
        {
            Verifications++;
            return Task.FromResult(Result.Success(new GatewayVerification(
                false, 0, "USD", "chk", null, "{}", Terminal: false)));
        }
    }

    public sealed class FakeFactory(IPaymentGateway gateway) : IPaymentGatewayFactory
    {
        public IPaymentGateway Resolve(PaymentProvider provider) => gateway;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success(gateway);
    }

    /// <summary>A quota with no room for optional mail.</summary>
    public sealed class NoRoom : IEmailQuota
    {
        public int Asked { get; private set; }

        public Task<bool> AllowsOptionalAsync(EmailKind kind, CancellationToken ct)
        {
            Asked++;
            return Task.FromResult(false);
        }

        public Task RecordSentAsync(EmailKind kind) => Task.CompletedTask;

        public Task<IReadOnlyList<NoteFusion.Application.Common.EmailWindowUsage>> ReadUsageAsync(CancellationToken ct)
            => Task.FromResult<IReadOnlyList<NoteFusion.Application.Common.EmailWindowUsage>>([]);
    }
}
