using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The "ask, don't wait" confirm path. It exists for a user-visible reason: the provider's webhook took
/// minutes to arrive, so someone who had genuinely paid watched a spinner and then read "Payment
/// processing" — a failure message on a successful payment. Confirm turns that into a round trip by asking
/// the provider directly.
/// <para>
/// Because it is the one payment route a client can trigger at will, the hazards worth pinning are not
/// about the happy path: fulfilling twice, fulfilling for the wrong account, and turning an unreachable
/// provider into a lost subscription.
/// </para>
/// </summary>
public class ConfirmPaymentTests
{
    private static readonly DateTime Now = new(2026, 8, 21, 12, 0, 0, DateTimeKind.Utc);
    private const long MonthlyPrice = 499; // $4.99

    // ---------------------------------------------------------------- nothing to confirm

    [Fact]
    public async Task Nothing_pending_reports_the_current_state_without_asking_the_provider()
    {
        // The common case, and deliberately not an error: the app calls confirm on every return from
        // checkout, and a webhook that beat it here has already completed the row.
        using var h = new TestHarness(Now);
        var (user, _, _) = Seed(h);
        var gateway = Paid();

        var result = await Confirm(h, user, gateway);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.IsActive);
        Assert.Equal(0, gateway.Verifications);
    }

    [Fact]
    public async Task An_unauthenticated_caller_is_refused()
    {
        using var h = new TestHarness(Now);
        var gateway = Paid();

        var result = await new ConfirmPaymentCommandHandler(
                h.Db, new StubCurrentUser(), new HarnessSender(h, gateway, new StubCurrentUser()))
            .Handle(new ConfirmPaymentCommand(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Unauthorized, result.Error.Type);
    }

    // ---------------------------------------------------------------- the point of the endpoint

    [Fact]
    public async Task A_paid_checkout_turns_into_Pro_in_one_round_trip()
    {
        using var h = new TestHarness(Now);
        var (user, plan, tx) = Seed(h);
        Open(h, tx);
        var gateway = Paid();

        var result = await Confirm(h, user, gateway);

        // One call both confirms and reports, so the client needs no follow-up read.
        Assert.True(result.IsSuccess);
        Assert.True(result.Value.IsActive);

        var sub = Assert.Single(h.Db.Subscriptions);
        Assert.Equal(user.Id, sub.UserId);
        Assert.Equal(plan.Id, sub.PlanId);
        Assert.Equal(PaymentStatus.Completed, tx.Status);

        // Fulfilment happened through the shared path, so the receipt the webhook owes is still owed here.
        Assert.Single(h.Email.Receipts);
    }

    [Fact]
    public async Task Confirming_twice_fulfils_once()
    {
        // The app calls confirm on every return from the browser, and returns can repeat — a retry, a
        // relaunch, a second tap. Charging or subscribing twice for one payment is the worst outcome
        // available here.
        using var h = new TestHarness(Now);
        var (user, _, tx) = Seed(h);
        Open(h, tx);
        var gateway = Paid();

        await Confirm(h, user, gateway);
        var second = await Confirm(h, user, gateway);

        Assert.True(second.Value.IsActive);
        Assert.Single(h.Db.Subscriptions);
        Assert.Single(h.Db.LedgerEntries);
        Assert.Single(h.Email.Receipts);

        // And the second call never even reached the provider: the row is no longer Processing, so there
        // is nothing to ask about.
        Assert.Equal(1, gateway.Verifications);
    }

    // ---------------------------------------------------------------- whose payment it is

    [Fact]
    public async Task Another_users_pending_checkout_is_never_confirmed()
    {
        // The transaction is chosen from the authenticated identity precisely so this cannot happen.
        // Were it a parameter, any caller could trigger fulfilment — and a receipt email — against
        // someone else's in-flight checkout.
        using var h = new TestHarness(Now);
        var (payer, _, theirs) = Seed(h);
        Open(h, theirs);

        var bystander = User.Create("Sam Bystander", "sam@example.com", h.Hasher.Hash("password123"), Now.AddDays(-1));
        h.Db.Users.Add(bystander);
        await h.Db.SaveChangesAsync(CancellationToken.None);

        var gateway = Paid();
        var result = await Confirm(h, bystander, gateway);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.IsActive);
        Assert.Equal(0, gateway.Verifications);
        Assert.Equal(PaymentStatus.Processing, theirs.Status);
        Assert.Empty(h.Db.Subscriptions);
        Assert.Empty(h.Email.Receipts);

        // The real payer is untouched and still gets their subscription when their own confirm lands.
        Assert.True((await Confirm(h, payer, gateway)).Value.IsActive);
    }

    // ---------------------------------------------------------------- when the provider is the problem

    [Fact]
    public async Task A_provider_we_cannot_reach_still_reports_what_we_know()
    {
        // Confirm is an optimisation over waiting for the webhook, so a failed verify must cost nothing:
        // the row stays Processing and both the webhook and the 15-minute sweep are still coming. Turning
        // that into an error would replace "not yet" with "something went wrong" on a payment that may
        // well have succeeded.
        using var h = new TestHarness(Now);
        var (user, _, tx) = Seed(h);
        Open(h, tx);
        var gateway = new CountingGatewayFactory(
            Result.Failure<GatewayVerification>(Error.Network("BILLING_GATEWAY_UNREACHABLE", "Timed out.")));

        var result = await Confirm(h, user, gateway);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.IsActive);
        Assert.Equal(PaymentStatus.Processing, tx.Status);
        Assert.Empty(h.Db.Subscriptions);
    }

    [Fact]
    public async Task A_checkout_the_provider_says_is_dead_is_closed_rather_than_left_pending()
    {
        // Delegated behaviour, asserted here because it is what makes the *next* upgrade attempt work:
        // a row left in Processing is handed back by the idempotent checkout path, so the user would be
        // shown the dead session again instead of a fresh one.
        using var h = new TestHarness(Now);
        var (user, _, tx) = Seed(h);
        Open(h, tx);
        var gateway = new CountingGatewayFactory(Result.Success(new GatewayVerification(
            Succeeded: false, AmountMinor: 0, Currency: "USD", ProviderReference: "chk_conf",
            ProviderSubscriptionRef: null, Raw: "{}", Terminal: true)));

        var result = await Confirm(h, user, gateway);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.IsActive);
        Assert.Equal(PaymentStatus.Failed, tx.Status);
        Assert.Empty(h.Email.Receipts);
    }

    [Fact]
    public async Task A_provider_reporting_the_wrong_amount_does_not_grant_Pro()
    {
        using var h = new TestHarness(Now);
        var (user, _, tx) = Seed(h);
        Open(h, tx);
        var gateway = Paid(amountMinor: 1); // a cent, for a $4.99 plan

        var result = await Confirm(h, user, gateway);

        // The mismatch is swallowed into "no change yet" rather than surfaced, which is the deliberate
        // trade recorded in the handler: the client learns the truthful subscription state either way.
        Assert.True(result.IsSuccess);
        Assert.False(result.Value.IsActive);
        Assert.Equal(PaymentStatus.Processing, tx.Status);
        Assert.Empty(h.Db.Subscriptions);
    }

    // ---------------------------------------------------------------- fixtures

    private static Task<Result<Application.Billing.Dtos.SubscriptionDto>> Confirm(
        TestHarness h, User caller, IPaymentGatewayFactory gateways)
    {
        var identity = new StubCurrentUser(caller.Id);
        return new ConfirmPaymentCommandHandler(h.Db, identity, new HarnessSender(h, gateways, identity))
            .Handle(new ConfirmPaymentCommand(), CancellationToken.None);
    }

    private static (User User, Plan Plan, PaymentTransaction Transaction) Seed(TestHarness h)
    {
        var user = User.Create("Pat Payer", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-2));
        var plan = Plan.Create(
            Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", MonthlyPrice, "USD", BillingInterval.Monthly);

        var tx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Paystack, "checkout:NF_conf", "NF_conf",
            MonthlyPrice, "USD", Now.AddMinutes(-2));

        h.Db.Users.Add(user);
        h.Db.Plans.Add(plan);
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();

        return (user, plan, tx);
    }

    /// <summary>Puts the transaction where a returning browser leaves it: Processing, checkout attached.</summary>
    private static void Open(TestHarness h, PaymentTransaction tx)
    {
        tx.AttachCheckout("chk_conf", "https://pay.test/session", "{}", Now.AddMinutes(-2));
        h.Db.SaveChanges();
    }

    private static CountingGatewayFactory Paid(long amountMinor = MonthlyPrice)
        => new(Result.Success(new GatewayVerification(
            Succeeded: true, AmountMinor: amountMinor, Currency: "USD", ProviderReference: "chk_conf",
            ProviderSubscriptionRef: null, Raw: "{}", Terminal: true)));

    /// <summary>
    /// A gateway with one fixed answer that counts how often it was asked. The count is the assertion that
    /// matters for idempotence: "fulfilled once" can hold by luck, but "asked once" shows the second
    /// confirm found nothing in flight and stopped.
    /// </summary>
    private sealed class CountingGatewayFactory : IPaymentGatewayFactory, IPaymentGateway
    {
        private readonly Result<GatewayVerification> _answer;

        public CountingGatewayFactory(Result<GatewayVerification> answer) => _answer = answer;

        public int Verifications { get; private set; }

        public PaymentProvider Provider => PaymentProvider.Paystack;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["USD"];

        public IPaymentGateway Resolve(PaymentProvider provider) => this;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success<IPaymentGateway>(this);

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
            => throw new NotSupportedException("Confirm never opens a checkout; it only verifies one.");

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
        {
            Verifications++;
            return Task.FromResult(_answer);
        }
    }
}
