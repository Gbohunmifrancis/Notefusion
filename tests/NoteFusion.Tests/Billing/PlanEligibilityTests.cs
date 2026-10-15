using NoteFusion.Application.Billing;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Billing.Queries;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The geo split: a Nigerian account buys Pro in naira on a subscription, everyone else buys it once in
/// dollars. Two ends have to agree — the paywall list and the checkout — and only one of them is a control.
/// <para>
/// Hiding a plan from the list is presentation. <c>InitiateCheckoutCommand</c> takes a raw plan id, so a
/// client that has ever seen the other tier's id (an older build, another account, a shared screenshot) can
/// post it directly. That is the hole these tests hold shut, and it is worth holding: price naira to local
/// purchasing power and the gap between the two tiers becomes worth someone's afternoon.
/// </para>
/// </summary>
public class PlanEligibilityTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);

    // ---------------------------------------------------------------- the rule itself

    [Theory]
    [InlineData("NG", "NGN", true)]   // the naira tier, to the market it was priced for
    [InlineData("NG", "USD", false)]  // barred both ways: a lifetime sale undercuts the recurring tier
    [InlineData("GB", "USD", true)]
    [InlineData("US", "USD", true)]
    [InlineData("GB", "NGN", false)]  // the incentive to lie about your country
    [InlineData("ng", "ngn", true)]   // case is a storage detail, not a rule
    [InlineData(null, "USD", true)]   // unknown country is offered the dollar tier
    [InlineData("", "USD", true)]
    [InlineData(null, "NGN", false)]  // and not naira, which has to be earned by a known NG
    [InlineData("", "NGN", false)]
    public void Region_decides_which_currency_is_on_offer(string? country, string currency, bool offered)
    {
        Assert.Equal(offered, PlanEligibility.IsOffered(currency, country));
    }

    // ---------------------------------------------------------------- the list

    [Fact]
    public async Task A_nigerian_account_is_shown_naira_and_nothing_else()
    {
        using var h = new TestHarness(Now);
        var user = SeedPlansAndUser(h, "NG");

        var plans = await Plans(h, user);

        Assert.All(plans, p => Assert.Equal("NGN", p.Currency));
        Assert.Equal(2, plans.Count); // monthly and yearly
    }

    [Fact]
    public async Task An_international_account_is_shown_the_lifetime_and_nothing_else()
    {
        using var h = new TestHarness(Now);
        var user = SeedPlansAndUser(h, "GB");

        var plans = await Plans(h, user);

        var plan = Assert.Single(plans);
        Assert.Equal("USD", plan.Currency);
        Assert.Equal(BillingInterval.Lifetime, plan.Interval);
    }

    [Fact]
    public async Task An_account_with_no_known_country_is_shown_the_dollar_tier_only()
    {
        // Every account that predates country resolution, and anyone whose lookup failed. Showing them both
        // tiers handed the regional naira price to anyone who could make the lookup fail.
        using var h = new TestHarness(Now);
        var user = SeedPlansAndUser(h, null);

        var plans = await Plans(h, user);

        Assert.All(plans, p => Assert.Equal("USD", p.Currency));
        Assert.Single(plans);
    }

    [Fact]
    public async Task The_public_site_shows_only_nigerian_subscription_prices()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        h.Country.Country = "NG";

        var result = await PublicPlans(h);

        Assert.Equal("NG", result.CountryCode);
        Assert.Equal(2, result.Plans.Count);
        Assert.All(result.Plans, p => Assert.Equal("NGN", p.Currency));
        Assert.Contains(result.Plans, p => p.Code == "pro_monthly_ngn" && p.AmountMinor == 750_000);
        Assert.Contains(result.Plans, p => p.Code == "pro_yearly_ngn" && p.AmountMinor == 7_500_000);
    }

    [Fact]
    public async Task The_public_site_shows_only_the_international_lifetime_price()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        h.Country.Country = "GB";

        var result = await PublicPlans(h);

        Assert.Equal("GB", result.CountryCode);
        var plan = Assert.Single(result.Plans);
        Assert.Equal("pro_lifetime_v2", plan.Code);
        Assert.Equal(20_000, plan.AmountMinor);
        Assert.Equal("USD", plan.Currency);
        Assert.Equal(BillingInterval.Lifetime, plan.Interval);
    }

    [Fact]
    public async Task The_public_site_shows_no_price_when_location_is_unknown()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);

        var result = await PublicPlans(h);

        Assert.Null(result.CountryCode);
        Assert.Empty(result.Plans);
    }

    [Fact]
    public async Task The_offer_follows_the_account_not_the_request()
    {
        // The stored country is the whole reason it is stored. A Nigerian subscriber opening the app in
        // London must still see the plan they subscribed to, not a dollar lifetime they cannot use.
        using var h = new TestHarness(Now);
        var user = SeedPlansAndUser(h, "NG");
        h.Country.Country = "GB"; // where the request is coming from right now

        Assert.All(await Plans(h, user), p => Assert.Equal("NGN", p.Currency));
    }

    // ---------------------------------------------------------------- the control

    [Fact]
    public async Task An_international_user_posting_the_naira_plan_id_is_refused()
    {
        // The plan was never in their list. Getting a checkout here would mean the filter was the only
        // thing between an international buyer and Nigerian pricing.
        using var h = new TestHarness(Now);
        var user = SeedPlansAndUser(h, "GB");
        var naira = h.Db.Plans.Single(p => p.Code == "pro_monthly_ngn");
        var gateway = new CountingGateway();

        var result = await Checkout(h, user, gateway).Handle(new InitiateCheckoutCommand(naira.Id), default);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_PLAN_NOT_AVAILABLE_IN_REGION", result.Error.Code);

        // Refused before anything was written or called: no provider session to abandon, and no Pending row
        // for reconciliation to chase later.
        Assert.Empty(gateway.Initiations);
        Assert.Empty(h.Db.PaymentTransactions);
    }

    [Fact]
    public async Task A_nigerian_user_posting_the_lifetime_plan_id_is_refused()
    {
        using var h = new TestHarness(Now);
        var user = SeedPlansAndUser(h, "NG");
        var lifetime = h.Db.Plans.Single(p => p.Code == "pro_lifetime_v2");

        var result = await Checkout(h, user, new CountingGateway())
            .Handle(new InitiateCheckoutCommand(lifetime.Id), default);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_PLAN_NOT_AVAILABLE_IN_REGION", result.Error.Code);
    }

    [Fact]
    public async Task The_plan_a_user_was_actually_shown_still_opens_a_checkout()
    {
        // The other half of a control: proof it refuses the right thing and not everything.
        using var h = new TestHarness(Now);
        var user = SeedPlansAndUser(h, "NG");
        var naira = h.Db.Plans.Single(p => p.Code == "pro_monthly_ngn");
        var gateway = new CountingGateway();

        var result = await Checkout(h, user, gateway).Handle(new InitiateCheckoutCommand(naira.Id), default);

        Assert.True(result.IsSuccess);
        Assert.Single(gateway.Initiations);
    }

    [Fact]
    public async Task An_account_with_no_known_country_can_buy_dollars_but_not_naira()
    {
        using var h = new TestHarness(Now);
        var user = SeedPlansAndUser(h, null);
        var lifetime = h.Db.Plans.Single(p => p.Code == "pro_lifetime_v2");
        var naira = h.Db.Plans.Single(p => p.Code == "pro_monthly_ngn");

        var dollars = await Checkout(h, user, new CountingGateway())
            .Handle(new InitiateCheckoutCommand(lifetime.Id), default);
        var refused = await Checkout(h, user, new CountingGateway())
            .Handle(new InitiateCheckoutCommand(naira.Id), default);

        Assert.True(dollars.IsSuccess);
        Assert.Equal("BILLING_PLAN_NOT_AVAILABLE_IN_REGION", refused.Error.Code);
    }

    // ---------------------------------------------------------------- fixtures

    private static User SeedPlansAndUser(TestHarness h, string? country)
    {
        var user = User.Create("Pat Payer", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-2));
        user.RecordCountry(country);

        h.Db.Users.Add(user);
        SeedPlans(h);
        return user;
    }

    private static void SeedPlans(TestHarness h)
    {
        h.Db.Plans.AddRange(
            Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "Pro Monthly", 750_000, "NGN", BillingInterval.Monthly),
            Plan.Create(Guid.NewGuid(), "pro_yearly_ngn", "Pro Yearly", 7_500_000, "NGN", BillingInterval.Yearly),
            Plan.Create(Guid.NewGuid(), "pro_lifetime_v2", "Pro Lifetime", 20_000, "USD", BillingInterval.Lifetime));
        h.Db.SaveChanges();
    }

    private static async Task<IReadOnlyList<PlanDto>> Plans(TestHarness h, User user)
    {
        var result = await new GetPlansQueryHandler(h.Db, new StubCurrentUser(user.Id))
            .Handle(new GetPlansQuery(), default);

        Assert.True(result.IsSuccess);
        return result.Value;
    }

    private static async Task<PublicPricingDto> PublicPlans(TestHarness h)
    {
        var result = await new GetPublicPricingQueryHandler(h.Db, h.Country)
            .Handle(new GetPublicPricingQuery(), default);

        Assert.True(result.IsSuccess);
        return result.Value;
    }

    private static InitiateCheckoutCommandHandler Checkout(TestHarness h, User user, CountingGateway gateway)
        => new(h.Db, new StubCurrentUser(user.Id), new FixedFactory(gateway), h.Clock, new BillingSettings(), h.Email);

    /// <summary>Records what it was asked to open, so a refusal can be told apart from a silent success.</summary>
    private sealed class CountingGateway : IPaymentGateway
    {
        public PaymentProvider Provider => PaymentProvider.Paystack;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["NGN", "USD"];

        public List<string> Initiations { get; } = [];

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
        {
            Initiations.Add(request.Reference);
            return Task.FromResult(Result.Success(
                new GatewayInitiation("https://pay.test/session", "chk_1", "{}")));
        }

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
            => throw new NotSupportedException("Eligibility tests never verify.");
    }

    private sealed class FixedFactory : IPaymentGatewayFactory
    {
        private readonly IPaymentGateway _gateway;

        public FixedFactory(IPaymentGateway gateway) => _gateway = gateway;

        public IPaymentGateway Resolve(PaymentProvider provider) => _gateway;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success(_gateway);
    }
}
