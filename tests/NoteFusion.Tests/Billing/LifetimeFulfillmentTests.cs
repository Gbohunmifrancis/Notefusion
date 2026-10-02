using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Billing.Queries;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Email;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// A plan bought once and never renewed. Everything here guards the same hazard from a different side:
/// <c>Lifetime</c> is a value on an enum whose consumers were all written when there were only two, so
/// the default branch each of them fell into silently means "a year". A lifetime buyer given twelve
/// months looks correct on the day of purchase and fails a year later, when the customer has long since
/// closed the receipt and we have no record of what they were promised.
/// <para>
/// The period end is a far-future sentinel rather than a null, so the entitlement gate needed no change.
/// The cost of that choice is that the sentinel must never reach a human: a receipt reading "renews on
/// 31 December 9999" is the tell, and the last person who should see a bug is the one who just paid the
/// most.
/// </para>
/// </summary>
public class LifetimeFulfillmentTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);
    private const long LifetimePrice = 7900; // $79.00

    // ---------------------------------------------------------------- the period

    [Fact]
    public async Task A_lifetime_purchase_grants_access_that_does_not_expire()
    {
        using var h = new TestHarness(Now);
        var (user, plan, tx) = Seed(h, BillingInterval.Lifetime, LifetimePrice);

        await Fulfil(h, tx);

        var sub = Assert.Single(h.Db.Subscriptions);
        Assert.Equal(Subscription.LifetimeEndUtc, sub.CurrentPeriodEndUtc);
        Assert.True(sub.IsLifetime);

        // The gate is the only thing that matters to the customer, and it is unchanged: still just
        // "is now before the period end". A century from now is as good as forever.
        Assert.True(sub.IsActiveAt(Now.AddYears(100)));
        Assert.Equal(plan.Id, sub.PlanId);
        Assert.Equal(user.Id, sub.UserId);
    }

    [Fact]
    public async Task A_lifetime_purchase_is_not_quietly_worth_one_year()
    {
        // The regression this whole class exists for. `Advance` used to be a two-way ternary whose else
        // branch meant AddYears(1), so adding a third interval would have shipped green.
        using var h = new TestHarness(Now);
        var (_, _, tx) = Seed(h, BillingInterval.Lifetime, LifetimePrice);

        await Fulfil(h, tx);

        var sub = Assert.Single(h.Db.Subscriptions);
        Assert.NotEqual(Now.AddYears(1), sub.CurrentPeriodEndUtc);
        Assert.True(sub.IsActiveAt(Now.AddYears(5)));
    }

    [Fact]
    public async Task A_monthly_subscriber_who_buys_lifetime_ends_up_lifetime()
    {
        // Upgrading mid-period must not merely stack a month, and must not discard the remainder either.
        using var h = new TestHarness(Now);
        var (user, plan, tx) = Seed(h, BillingInterval.Lifetime, LifetimePrice);

        h.Db.Subscriptions.Add(Subscription.Start(
            user.Id, plan.Id, PaymentProvider.Paystack, Now.AddDays(-10), Now.AddDays(20), "sub_old", Now.AddDays(-10)));
        await h.Db.SaveChangesAsync(CancellationToken.None);

        await Fulfil(h, tx);

        var sub = Assert.Single(h.Db.Subscriptions);
        Assert.True(sub.IsLifetime);
    }

    [Fact]
    public async Task Once_lifetime_a_later_charge_cannot_shorten_it()
    {
        // Whatever the second payment is for — a mistaken monthly, a gift, a duplicate — access already
        // paid for in full must not be traded back for a month. Advancing FROM the sentinel would also
        // overflow DateTime, so this branch has to short-circuit rather than compute.
        using var h = new TestHarness(Now);
        var (user, plan, tx) = Seed(h, BillingInterval.Monthly, 499);

        h.Db.Subscriptions.Add(Subscription.Start(
            user.Id, plan.Id, PaymentProvider.Bachs, Now.AddDays(-30),
            Subscription.LifetimeEndUtc, null, Now.AddDays(-30)));
        await h.Db.SaveChangesAsync(CancellationToken.None);

        await Fulfil(h, tx, amountMinor: 499);

        var sub = Assert.Single(h.Db.Subscriptions);
        Assert.True(sub.IsLifetime);

        // The money is still recorded — the payment happened, and the ledger is the audit trail.
        Assert.Single(h.Db.LedgerEntries);
    }

    // ---------------------------------------------------------------- what the customer sees

    [Fact]
    public async Task A_lifetime_receipt_carries_no_renewal_date_at_all()
    {
        using var h = new TestHarness(Now);
        var (_, _, tx) = Seed(h, BillingInterval.Lifetime, LifetimePrice);

        await Fulfil(h, tx);

        var receipt = Assert.Single(h.Email.Receipts);

        // Null rather than the sentinel: a renderer handed 9999 will print it, and every one of them
        // would have to remember not to. Nothing to format is the only version that cannot go wrong.
        Assert.Null(receipt.RenewsAtUtc);
        Assert.Equal(LifetimePrice, receipt.AmountMinor);
    }

    [Fact]
    public async Task A_monthly_receipt_still_states_when_it_renews()
    {
        using var h = new TestHarness(Now);
        var (_, _, tx) = Seed(h, BillingInterval.Monthly, 499);

        await Fulfil(h, tx, amountMinor: 499);

        Assert.Equal(Now.AddMonths(1), Assert.Single(h.Email.Receipts).RenewsAtUtc);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void No_rendered_receipt_ever_shows_the_sentinel_year(bool lifetime)
    {
        var template = new BrandedEmailTemplate(new EmailSettings());
        var receipt = new SubscriptionReceipt(
            "NoteFusion Pro", LifetimePrice, "USD",
            lifetime ? null : Now.AddMonths(1), "NF_abc123");

        var message = template.SubscriptionReceipt(new EmailRecipient("pat@example.com", "Pat"), receipt);

        Assert.DoesNotContain("9999", message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("9999", message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("9999", message.Subject, StringComparison.Ordinal);

        if (lifetime)
        {
            // A one-off buyer told to "cancel any time" would go looking for a subscription that does not
            // exist, and conclude they had been charged for one.
            Assert.Contains("Lifetime", message.HtmlBody, StringComparison.Ordinal);
            Assert.DoesNotContain("Renews on", message.HtmlBody, StringComparison.Ordinal);
        }
        else
        {
            Assert.Contains("Pro until", message.HtmlBody, StringComparison.Ordinal);
            Assert.DoesNotContain("Renews on", message.HtmlBody, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task The_app_is_told_it_is_lifetime_rather_than_left_to_read_the_sentinel()
    {
        using var h = new TestHarness(Now);
        var (user, _, tx) = Seed(h, BillingInterval.Lifetime, LifetimePrice);

        await Fulfil(h, tx);

        var result = await new GetMySubscriptionQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, h.Device)
            .Handle(new GetMySubscriptionQuery(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.IsActive);

        // Without this flag the app formats CurrentPeriodEndUtc and shows "Next Renewal Date:
        // December 31, 9999" on the paywall of the customer who paid the most.
        Assert.True(result.Value.IsLifetime);
    }

    [Fact]
    public async Task A_monthly_subscription_is_not_reported_as_lifetime()
    {
        using var h = new TestHarness(Now);
        var (user, _, tx) = Seed(h, BillingInterval.Monthly, 499);

        await Fulfil(h, tx, amountMinor: 499);

        var result = await new GetMySubscriptionQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, h.Device)
            .Handle(new GetMySubscriptionQuery(), CancellationToken.None);

        Assert.False(result.Value.IsLifetime);
        Assert.Equal(Now.AddMonths(1), result.Value.CurrentPeriodEndUtc);
    }

    // ---------------------------------------------------------------- fixtures

    private static (User User, Plan Plan, PaymentTransaction Transaction) Seed(
        TestHarness h, BillingInterval interval, long amountMinor)
    {
        var user = User.Create("Pat Payer", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-2));
        var plan = Plan.Create(
            Guid.NewGuid(), interval == BillingInterval.Lifetime ? "pro_lifetime" : "pro_monthly",
            "NoteFusion Pro", amountMinor, "USD", interval);

        var tx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, "checkout:NF_life", "NF_life",
            amountMinor, "USD", Now.AddMinutes(-5));
        tx.AttachCheckout("chk_life", "https://pay.test/session", "{}", Now.AddMinutes(-5));

        h.Db.Users.Add(user);
        h.Db.Plans.Add(plan);
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();

        return (user, plan, tx);
    }

    /// <summary>Drives fulfilment the way production does — through the webhook handler, not directly.</summary>
    private static async Task Fulfil(TestHarness h, PaymentTransaction tx, long amountMinor = LifetimePrice)
    {
        var e = WebhookEvent.Receive(
            PaymentProvider.Bachs, "evt_paid", "charge.success", tx.Reference, "{}", Now);
        h.Db.WebhookEvents.Add(e);
        await h.Db.SaveChangesAsync(CancellationToken.None);

        var verification = new GatewayVerification(
            Succeeded: true, AmountMinor: amountMinor, Currency: "USD", ProviderReference: "chk_life",
            ProviderSubscriptionRef: null, Raw: "{}", Terminal: true);

        var result = await new ProcessWebhookEventCommandHandler(
                h.Db, new FixedGatewayFactory(verification), h.Clock, h.Email)
            .Handle(new ProcessWebhookEventCommand(e.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
    }

    private sealed class FixedGatewayFactory : IPaymentGatewayFactory, IPaymentGateway
    {
        private readonly GatewayVerification _answer;

        public FixedGatewayFactory(GatewayVerification answer) => _answer = answer;

        public PaymentProvider Provider => PaymentProvider.Bachs;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["USD"];

        public IPaymentGateway Resolve(PaymentProvider provider) => this;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success<IPaymentGateway>(this);

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
            => throw new NotSupportedException("Fulfilment tests never open a checkout.");

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
            => Task.FromResult(Result.Success(_answer));
    }
}
