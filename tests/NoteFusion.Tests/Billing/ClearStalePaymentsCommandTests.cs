using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

public class ClearStalePaymentsCommandTests
{
    private static readonly DateTime Now = new(2026, 8, 25, 12, 0, 0, DateTimeKind.Utc);
    private const long MonthlyPrice = 499; // $4.99

    private static readonly BillingSettings DefaultSettings = new()
    {
        StalePaymentSweepMinutes = 60,
        StalePendingHours = 2,
        StaleProcessingHours = 24,
    };

    [Fact]
    public async Task Stale_pending_payments_older_than_cutoff_are_marked_failed()
    {
        using var h = new TestHarness(Now);
        var (user, plan) = Seed(h);

        // Created 3 hours ago (stale because StalePendingHours is 2)
        var staleTx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Paystack, "checkout:NF_stale_pend", "NF_stale_pend",
            MonthlyPrice, "USD", Now.AddHours(-3));
        h.Db.PaymentTransactions.Add(staleTx);
        h.Db.SaveChanges();

        var gateway = StubGateway(Result.Success(TerminalFailureVerification()));
        var handler = Handler(h, gateway);

        var result = await handler.Handle(new ClearStalePaymentsCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.ClearedPendingCount);
        Assert.Equal(0, result.Value.ClearedProcessingCount);
        Assert.Equal(0, result.Value.FulfilledCount);

        Assert.Equal(PaymentStatus.Failed, staleTx.Status);
        Assert.Contains("Initiation expired", staleTx.FailureReason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Recent_pending_payments_are_not_cleared()
    {
        using var h = new TestHarness(Now);
        var (user, plan) = Seed(h);

        // Created 30 minutes ago (well within 2 hour threshold)
        var recentTx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Paystack, "checkout:NF_recent_pend", "NF_recent_pend",
            MonthlyPrice, "USD", Now.AddMinutes(-30));
        h.Db.PaymentTransactions.Add(recentTx);
        h.Db.SaveChanges();

        var gateway = StubGateway(Result.Success(TerminalFailureVerification()));
        var handler = Handler(h, gateway);

        var result = await handler.Handle(new ClearStalePaymentsCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value.ClearedPendingCount);
        Assert.Equal(PaymentStatus.Pending, recentTx.Status);
    }

    [Fact]
    public async Task Stale_processing_payments_are_marked_failed_when_provider_confirms_expired()
    {
        using var h = new TestHarness(Now);
        var (user, plan) = Seed(h);

        var staleTx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, "checkout:NF_stale_proc", "NF_stale_proc",
            MonthlyPrice, "USD", Now.AddHours(-26));
        staleTx.AttachCheckout("chk_stale_1", "https://checkout.bachs.io/c/chk_1", "{}", Now.AddHours(-26));
        h.Db.PaymentTransactions.Add(staleTx);
        h.Db.SaveChanges();

        var gateway = StubGateway(Result.Success(TerminalFailureVerification("chk_stale_1")));
        var handler = Handler(h, gateway);

        var result = await handler.Handle(new ClearStalePaymentsCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.ClearedProcessingCount);
        Assert.Equal(0, result.Value.FulfilledCount);

        Assert.Equal(PaymentStatus.Failed, staleTx.Status);
        Assert.Contains("can no longer be paid", staleTx.FailureReason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Stale_processing_payments_stay_processing_when_provider_is_unreachable()
    {
        // Age is not evidence that nobody paid, and an outage has told us nothing. Failing the row here used
        // to close checkouts that had been paid while the provider was down; left Processing, it is picked
        // up by the next sweep and counted by the admin payment alert as stuck.
        using var h = new TestHarness(Now);
        var (user, plan) = Seed(h);

        var staleTx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, "checkout:NF_stale_dead", "NF_stale_dead",
            MonthlyPrice, "USD", Now.AddHours(-30));
        staleTx.AttachCheckout("chk_stale_dead", "https://checkout.bachs.io/c/dead", "{}", Now.AddHours(-30));
        h.Db.PaymentTransactions.Add(staleTx);
        h.Db.SaveChanges();

        var gateway = StubGateway(Error.Network("Bachs.Verify", "Bachs returned 404."));
        var handler = Handler(h, gateway);

        var result = await handler.Handle(new ClearStalePaymentsCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value.ClearedProcessingCount);
        Assert.Equal(PaymentStatus.Processing, staleTx.Status);
        Assert.Null(staleTx.FailureReason);
        Assert.Equal(1, gateway.Verifications); // asked once, not once per batch pass
    }

