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
/// The regional dollar tier: lower prices for the rest of Africa and for South and Southeast Asia. Each known
/// country sees exactly one set — naira, regional dollars or standard dollars — and the checkout refuses any
/// plan from another set, because the cheaper set is worth asking for by id. An unknown country keeps what it
/// always saw (naira and standard dollars), never the regional set.
/// </summary>
public class RegionalPricingTests
{
    private static readonly DateTime Now = new(2026, 10, 15, 12, 0, 0, DateTimeKind.Utc);

    private static readonly string[] Naira = ["one_song_ngn", "pro_monthly_ngn", "pro_yearly_ngn_v2"];
    private static readonly string[] Standard = ["one_song_usd", "pro_monthly_usd", "pro_yearly_usd"];
    private static readonly string[] Regional = ["one_song_usd_regional_v2", "pro_monthly_usd_regional", "pro_yearly_usd_regional"];

    [Theory]
    [InlineData("NG", "naira")]
    [InlineData("GB", "standard")]
    [InlineData("US", "standard")]
    [InlineData("KE", "regional")]  // East Africa
    [InlineData("GH", "regional")]  // West Africa, outside Nigeria
    [InlineData("ZA", "regional")]  // Southern Africa
    [InlineData("EG", "regional")]  // North Africa
    [InlineData("IN", "regional")]  // South Asia
    [InlineData("BD", "regional")]
    [InlineData("ID", "regional")]  // Southeast Asia
    [InlineData("VN", "regional")]
    [InlineData("CN", "standard")]  // Asia outside the list
    [InlineData("AE", "standard")]
    public async Task Each_known_country_is_shown_one_set(string country, string set)
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var user = SeedUser(h, country);

        var codes = (await Plans(h, user)).Select(p => p.Code).Order().ToArray();

