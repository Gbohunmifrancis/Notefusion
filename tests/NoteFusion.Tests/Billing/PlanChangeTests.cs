using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// Nothing renews by itself, so a member buys again to continue, to switch plans, or to keep Pro after
/// cancelling; the payment moves the membership onto the plan paid for with the remaining time stacked.
/// Only lifetime access has nothing more to buy.
/// </summary>
public class PlanChangeTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Buying_the_plan_already_running_adds_a_period_after_the_one_paid_for()
    {
        // Nothing renews by itself, so buying again is how Pro continues; the time left is kept.
        using var h = new TestHarness(Now);
        var (user, monthly, _) = Seed(h);
        var gateway = new FakeGateway();
        var periodEnd = h.Db.Subscriptions.Single().CurrentPeriodEndUtc;

        var checkout = await Checkout(h, user, gateway).Handle(new InitiateCheckoutCommand(monthly.Id), default);
        Assert.True(checkout.IsSuccess);
        await Pay(h, gateway, checkout.Value.Reference);

        var sub = h.Db.Subscriptions.Single();
        Assert.Equal(monthly.Id, sub.PlanId);
        Assert.Equal(periodEnd.AddMonths(1), sub.CurrentPeriodEndUtc);
    }

    [Fact]
    public async Task Every_checkout_is_a_single_charge_priced_from_the_plan()
    {
        using var h = new TestHarness(Now);
        var (user, monthly, _) = Seed(h);
        var gateway = new FakeGateway();

        await Checkout(h, user, gateway).Handle(new InitiateCheckoutCommand(monthly.Id), default);

        var request = Assert.Single(gateway.Requests);
        Assert.False(request.Recurring);
        Assert.Equal(monthly.AmountMinor, request.AmountMinor);
    }

    [Fact]
    public async Task A_provider_refusal_reaches_the_customer_as_plain_words_not_the_providers_text()
    {
        using var h = new TestHarness(Now);
        var (user, monthly, _) = Seed(h);
        var gateway = new FakeGateway { Refusal = Error.Validation("Bachs.Initiate", "Bachs returned 400: CHECKOUT_CANNOT_SAVE_PAYMENT_METHOD") };

        var result = await Checkout(h, user, gateway).Handle(new InitiateCheckoutCommand(monthly.Id), default);

        Assert.True(result.IsFailure);
        Assert.DoesNotContain("Bachs", result.Error.Message);
        Assert.DoesNotContain("400", result.Error.Message);
        // The reason is kept where an operator can read it.
        Assert.Contains("CHECKOUT_CANNOT_SAVE_PAYMENT_METHOD", h.Db.PaymentTransactions.Single().FailureReason);
    }

    [Fact]
    public async Task A_member_who_cancelled_can_buy_again_to_keep_pro()
    {
        using var h = new TestHarness(Now);
        var (user, monthly, _) = Seed(h);
        h.Db.Subscriptions.Single().Cancel(Now.AddDays(-1));
        h.Db.SaveChanges();

        var result = await Checkout(h, user, new FakeGateway()).Handle(new InitiateCheckoutCommand(monthly.Id), default);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task Switching_to_yearly_moves_the_membership_and_stacks_the_time_left()
    {
        using var h = new TestHarness(Now);
        var (user, _, yearly) = Seed(h);
        var gateway = new FakeGateway();
        var periodEnd = h.Db.Subscriptions.Single().CurrentPeriodEndUtc;

        var checkout = await Checkout(h, user, gateway).Handle(new InitiateCheckoutCommand(yearly.Id), default);
        Assert.True(checkout.IsSuccess);

        Assert.True((await Pay(h, gateway, checkout.Value.Reference)).IsSuccess);
        var sub = h.Db.Subscriptions.Single();
        Assert.Equal(yearly.Id, sub.PlanId);
        Assert.Equal(periodEnd.AddYears(1), sub.CurrentPeriodEndUtc);
        Assert.Equal(SubscriptionStatus.Active, sub.Status);
    }

    [Fact]
    public async Task A_cancelled_member_who_pays_again_is_not_cancelled_any_more()
    {
        using var h = new TestHarness(Now);
        var (user, monthly, _) = Seed(h);
        h.Db.Subscriptions.Single().Cancel(Now.AddDays(-1));
        h.Db.SaveChanges();
        var gateway = new FakeGateway();

        var checkout = await Checkout(h, user, gateway).Handle(new InitiateCheckoutCommand(monthly.Id), default);
        await Pay(h, gateway, checkout.Value.Reference);

        var sub = h.Db.Subscriptions.Single();
        Assert.Equal(SubscriptionStatus.Active, sub.Status);
        Assert.Null(sub.CanceledAtUtc);
    }

    [Fact]
    public async Task A_lifetime_member_has_nothing_more_to_buy()
    {
        using var h = new TestHarness(Now);
        var (user, monthly, _) = Seed(h, lifetime: true);

        var result = await Checkout(h, user, new FakeGateway()).Handle(new InitiateCheckoutCommand(monthly.Id), default);

        Assert.Equal("BILLING_ALREADY_LIFETIME", result.Error.Code);
    }

    private static (User User, Plan Monthly, Plan Yearly) Seed(TestHarness h, bool lifetime = false)
    {
        var user = User.Create("Pat Payer", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-40));
        var monthly = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro (Monthly)", 499, "USD", BillingInterval.Monthly);
        var yearly = Plan.Create(Guid.NewGuid(), "pro_yearly_usd", "NoteFusion Pro (Yearly)", 499, "USD", BillingInterval.Yearly);
        h.Db.Users.Add(user);
        h.Db.Plans.AddRange(monthly, yearly);
        h.Db.Subscriptions.Add(Subscription.Start(
            user.Id, monthly.Id, PaymentProvider.Bachs, Now.AddDays(-10),
            lifetime ? Subscription.LifetimeEndUtc : Now.AddDays(20), "sub_1", Now.AddDays(-10)));
        h.Db.SaveChanges();
        return (user, monthly, yearly);
    }

    private static async Task<Result> Pay(TestHarness h, FakeGateway gateway, string reference)
    {
        var e = WebhookEvent.Receive(PaymentProvider.Bachs, $"evt_{reference}", "checkout.completed", reference, "{}", Now);
        h.Db.WebhookEvents.Add(e);
        h.Db.SaveChanges();
        return await new ProcessWebhookEventCommandHandler(h.Db, new FakeFactory(gateway), h.Clock, h.Email)
            .Handle(new ProcessWebhookEventCommand(e.Id), default);
    }

    private static InitiateCheckoutCommandHandler Checkout(TestHarness h, User user, FakeGateway gateway)
        => new(h.Db, new StubCurrentUser(user.Id), new FakeFactory(gateway), h.Clock, new BillingSettings(), h.Email);

    private sealed class FakeGateway : IPaymentGateway
    {
        public List<string> Initiated { get; } = [];
        public List<GatewayInitiationRequest> Requests { get; } = [];
        public Error? Refusal { get; init; }
        public PaymentProvider Provider => PaymentProvider.Bachs;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["USD"];

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
        {
            Initiated.Add(request.Reference);
            Requests.Add(request);
            if (Refusal is not null)
                return Task.FromResult(Result.Failure<GatewayInitiation>(Refusal));
            return Task.FromResult(Result.Success(new GatewayInitiation($"https://pay.test/{request.Reference}", $"chk_{Initiated.Count}", "{}")));
        }

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
            => Task.FromResult(Result.Success(new GatewayVerification(
                true, AmountMinor: 499, Currency: "USD", ProviderReference: "chk_1",
                ProviderSubscriptionRef: "sub_1", Raw: "{}", Terminal: false)));
    }

    private sealed class FakeFactory(IPaymentGateway gateway) : IPaymentGatewayFactory
    {
        public IPaymentGateway Resolve(PaymentProvider provider) => gateway;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success(gateway);
    }
}
