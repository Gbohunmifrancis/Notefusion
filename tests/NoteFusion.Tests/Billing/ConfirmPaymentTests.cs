using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Persistence;
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
                h.Db, new StubCurrentUser(), new HarnessSender(h, gateway, new StubCurrentUser()), h.Clock)
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
        // the row stays Processing and both the webhook and the reconciliation sweep are still coming. Turning
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

    // ---------------------------------------------------------------- more than one checkout

    [Fact]
    public async Task An_older_checkout_that_was_paid_is_found_when_the_newest_is_still_open()
    {
        // Upgrade tapped twice (two devices, or back-and-retry): the customer paid the first session and the
        // newest is the one left open. Asking about the newest alone told them they were not Pro.
        using var h = new TestHarness(Now);
        var (user, plan, older) = Seed(h);
        Open(h, older);
        var newer = InFlight(h, user, plan, "NF_newer", Now.AddMinutes(-1));
        var gateway = new ScriptedGatewayFactory()
            .Answer("chk_NF_newer", Unpaid(terminal: false))
            .Answer("chk_conf", PaidVerification("chk_conf"));

        var result = await Confirm(h, user, gateway);

        Assert.True(result.Value.IsActive);
        Assert.Equal(PaymentStatus.Completed, older.Status);
        Assert.Equal(PaymentStatus.Processing, newer.Status);
        Assert.Equal(new[] { "chk_NF_newer", "chk_conf" }, gateway.Asked);
    }

    [Fact]
    public async Task Confirm_stops_asking_once_one_checkout_completes()
    {
        using var h = new TestHarness(Now);
        var (user, plan, older) = Seed(h);
        Open(h, older);
        InFlight(h, user, plan, "NF_newer", Now.AddMinutes(-1));
        var gateway = new ScriptedGatewayFactory()
            .Answer("chk_NF_newer", PaidVerification("chk_NF_newer"))
            .Answer("chk_conf", PaidVerification("chk_conf"));

        await Confirm(h, user, gateway);

        // One payment found is the one the customer is waiting on; the other is left for its own webhook.
        Assert.Equal(new[] { "chk_NF_newer" }, gateway.Asked);
        Assert.Equal(PaymentStatus.Processing, older.Status);
        Assert.Single(h.Db.LedgerEntries);
    }

    [Fact]
    public async Task Only_the_three_newest_in_flight_checkouts_from_the_last_two_days_are_asked_about()
    {
        using var h = new TestHarness(Now);
        var (user, plan, tx) = Seed(h);
        Open(h, tx); // two minutes old
        InFlight(h, user, plan, "NF_b", Now.AddMinutes(-10));
        InFlight(h, user, plan, "NF_c", Now.AddMinutes(-20));
        InFlight(h, user, plan, "NF_d", Now.AddMinutes(-30));
        InFlight(h, user, plan, "NF_stale", Now.AddHours(-49));
        var gateway = new ScriptedGatewayFactory();

        await Confirm(h, user, gateway);

        Assert.Equal(new[] { "chk_conf", "chk_NF_b", "chk_NF_c" }, gateway.Asked);
    }

    [Fact]
    public async Task A_checkout_failed_in_the_last_two_hours_is_rescued_when_the_provider_says_it_was_paid()
    {
        // Closed by a sweep while the customer was still paying — the very checkout they are waiting on.
        using var h = new TestHarness(Now);
        var (user, _, tx) = Seed(h);
        Open(h, tx);
        tx.MarkFailed("Provider reports this checkout can no longer be paid.", Now.AddMinutes(-30));
        h.Db.SaveChanges();
        var gateway = new ScriptedGatewayFactory().Answer("chk_conf", PaidVerification("chk_conf"));

        var result = await Confirm(h, user, gateway);

        Assert.True(result.Value.IsActive);
        Assert.Equal(PaymentStatus.Completed, tx.Status);
        Assert.Single(h.Email.Receipts);

        // The earlier verdict is kept for the audit trail rather than overwritten.
        Assert.Contains("can no longer be paid", tx.FailureReason);
    }

    [Fact]
    public async Task A_failed_checkout_the_provider_still_calls_unpaid_stays_failed()
    {
        using var h = new TestHarness(Now);
        var (user, _, tx) = Seed(h);
        Open(h, tx);
        tx.MarkFailed("Provider reports this checkout can no longer be paid.", Now.AddMinutes(-30));
        h.Db.SaveChanges();
        var gateway = new ScriptedGatewayFactory().Answer("chk_conf", Unpaid(terminal: true));

        var result = await Confirm(h, user, gateway);

        Assert.False(result.Value.IsActive);
        Assert.Equal(PaymentStatus.Failed, tx.Status);
    }

    [Fact]
    public async Task A_checkout_failed_long_ago_is_not_asked_about()
    {
        using var h = new TestHarness(Now);
        var (user, _, tx) = Seed(h);
        Open(h, tx);
        tx.MarkFailed("Provider reports this checkout can no longer be paid.", Now.AddHours(-3));
        h.Db.SaveChanges();
        var gateway = new ScriptedGatewayFactory().Answer("chk_conf", PaidVerification("chk_conf"));

        await Confirm(h, user, gateway);

        Assert.Empty(gateway.Asked);
        Assert.Equal(PaymentStatus.Failed, tx.Status);
    }

    [Fact]
    public async Task Losing_the_race_to_the_webhook_reports_pro_instead_of_failing()
    {
        // The client polls confirm the moment the payment lands — the same moment the webhook worker fulfils
        // it. Whichever saves second is refused by the ledger's unique index; for confirm, that must read as
        // "Pro is active", not as a server error on a payment that just succeeded.
        using var h = new TestHarness(Now);
        var (user, _, tx) = Seed(h);
        Open(h, tx);
        var gateway = new WebhookWinsTheRaceFactory(h, tx.Id, PaidVerification("chk_conf"));

        var result = await Confirm(h, user, gateway);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.IsActive);
        Assert.Equal(1, h.Db.LedgerEntries.AsNoTracking().Count()); // fulfilled once, by the winner
    }

    // ---------------------------------------------------------------- fixtures

    private static Task<Result<Application.Billing.Dtos.SubscriptionDto>> Confirm(
        TestHarness h, User caller, IPaymentGatewayFactory gateways)
    {
        var identity = new StubCurrentUser(caller.Id);
        return new ConfirmPaymentCommandHandler(h.Db, identity, new HarnessSender(h, gateways, identity), h.Clock)
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
        => new(Result.Success(PaidVerification("chk_conf", amountMinor)));

    private static GatewayVerification PaidVerification(string checkoutId, long amountMinor = MonthlyPrice)
        => new(
            Succeeded: true, AmountMinor: amountMinor, Currency: "USD", ProviderReference: checkoutId,
            ProviderSubscriptionRef: null, Raw: "{}", Terminal: true);

    private static GatewayVerification Unpaid(bool terminal)
        => new(
            Succeeded: false, AmountMinor: 0, Currency: "USD", ProviderReference: "chk",
            ProviderSubscriptionRef: null, Raw: "{}", Terminal: terminal);

    /// <summary>A further checkout for the same customer, opened at <paramref name="openedAtUtc"/>.</summary>
    private static PaymentTransaction InFlight(
        TestHarness h, User user, Plan plan, string reference, DateTime openedAtUtc)
    {
        var tx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Paystack, $"checkout:{reference}", reference,
            MonthlyPrice, "USD", openedAtUtc);
        tx.AttachCheckout($"chk_{reference}", "https://pay.test/session", "{}", openedAtUtc);
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();
        return tx;
    }

    /// <summary>
    /// Answers per checkout id and records the order it was asked in — the order is the assertion for
    /// "newest first, stop at the first one paid". An id it was not told about is still open.
    /// </summary>
    private sealed class ScriptedGatewayFactory : IPaymentGatewayFactory, IPaymentGateway
    {
        private readonly Dictionary<string, GatewayVerification> _answers = [];

        public List<string> Asked { get; } = [];

        public ScriptedGatewayFactory Answer(string checkoutId, GatewayVerification answer)
        {
            _answers[checkoutId] = answer;
            return this;
        }

        public PaymentProvider Provider => PaymentProvider.Paystack;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["USD"];

        public IPaymentGateway Resolve(PaymentProvider provider) => this;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success<IPaymentGateway>(this);

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
            => throw new NotSupportedException("Confirm never opens a checkout; it only verifies one.");

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
        {
            Asked.Add(request.ProviderReference!);
            return Task.FromResult(Result.Success(
                _answers.TryGetValue(request.ProviderReference!, out var answer) ? answer : Unpaid(terminal: false)));
        }
    }

    /// <summary>
    /// Answers "paid", but first lets the webhook path fulfil the same payment and commit through a context
    /// of its own — what happens when the worker gets there between confirm reading the row and saving it.
    /// </summary>
    private sealed class WebhookWinsTheRaceFactory(TestHarness h, Guid transactionId, GatewayVerification answer)
        : IPaymentGatewayFactory, IPaymentGateway
    {
        public PaymentProvider Provider => PaymentProvider.Paystack;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["USD"];

        public IPaymentGateway Resolve(PaymentProvider provider) => this;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success<IPaymentGateway>(this);

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
            => throw new NotSupportedException("Confirm never opens a checkout; it only verifies one.");

        public async Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
        {
            await using var worker = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseSqlite(h.Db.Database.GetDbConnection())
                .Options);
            await new ReconcilePaymentCommandHandler(
                    worker, new CountingGatewayFactory(Result.Success(answer)), h.Clock, h.Email)
                .Handle(new ReconcilePaymentCommand(transactionId), ct);

            return answer;
        }
    }

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