        Assert.Equal(set switch { "naira" => Naira, "regional" => Regional, _ => Standard }, codes);
    }

    [Fact]
    public async Task An_unknown_country_keeps_naira_and_standard_dollars_and_not_the_regional_set()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var user = SeedUser(h, null);

        var codes = (await Plans(h, user)).Select(p => p.Code).Order().ToArray();

        Assert.Equal(Naira.Concat(Standard).Order().ToArray(), codes);
    }

    [Fact]
    public async Task The_regional_prices_are_the_lower_ones()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var user = SeedUser(h, "KE");

        var plans = await Plans(h, user);

        Assert.Equal(100, plans.Single(p => p.Interval == BillingInterval.Single).AmountMinor);
        Assert.Equal(499, plans.Single(p => p.Interval == BillingInterval.Monthly).AmountMinor);
        Assert.Equal(3_999, plans.Single(p => p.Interval == BillingInterval.Yearly).AmountMinor);
    }

    [Theory]
    [InlineData("GB", "pro_monthly_usd_regional")] // the cheaper set, asked for by id
    [InlineData("GB", "one_song_usd_regional_v2")]
    [InlineData(null, "pro_yearly_usd_regional")]  // a failed lookup is not a discount
    [InlineData("NG", "one_song_usd_regional_v2")]
    [InlineData("KE", "pro_monthly_usd")]          // and the regional countries buy the regional set
    [InlineData("KE", "one_song_ngn")]
    public async Task Checkout_refuses_a_plan_from_another_set(string? country, string code)
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var user = SeedUser(h, country);
        var plan = h.Db.Plans.Single(p => p.Code == code);

        var result = await Checkout(h, user).Handle(new InitiateCheckoutCommand(plan.Id), default);

        Assert.Equal("BILLING_PLAN_NOT_AVAILABLE_IN_REGION", result.Error.Code);
        Assert.Empty(h.Db.PaymentTransactions);
    }

    [Theory]
    [InlineData("KE", "pro_monthly_usd_regional")]
    [InlineData("IN", "one_song_usd_regional_v2")]
    [InlineData("GB", "one_song_usd")]
    [InlineData("NG", "one_song_ngn")]
    [InlineData(null, "pro_monthly_usd")]
    public async Task Checkout_opens_for_a_plan_in_the_accounts_set(string? country, string code)
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var user = SeedUser(h, country);
        var plan = h.Db.Plans.Single(p => p.Code == code);

        var result = await Checkout(h, user).Handle(new InitiateCheckoutCommand(plan.Id), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(plan.AmountMinor, h.Db.PaymentTransactions.Single().AmountMinor);
    }

    [Fact]
    public async Task The_public_site_shows_a_regional_visitor_the_regional_set()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        h.Country.Country = "GH";

        var result = (await new GetPublicPricingQueryHandler(h.Db, h.Country).Handle(new GetPublicPricingQuery(), default)).Value;

        // The one-song purchase is not on the public page: it shows Pro Monthly and Pro Yearly.
        Assert.Equal(Regional.Where(c => !c.StartsWith("one_song")).ToArray(), result.Plans.Select(p => p.Code).Order().ToArray());
    }

    [Fact]
    public void The_country_list_leaves_out_nigeria_and_covers_the_named_asian_markets()
    {
        Assert.DoesNotContain("NG", PlanEligibility.RegionalCountries);
        foreach (var asia in new[] { "IN", "PK", "BD", "LK", "NP", "ID", "PH", "VN", "MM", "KH", "LA" })
            Assert.Contains(asia, PlanEligibility.RegionalCountries);
        Assert.Equal(54 + 11, PlanEligibility.RegionalCountries.Count); // 53 African states + Western Sahara, 11 Asian
    }

    // ---------------------------------------------------------------- fixtures

    private static void SeedPlans(TestHarness h)
    {
        h.Db.Plans.AddRange(
            Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "NoteFusion Pro (Monthly)", 750_000, "NGN", BillingInterval.Monthly),
            Plan.Create(Guid.NewGuid(), "pro_yearly_ngn_v2", "NoteFusion Pro (Yearly)", 6_000_000, "NGN", BillingInterval.Yearly),
            Plan.Create(Guid.NewGuid(), "one_song_ngn", "One song", 150_000, "NGN", BillingInterval.Single),
            Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro (Monthly)", 999, "USD", BillingInterval.Monthly),
            Plan.Create(Guid.NewGuid(), "pro_yearly_usd", "NoteFusion Pro (Yearly)", 7_900, "USD", BillingInterval.Yearly),
            Plan.Create(Guid.NewGuid(), "one_song_usd", "One song", 199, "USD", BillingInterval.Single),
            Plan.Create(Guid.NewGuid(), "pro_monthly_usd_regional", "NoteFusion Pro (Monthly)", 499, "USD", BillingInterval.Monthly),
            Plan.Create(Guid.NewGuid(), "pro_yearly_usd_regional", "NoteFusion Pro (Yearly)", 3_999, "USD", BillingInterval.Yearly),
            Plan.Create(Guid.NewGuid(), "one_song_usd_regional_v2", "One song", 100, "USD", BillingInterval.Single));
        h.Db.SaveChanges();
    }

    private static User SeedUser(TestHarness h, string? country)
    {
        var user = User.Create("Pat Payer", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-2));
        user.RecordCountry(country);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    /// <summary>Everything the account is offered: the Pro list and the one-song purchase, listed apart.</summary>
    private static async Task<IReadOnlyList<PlanDto>> Plans(TestHarness h, User user)
    {
        var handler = new GetPlansQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock);
        var pro = (await handler.Handle(new GetPlansQuery(), default)).Value;
        var single = (await handler.Handle(new GetPlansQuery(Single: true), default)).Value;
        return pro.Concat(single).ToList();
    }

    private static InitiateCheckoutCommandHandler Checkout(TestHarness h, User user)
        => new(h.Db, new StubCurrentUser(user.Id), new OpenGateway(), h.Clock, new BillingSettings(), h.Email);

    private sealed class OpenGateway : IPaymentGatewayFactory, IPaymentGateway
    {
        public PaymentProvider Provider => PaymentProvider.Bachs;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["NGN", "USD"];
        public IPaymentGateway Resolve(PaymentProvider provider) => this;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success<IPaymentGateway>(this);

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
            => Task.FromResult(Result.Success(new GatewayInitiation("https://pay.bachs.io/s", "chk_1", "{}")));

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
            => throw new NotSupportedException();
    }
}
