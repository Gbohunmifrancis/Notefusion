using Microsoft.Extensions.Configuration;
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
/// What happens to a checkout the customer opened and never paid — and whether they can try again.
/// <para>
/// A hosted checkout is reused while it is in flight, which is what stops a double-tap on Upgrade from
/// opening two charges. The cost of that is a hard dependency on something eventually closing a session
/// that has died: while the transaction sits <c>Processing</c>, every later attempt is handed the same
/// URL. Bachs expires an unpaid session after an hour and says so by webhook, so a build that files that
/// event away without touching the transaction leaves the user pointed at a dead page permanently, with
/// no route back except a database edit. That is the regression these tests exist to catch.
/// </para>
/// <para>
/// The opposite mistake is just as expensive, so it is pinned here too: closing a session the customer
/// can still pay means the next attempt opens a second charge beside a live one.
/// </para>
/// </summary>
public class CheckoutRetryTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);
    private const string DeadUrl = "https://pay.test/first-session";

    // ---------------------------------------------------------------- expired: the user must get a retry

    [Fact]
    public async Task An_expired_checkout_closes_the_transaction_and_not_merely_the_event()
    {
        using var h = new TestHarness(Now);
        var (_, _, tx) = SeedCheckoutInFlight(h);
        var e = Expiry(h, tx);
        var handler = WebhookHandler(h, Answer(Succeeded: false, Terminal: true));

        var result = await handler.Handle(new ProcessWebhookEventCommand(e.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(WebhookStatus.Processed, e.Status);

        // The row itself has to leave Processing. Left in flight it still reads as a payable checkout.
        Assert.Equal(PaymentStatus.Failed, tx.Status);
        Assert.Contains("checkout.expired", tx.FailureReason);
    }

    [Fact]
    public async Task After_a_checkout_expires_the_next_attempt_opens_a_new_session_instead_of_the_dead_one()
    {
        using var h = new TestHarness(Now);
        var (user, plan, tx) = SeedCheckoutInFlight(h);
        var gateway = new FakeGateway(Answer(Succeeded: false, Terminal: true));

        // The provider tells us the session died, exactly as it does in production.
        await WebhookHandler(h, gateway).Handle(new ProcessWebhookEventCommand(Expiry(h, tx).Id), CancellationToken.None);

        var checkout = await CheckoutHandler(h, user, gateway)
            .Handle(new InitiateCheckoutCommand(plan.Id), CancellationToken.None);

        Assert.True(checkout.IsSuccess);

        // The whole point: a live URL, and a reference of its own so the new session can be verified and
        // fulfilled independently of the abandoned one.
        Assert.NotEqual(DeadUrl, checkout.Value.CheckoutUrl);
        Assert.NotEqual(tx.Reference, checkout.Value.Reference);
        Assert.Equal(checkout.Value.Reference, Assert.Single(gateway.InitiatedReferences));
    }

    [Fact]
    public async Task Reconciliation_closes_an_expired_checkout_when_the_webhook_never_arrived()
    {
        using var h = new TestHarness(Now);
        var (_, _, tx) = SeedCheckoutInFlight(h);
        var handler = new ReconcilePaymentCommandHandler(
            h.Db, new FakeFactory(new FakeGateway(Answer(Succeeded: false, Terminal: true))), h.Clock, h.Email);

        var result = await handler.Handle(new ReconcilePaymentCommand(tx.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(PaymentStatus.Failed, tx.Status);
    }

    [Fact]
    public async Task An_expiry_is_not_reported_to_the_customer_as_a_failed_payment()
    {
        using var h = new TestHarness(Now);
        var (_, _, tx) = SeedCheckoutInFlight(h);

        await WebhookHandler(h, Answer(Succeeded: false, Terminal: true))
            .Handle(new ProcessWebhookEventCommand(Expiry(h, tx).Id), CancellationToken.None);

        // Nobody was charged and nothing was declined — they walked away from a cart. Mailing them about
        // a payment failure would be a lie, and an alarming one.
        Assert.Empty(h.Email.Sent);
    }

    // ---------------------------------------------------------------- still open: no second charge

    [Fact]
    public async Task A_checkout_the_customer_could_still_pay_stays_in_flight_and_is_reused()
    {
        using var h = new TestHarness(Now);
        var (user, plan, tx) = SeedCheckoutInFlight(h, openedAtUtc: Now.AddMinutes(-10));

        // Paystack's `abandoned`: the customer left the page, but the link is still payable.
        var gateway = new FakeGateway(Answer(Succeeded: false, Terminal: false));
        var e = WebhookEvent.Receive(
            PaymentProvider.Bachs, "evt_abandoned", "charge.failed", tx.Reference, "{}", Now);
        h.Db.WebhookEvents.Add(e);
        await h.Db.SaveChangesAsync(CancellationToken.None);

        await WebhookHandler(h, gateway).Handle(new ProcessWebhookEventCommand(e.Id), CancellationToken.None);

        Assert.Equal(PaymentStatus.Processing, tx.Status);

        var checkout = await CheckoutHandler(h, user, gateway)
            .Handle(new InitiateCheckoutCommand(plan.Id), CancellationToken.None);

        // Same session handed back, and the provider was never asked for another one: a customer who is
        // mid-payment must not end up with two open charges.
        Assert.Equal(DeadUrl, checkout.Value.CheckoutUrl);
        Assert.Equal(tx.Reference, checkout.Value.Reference);
        Assert.Empty(gateway.InitiatedReferences);
    }

    [Fact]
    public async Task Reconciliation_leaves_a_checkout_that_is_merely_unpaid_alone()
    {
        using var h = new TestHarness(Now);
        var (_, _, tx) = SeedCheckoutInFlight(h);
        var handler = new ReconcilePaymentCommandHandler(
            h.Db, new FakeFactory(new FakeGateway(Answer(Succeeded: false, Terminal: false))), h.Clock, h.Email);

        await handler.Handle(new ReconcilePaymentCommand(tx.Id), CancellationToken.None);

        Assert.Equal(PaymentStatus.Processing, tx.Status);
    }

    // ---------------------------------------------------------------- too old to hand out again

    [Fact]
    public async Task An_open_checkout_older_than_the_reuse_window_is_asked_about_and_then_replaced()
    {
        // Bachs kills an unpaid session after an hour whether or not anyone tells us, so an old one is no
        // longer handed back: it might be about to die under the customer.
        using var h = new TestHarness(Now);
        var (user, plan, tx) = SeedCheckoutInFlight(h, openedAtUtc: Now.AddMinutes(-45));
        var gateway = new FakeGateway(Answer(Succeeded: false, Terminal: false));

        var checkout = await CheckoutHandler(h, user, gateway)
            .Handle(new InitiateCheckoutCommand(plan.Id), CancellationToken.None);

        Assert.True(checkout.IsSuccess);
        Assert.NotEqual(DeadUrl, checkout.Value.CheckoutUrl);
        Assert.NotEqual(tx.Reference, checkout.Value.Reference);
        Assert.Equal(1, gateway.Verifications); // asked before replacing, in case it had been paid
        Assert.Equal(PaymentStatus.Processing, tx.Status); // still payable, so not closed on our say-so
    }

    [Fact]
    public async Task An_old_checkout_that_was_paid_is_fulfilled_instead_of_charging_again()
    {
        // Often why the customer is back: they paid, the webhook went astray, and they see no Pro. Opening a
        // second charge would sell them a period they never meant to buy.
        using var h = new TestHarness(Now);
        var (user, plan, tx) = SeedCheckoutInFlight(h, openedAtUtc: Now.AddMinutes(-45));
        var gateway = new FakeGateway(Answer(Succeeded: true, Terminal: true));

        var checkout = await CheckoutHandler(h, user, gateway)
            .Handle(new InitiateCheckoutCommand(plan.Id), CancellationToken.None);

        Assert.True(checkout.IsFailure);
        Assert.Equal("BILLING_PAYMENT_ALREADY_RECEIVED", checkout.Error.Code);
        Assert.DoesNotContain("Bachs", checkout.Error.Message);
        Assert.Empty(gateway.InitiatedReferences);
        Assert.Equal(PaymentStatus.Completed, tx.Status);
        Assert.Single(h.Db.Subscriptions);
        Assert.Single(h.Email.Receipts);
    }

    [Fact]
    public async Task An_old_checkout_the_provider_cannot_answer_for_does_not_block_a_new_one()
    {
        using var h = new TestHarness(Now);
        var (user, plan, tx) = SeedCheckoutInFlight(h, openedAtUtc: Now.AddMinutes(-45));
        var gateway = new FakeGateway(Error.Network("Bachs.Verify", "Timed out."));

        var checkout = await CheckoutHandler(h, user, gateway)
            .Handle(new InitiateCheckoutCommand(plan.Id), CancellationToken.None);

        Assert.True(checkout.IsSuccess);
        Assert.Single(gateway.InitiatedReferences);
        Assert.Equal(PaymentStatus.Processing, tx.Status);
    }

    [Fact]
    public async Task The_reuse_window_is_a_setting()
    {
        using var h = new TestHarness(Now);
        var (user, plan, tx) = SeedCheckoutInFlight(h, openedAtUtc: Now.AddMinutes(-45));
        var gateway = new FakeGateway(Answer(Succeeded: false, Terminal: false));

        var checkout = await CheckoutHandler(h, user, gateway, new BillingSettings { CheckoutReuseMinutes = 60 })
            .Handle(new InitiateCheckoutCommand(plan.Id), CancellationToken.None);

        Assert.Equal(tx.Reference, checkout.Value.Reference);
        Assert.Equal(0, gateway.Verifications);
        Assert.Empty(gateway.InitiatedReferences);
    }

    // ---------------------------------------------------------------- where the browser comes back to

    [Fact]
    public async Task A_website_checkout_returns_to_the_web_return_page()
    {
        using var h = new TestHarness(Now);
        var (user, plan, _) = SeedCheckoutInFlight(h, openedAtUtc: Now.AddHours(-3));
        var gateway = new FakeGateway(Answer(Succeeded: false, Terminal: true));

        await CheckoutHandler(h, user, gateway).Handle(new InitiateCheckoutCommand(plan.Id, "web"), CancellationToken.None);

        Assert.Equal("https://api.notefusion.studio/api/billing/return/web", Assert.Single(gateway.CallbackUrls));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("app")]
    [InlineData("")]
    public async Task Any_other_checkout_returns_to_the_app_hand_off(string? client)
    {
        using var h = new TestHarness(Now);
        var (user, plan, _) = SeedCheckoutInFlight(h, openedAtUtc: Now.AddHours(-3));
        var gateway = new FakeGateway(Answer(Succeeded: false, Terminal: true));

        await CheckoutHandler(h, user, gateway).Handle(new InitiateCheckoutCommand(plan.Id, client), CancellationToken.None);

        Assert.Equal(BillingSettings.DefaultCheckoutCallbackUrl, Assert.Single(gateway.CallbackUrls));
    }

    [Theory]
    // A configured return page on another host still gets the /web variant…
    [InlineData("https://staging.example.com/api/billing/return", "https://staging.example.com/api/billing/return/web")]
    [InlineData("https://staging.example.com/api/billing/return/", "https://staging.example.com/api/billing/return/web")]
    // …but a URL that is not the API's return page was chosen deliberately and is left as it is.
    [InlineData("https://example.com/thanks", "https://example.com/thanks")]
    public async Task The_web_return_is_derived_from_the_configured_callback(string configured, string expected)
    {
        using var h = new TestHarness(Now);
        var (user, plan, _) = SeedCheckoutInFlight(h, openedAtUtc: Now.AddHours(-3));
        var gateway = new FakeGateway(Answer(Succeeded: false, Terminal: true));

        await CheckoutHandler(h, user, gateway, new BillingSettings { CheckoutCallbackUrl = configured })
            .Handle(new InitiateCheckoutCommand(plan.Id, "web"), CancellationToken.None);

        Assert.Equal(expected, Assert.Single(gateway.CallbackUrls));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void A_blank_configured_callback_keeps_the_default(string configured)
    {
        // Compose passes an unset variable through as an empty string; that must not become success_url "".
        Assert.Equal(
            BillingSettings.DefaultCheckoutCallbackUrl,
            new BillingSettings { CheckoutCallbackUrl = configured }.CheckoutCallbackUrl);
    }

    [Theory]
    [InlineData(null, "checkout:NF_pending", true)]
    [InlineData("web", "checkout:NF_pending:web", true)]
    // The return URL is part of the body the provider fingerprints the key against, so the other client's
    // URL under the same key is a conflict, not a replay — it would refuse every attempt from that client.
    [InlineData("web", "checkout:NF_pending", false)]
    [InlineData(null, "checkout:NF_pending:web", false)]
    public async Task A_pending_attempt_is_replayed_only_by_the_client_that_started_it(
        string? client, string pendingKey, bool replayed)
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Pat Payer", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-2));
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", 499, "USD", BillingInterval.Monthly);
        var pending = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, pendingKey, "NF_pending", 499, "USD", Now.AddMinutes(-5));
        h.Db.Users.Add(user);
        h.Db.Plans.Add(plan);
        h.Db.PaymentTransactions.Add(pending);
        h.Db.SaveChanges();
        var gateway = new FakeGateway(Answer(Succeeded: false, Terminal: false));

        var checkout = await CheckoutHandler(h, user, gateway)
            .Handle(new InitiateCheckoutCommand(plan.Id, client), CancellationToken.None);

        Assert.True(checkout.IsSuccess);
        Assert.Equal(replayed, checkout.Value.Reference == "NF_pending");
        if (!replayed)
        {
            Assert.Equal(PaymentStatus.Pending, pending.Status); // left for its own client, or the stale sweep
            var opened = h.Db.PaymentTransactions.Single(t => t.Reference == checkout.Value.Reference);
            Assert.Equal(client == "web", opened.IdempotencyKey.EndsWith(":web", StringComparison.Ordinal));
        }
    }

    [Fact]
    public void A_blank_callback_from_configuration_keeps_the_default()
    {
        // The path compose actually takes: an unset variable passed through arrives as an empty value.
        var settings = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Billing:CheckoutCallbackUrl"] = "" })
            .Build()
            .GetSection("Billing")
            .Get<BillingSettings>();

        Assert.Equal(BillingSettings.DefaultCheckoutCallbackUrl, settings?.CheckoutCallbackUrl);
    }

    // ---------------------------------------------------------------- fixtures

    private static (User User, Plan Plan, PaymentTransaction Transaction) SeedCheckoutInFlight(
        TestHarness h, DateTime? openedAtUtc = null)
    {
        var user = User.Create("Pat Payer", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-2));
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", 499, "USD", BillingInterval.Monthly);

        var opened = openedAtUtc ?? Now.AddHours(-3);
        var tx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, "checkout:NF_first", "NF_first", 499, "USD", opened);
        tx.AttachCheckout("chk_first", DeadUrl, "{}", opened);

        h.Db.Users.Add(user);
        h.Db.Plans.Add(plan);
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();

        return (user, plan, tx);
    }

    private static WebhookEvent Expiry(TestHarness h, PaymentTransaction tx)
    {
        var e = WebhookEvent.Receive(
            PaymentProvider.Bachs, "evt_expired", "checkout.expired", tx.Reference, "{}", Now);
        h.Db.WebhookEvents.Add(e);
        h.Db.SaveChanges();
        return e;
    }

    private static GatewayVerification Answer(bool Succeeded, bool Terminal) => new(
        Succeeded, AmountMinor: 499, Currency: "USD", ProviderReference: "chk_first",
        ProviderSubscriptionRef: null, Raw: "{}", Terminal);

    private static ProcessWebhookEventCommandHandler WebhookHandler(TestHarness h, GatewayVerification answer)
        => WebhookHandler(h, new FakeGateway(answer));

    private static ProcessWebhookEventCommandHandler WebhookHandler(TestHarness h, FakeGateway gateway)
        => new(h.Db, new FakeFactory(gateway), h.Clock, h.Email);

    private static InitiateCheckoutCommandHandler CheckoutHandler(
        TestHarness h, User user, FakeGateway gateway, BillingSettings? settings = null)
        => new(h.Db, new StubCurrentUser(user.Id), new FakeFactory(gateway), h.Clock, settings ?? new BillingSettings(), h.Email);

    /// <summary>Answers verification however the test asks, and counts the sessions it was made to open.</summary>
    private sealed class FakeGateway : IPaymentGateway
    {
        private readonly Result<GatewayVerification> _answer;

        public FakeGateway(Result<GatewayVerification> answer) => _answer = answer;

        public PaymentProvider Provider => PaymentProvider.Bachs;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["USD"];

        /// <summary>One entry per session actually opened — the count that says whether a retry happened.</summary>
        public List<string> InitiatedReferences { get; } = [];

        /// <summary>Where each opened session was told to send the browser back to.</summary>
        public List<string> CallbackUrls { get; } = [];

        public int Verifications { get; private set; }

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
        {
            InitiatedReferences.Add(request.Reference);
            CallbackUrls.Add(request.CallbackUrl);
            var n = InitiatedReferences.Count;
            return Task.FromResult(Result.Success(
                new GatewayInitiation($"https://pay.test/session-{n}", $"chk_{n}", "{}")));
        }

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
        {
            Verifications++;
            return Task.FromResult(_answer);
        }
    }

    private sealed class FakeFactory : IPaymentGatewayFactory
    {
        private readonly IPaymentGateway _gateway;

        public FakeFactory(IPaymentGateway gateway) => _gateway = gateway;

        public IPaymentGateway Resolve(PaymentProvider provider) => _gateway;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success(_gateway);
    }
}