    [Fact]
    public async Task Stale_processing_payments_the_provider_reports_unpaid_are_closed_past_the_checkout_lifetime()
    {
        // Paystack answers `abandoned` for an unpaid checkout and never moves it to a final state. Left
        // Processing on that answer, every abandoned cart would stay in flight for good, crowding the
        // reconciliation sweep and the admin alert. A payment that does land later reopens the row.
        using var h = new TestHarness(Now);
        var (user, plan) = Seed(h);

        var staleTx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Paystack, "checkout:NF_stale_open", "NF_stale_open",
            MonthlyPrice, "USD", Now.AddHours(-30));
        staleTx.AttachCheckout("acc_stale_open", "https://checkout.paystack.com/open", "{}", Now.AddHours(-30));
        h.Db.PaymentTransactions.Add(staleTx);
        h.Db.SaveChanges();

        var gateway = StubGateway(Result.Success(new GatewayVerification(
            Succeeded: false, AmountMinor: 0, Currency: "USD", ProviderReference: "acc_stale_open",
            ProviderSubscriptionRef: null, Raw: "{}", Terminal: false)));

        var result = await Handler(h, gateway).Handle(new ClearStalePaymentsCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.ClearedProcessingCount);
        Assert.Equal(PaymentStatus.Failed, staleTx.Status);
        Assert.Contains("exceeded maximum validity window", staleTx.FailureReason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task One_unreachable_payment_does_not_stop_the_rest_being_settled()
    {
        using var h = new TestHarness(Now);
        var (user, plan) = Seed(h);

        var unreachable = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, "checkout:NF_a", "NF_a", MonthlyPrice, "USD", Now.AddHours(-40));
        unreachable.AttachCheckout("chk_a", "https://checkout.bachs.io/c/a", "{}", Now.AddHours(-40));
        var expired = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, "checkout:NF_b", "NF_b", MonthlyPrice, "USD", Now.AddHours(-30));
        expired.AttachCheckout("chk_b", "https://checkout.bachs.io/c/b", "{}", Now.AddHours(-30));
        h.Db.PaymentTransactions.AddRange(unreachable, expired);
        h.Db.SaveChanges();

        var gateway = new SingleAnswerGatewayFactory(request => request.ProviderReference == "chk_a"
            ? Error.Network("Bachs.Verify", "Timed out.")
            : Result.Success(TerminalFailureVerification("chk_b")));

        var result = await Handler(h, gateway).Handle(new ClearStalePaymentsCommand(), CancellationToken.None);

        Assert.Equal(1, result.Value.ClearedProcessingCount);
        Assert.Equal(PaymentStatus.Processing, unreachable.Status);
        Assert.Equal(PaymentStatus.Failed, expired.Status);
    }

    [Fact]
    public async Task A_stale_payment_settled_for_more_than_the_price_is_still_fulfilled()
    {
        // The same rule as reconciliation: paying more than the price is still paying it. An exact-match
        // rule here would leave an overpaid customer with nothing.
        using var h = new TestHarness(Now);
        var (user, plan) = Seed(h);

        var staleTx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, "checkout:NF_over", "NF_over", MonthlyPrice, "USD", Now.AddHours(-25));
        staleTx.AttachCheckout("chk_over", "https://checkout.bachs.io/c/over", "{}", Now.AddHours(-25));
        h.Db.PaymentTransactions.Add(staleTx);
        h.Db.SaveChanges();

        var gateway = StubGateway(Result.Success(new GatewayVerification(
            Succeeded: true, AmountMinor: MonthlyPrice + 100, Currency: "USD", ProviderReference: "chk_over",
            ProviderSubscriptionRef: null, Raw: "{}", Terminal: true)));

        var result = await Handler(h, gateway).Handle(new ClearStalePaymentsCommand(), CancellationToken.None);

        Assert.Equal(1, result.Value.FulfilledCount);
        Assert.Equal(PaymentStatus.Completed, staleTx.Status);
        Assert.Single(h.Email.Receipts);
    }

    [Fact]
    public async Task A_stale_payment_settled_for_less_than_the_price_is_neither_fulfilled_nor_failed()
    {
        using var h = new TestHarness(Now);
        var (user, plan) = Seed(h);

        var staleTx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, "checkout:NF_under", "NF_under", MonthlyPrice, "USD", Now.AddHours(-25));
        staleTx.AttachCheckout("chk_under", "https://checkout.bachs.io/c/under", "{}", Now.AddHours(-25));
        h.Db.PaymentTransactions.Add(staleTx);
        h.Db.SaveChanges();

        var gateway = StubGateway(Result.Success(new GatewayVerification(
            Succeeded: true, AmountMinor: 1, Currency: "USD", ProviderReference: "chk_under",
            ProviderSubscriptionRef: null, Raw: "{}", Terminal: true)));

        var result = await Handler(h, gateway).Handle(new ClearStalePaymentsCommand(), CancellationToken.None);

        Assert.Equal(0, result.Value.FulfilledCount);
        Assert.Equal(0, result.Value.ClearedProcessingCount);
        Assert.Equal(PaymentStatus.Processing, staleTx.Status);
        Assert.Empty(h.Email.Receipts);
    }

    [Fact]
    public async Task Stale_processing_payments_are_fulfilled_if_provider_confirms_funds_settled()
    {
        using var h = new TestHarness(Now);
        var (user, plan) = Seed(h);

        var staleTx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, "checkout:NF_stale_paid", "NF_stale_paid",
            MonthlyPrice, "USD", Now.AddHours(-25));
        staleTx.AttachCheckout("chk_paid", "https://checkout.bachs.io/c/paid", "{}", Now.AddHours(-25));
        h.Db.PaymentTransactions.Add(staleTx);
        h.Db.SaveChanges();

        var successVerification = new GatewayVerification(
            Succeeded: true, AmountMinor: MonthlyPrice, Currency: "USD", ProviderReference: "chk_paid",
            ProviderSubscriptionRef: "sub_paid", Raw: "{}", Terminal: true);

        var gateway = StubGateway(Result.Success(successVerification));
        var handler = Handler(h, gateway);

        var result = await handler.Handle(new ClearStalePaymentsCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value.ClearedProcessingCount);
        Assert.Equal(1, result.Value.FulfilledCount);

        Assert.Equal(PaymentStatus.Completed, staleTx.Status);
        Assert.Single(h.Db.Subscriptions);
        Assert.Single(h.Email.Receipts);
    }

    [Fact]
    public async Task Completed_and_Verified_payments_are_never_touched()
    {
        using var h = new TestHarness(Now);
        var (user, plan) = Seed(h);

        var verifiedTx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, "checkout:NF_verified", "NF_verified",
            MonthlyPrice, "USD", Now.AddDays(-5));
        verifiedTx.AttachCheckout("chk_ver", "https://checkout.bachs.io/c/ver", "{}", Now.AddDays(-5));
        verifiedTx.MarkVerified("chk_ver", "{}", Now.AddDays(-5));

        var completedTx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, "checkout:NF_completed", "NF_completed",
            MonthlyPrice, "USD", Now.AddDays(-5));
        completedTx.AttachCheckout("chk_comp", "https://checkout.bachs.io/c/comp", "{}", Now.AddDays(-5));
        completedTx.MarkVerified("chk_comp", "{}", Now.AddDays(-5));
        completedTx.MarkCompleted(Now.AddDays(-5));

        h.Db.PaymentTransactions.AddRange(verifiedTx, completedTx);
        h.Db.SaveChanges();

        var gateway = StubGateway(Error.Network("Bachs.Verify", "Not reachable"));
        var handler = Handler(h, gateway);

        var result = await handler.Handle(new ClearStalePaymentsCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value.ClearedPendingCount);
        Assert.Equal(0, result.Value.ClearedProcessingCount);
        Assert.Equal(0, result.Value.FulfilledCount);

        Assert.Equal(PaymentStatus.Verified, verifiedTx.Status);
        Assert.Equal(PaymentStatus.Completed, completedTx.Status);
    }

    [Fact]
    public async Task Recent_processing_payments_inside_grace_window_are_not_touched()
    {
        using var h = new TestHarness(Now);
        var (user, plan) = Seed(h);

        // Created 1 hour ago, well within 24h
        var recentTx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, "checkout:NF_recent_proc", "NF_recent_proc",
            MonthlyPrice, "USD", Now.AddHours(-1));
        recentTx.AttachCheckout("chk_recent", "https://checkout.bachs.io/c/recent", "{}", Now.AddHours(-1));
        h.Db.PaymentTransactions.Add(recentTx);
        h.Db.SaveChanges();

        var gateway = StubGateway(Error.Network("Bachs.Verify", "Not checked"));
        var handler = Handler(h, gateway);

        var result = await handler.Handle(new ClearStalePaymentsCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value.ClearedProcessingCount);
        Assert.Equal(PaymentStatus.Processing, recentTx.Status);
    }

    // ---------------------------------------------------------------- helpers

    private static ClearStalePaymentsCommandHandler Handler(
        TestHarness h, IPaymentGatewayFactory gateways, BillingSettings? settings = null)
        => new(
            h.Db,
            gateways,
            new FixedClock(Now),
            settings ?? DefaultSettings,
            h.Email,
            NullLogger<ClearStalePaymentsCommandHandler>.Instance);

    private static (User User, Plan Plan) Seed(TestHarness h)
    {
        var user = User.Create("Alex Tester", "alex@example.com", h.Hasher.Hash("secret"), Now.AddDays(-10));
        var plan = Plan.Create(
            Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", MonthlyPrice, "USD", BillingInterval.Monthly);

        h.Db.Users.Add(user);
        h.Db.Plans.Add(plan);
        h.Db.SaveChanges();

        return (user, plan);
    }

    private static GatewayVerification TerminalFailureVerification(string providerRef = "chk_ref")
        => new(
            Succeeded: false, AmountMinor: 0, Currency: "USD", ProviderReference: providerRef,
            ProviderSubscriptionRef: null, Raw: "{}", Terminal: true);

    private static SingleAnswerGatewayFactory StubGateway(Result<GatewayVerification> answer)
        => new(answer);

    private sealed class SingleAnswerGatewayFactory : IPaymentGatewayFactory, IPaymentGateway
    {
        private readonly Func<GatewayVerificationRequest, Result<GatewayVerification>> _answer;

        public SingleAnswerGatewayFactory(Result<GatewayVerification> answer) => _answer = _ => answer;

        public SingleAnswerGatewayFactory(Func<GatewayVerificationRequest, Result<GatewayVerification>> answer)
            => _answer = answer;

        public int Verifications { get; private set; }

        public PaymentProvider Provider => PaymentProvider.Bachs;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["USD"];

        public IPaymentGateway Resolve(PaymentProvider provider) => this;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success<IPaymentGateway>(this);

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
            => throw new NotSupportedException();

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
        {
            Verifications++;
            return Task.FromResult(_answer(request));
        }
    }
}
