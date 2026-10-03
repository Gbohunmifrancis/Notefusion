using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Admin.Commands;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Billing;
using NoteFusion.Infrastructure.Billing.Workers;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The routes that rescue a payment our own side got wrong. A checkout can be closed (by a sweep, or on an
/// answer that later proved wrong) and still have been paid; the provider's word on settlement has to win
/// on every path that can hear it — webhook, reconciliation, the admin console — or a paying customer is
/// left with nothing and no way back. Alongside that: one bad webhook must never block the inbox, and a
/// failed one must be retried later rather than hammered.
/// </summary>
public class PaymentRecoveryTests
{
    private static readonly DateTime Now = new(2026, 9, 10, 12, 0, 0, DateTimeKind.Utc);
    private const long Price = 999;

    // ---------------------------------------------------------------- a Failed row the provider calls paid

    [Fact]
    public async Task A_webhook_for_a_failed_checkout_the_provider_confirms_is_fulfilled()
    {
        // This used to throw from MarkVerified (Failed is not Processing), and the throw escaped the worker.
        using var h = new TestHarness(Now);
        var (user, tx) = SeedFailed(h);
        var e = WebhookEvent.Receive(PaymentProvider.Bachs, "evt_paid", "collection.succeeded", tx.Reference, "{}", Now);
        h.Db.WebhookEvents.Add(e);
        h.Db.SaveChanges();

        var result = await new ProcessWebhookEventCommandHandler(h.Db, Gateway(Paid()), h.Clock, h.Email)
            .Handle(new ProcessWebhookEventCommand(e.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(PaymentStatus.Completed, tx.Status);
        Assert.Equal(WebhookStatus.Processed, e.Status);
        Assert.Equal(user.Id, Assert.Single(h.Db.Subscriptions).UserId);
        Assert.Single(h.Email.Receipts);
    }

    [Fact]
    public async Task Reconciling_a_failed_checkout_the_provider_confirms_fulfils_it()
    {
        using var h = new TestHarness(Now);
        var (_, tx) = SeedFailed(h);

        var result = await Reconcile(h, Gateway(Paid()), tx);

        Assert.True(result.IsSuccess);
        Assert.Equal(PaymentStatus.Completed, tx.Status);
        Assert.Single(h.Db.LedgerEntries);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Reconciling_a_failed_checkout_the_provider_still_calls_unpaid_leaves_it_failed(bool terminal)
    {
        using var h = new TestHarness(Now);
        var (_, tx) = SeedFailed(h);
        var reason = tx.FailureReason;

        var result = await Reconcile(h, Gateway(Unpaid(terminal)), tx);

        Assert.True(result.IsSuccess);
        Assert.Equal(PaymentStatus.Failed, tx.Status);
        Assert.Equal(reason, tx.FailureReason);
        Assert.Empty(h.Db.Subscriptions);
    }

    [Fact]
    public async Task An_operator_can_rescue_a_failed_payment_from_the_console()
    {
        using var h = new TestHarness(Now);
        var (_, tx) = SeedFailed(h);
        var admin = Admin(h);

        var result = await AdminReconcile(h, admin, tx.Id, Gateway(Paid()));

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Changed);
        Assert.Equal("Failed", result.Value.PreviousStatus);
        Assert.Equal("Completed", result.Value.Status);
        Assert.Contains("confirmed the payment", result.Value.Outcome);
    }

    [Fact]
    public async Task The_console_is_told_in_plain_words_when_the_provider_cannot_be_reached()
    {
        using var h = new TestHarness(Now);
        var (_, tx) = SeedFailed(h);
        var admin = Admin(h);

        var result = await AdminReconcile(
            h, admin, tx.Id, Gateway(Error.Network("Bachs.Verify", "Bachs returned 502 for chk_x.")));

        Assert.True(result.IsFailure);
        Assert.DoesNotContain("Bachs", result.Error.Message);
        Assert.DoesNotContain("502", result.Error.Message);

        // The provider's own text is kept where an operator investigating can find it.
        Assert.Contains("502", Assert.Single(h.Db.AdminAuditLogs).Summary);
    }

    // ---------------------------------------------------------------- what the sweep asks about

    [Fact]
    public async Task The_sweep_asks_about_stuck_rows_and_recently_failed_rows_it_can_still_ask_about()
    {
        using var h = new TestHarness(Now);
        var user = Payer(h);
        var stuck = Payment(h, user, "NF_stuck", Now.AddMinutes(-10));
        var fresh = Payment(h, user, "NF_fresh", Now.AddMinutes(-1));
        var recentlyFailed = Payment(h, user, "NF_failed", Now.AddHours(-2), failAt: Now.AddHours(-1));
        var longFailed = Payment(h, user, "NF_old", Now.AddDays(-4), failAt: Now.AddDays(-3));
        var unaskable = Payment(h, user, "NF_noref", Now.AddHours(-2), failAt: Now.AddHours(-1), providerReference: null);

        var withFailed = await PaymentReconciliationWorker.SelectDueAsync(
            h.Db, Now, new BillingSettings(), includeFailed: true, CancellationToken.None);
        var withoutFailed = await PaymentReconciliationWorker.SelectDueAsync(
            h.Db, Now, new BillingSettings(), includeFailed: false, CancellationToken.None);

        Assert.Equal(new[] { stuck.Id, recentlyFailed.Id }, withFailed);
        Assert.Equal(new[] { stuck.Id }, withoutFailed);
        Assert.DoesNotContain(fresh.Id, withFailed); // inside the grace window: the webhook may yet arrive
        Assert.DoesNotContain(longFailed.Id, withFailed);
        Assert.DoesNotContain(unaskable.Id, withFailed);
    }

    [Fact]
    public async Task A_backlog_of_old_unsettled_rows_does_not_crowd_out_a_fresh_one()
    {
        // Rows the provider cannot settle yet (abandoned carts, answers we cannot read) can outnumber a batch.
        // The one a customer has just paid for must still be asked about on this sweep, not after the backlog.
        using var h = new TestHarness(Now);
        var user = Payer(h);
        for (var i = 0; i < 60; i++)
            Payment(h, user, $"NF_backlog_{i}", Now.AddHours(-20).AddMinutes(i));
        var justPaid = Payment(h, user, "NF_just_paid", Now.AddMinutes(-5));

        var due = await PaymentReconciliationWorker.SelectDueAsync(
            h.Db, Now, new BillingSettings(), includeFailed: false, CancellationToken.None);

        Assert.Equal(justPaid.Id, due[0]);
    }

    // ---------------------------------------------------------------- the webhook inbox

    [Fact]
    public async Task One_event_that_throws_is_recorded_and_does_not_stop_the_others()
    {
        using var h = new TestHarness(Now);
        var bad = Inbox(h, "evt_bad", receivedSecondsAgo: 20);
        var good = Inbox(h, "evt_good", receivedSecondsAgo: 10);
        var sender = new ScriptedSender(h, throwFor: bad.Id);

        await Worker(h, sender).DrainAsync(CancellationToken.None);

        Assert.Equal(new[] { bad.Id, good.Id }, sender.Processed);
        var events = h.Db.WebhookEvents.AsNoTracking().ToDictionary(e => e.Id);
        Assert.Equal(WebhookStatus.Processed, events[good.Id].Status);

        // The throw is recorded like any other failure — and the change the handler had staged before
        // throwing did not ride along into the database.
        Assert.Equal(WebhookStatus.Received, events[bad.Id].Status);
        Assert.Equal(1, events[bad.Id].ProcessAttempts);
        Assert.Contains("boom", events[bad.Id].LastError);
    }

    [Fact]
    public async Task A_failed_event_is_not_retried_until_its_backoff_has_passed()
    {
        using var h = new TestHarness(Now);
        var e = Inbox(h, "evt_retry");
        e.RecordFailure("Timed out.", maxAttempts: 8, Now.AddSeconds(-2));
        h.Db.SaveChanges();
        var sender = new ScriptedSender(h);

        await Worker(h, sender).DrainAsync(CancellationToken.None);
        Assert.Empty(sender.Processed);

        h.Clock.UtcNow = Now.AddSeconds(5);
        await Worker(h, sender).DrainAsync(CancellationToken.None);
        Assert.Equal(new[] { e.Id }, sender.Processed);
    }

    // ---------------------------------------------------------------- settings and readiness

    [Fact]
    public void Defaults_favour_a_paying_customer_waiting_minutes_not_quarter_hours()
    {
        var settings = new BillingSettings();

        Assert.Equal(8, settings.MaxWebhookAttempts);
        Assert.Equal(3, settings.ReconciliationGraceMinutes);
        Assert.Equal(5, settings.ReconciliationMinutes);
        Assert.Equal(30, settings.CheckoutReuseMinutes);
        Assert.Equal("https://api.notefusion.studio/api/billing/return", settings.CheckoutCallbackUrl);
    }

    [Theory]
    [InlineData("https://api.notefusion.studio/api/billing/return", true)]
    [InlineData("https://staging.example.com/api/billing/return/", true)]
    [InlineData("http://api.notefusion.studio/api/billing/return", false)]
    [InlineData("notefusion://billing/return", false)]
    [InlineData("https://api.notefusion.studio/thanks", false)]
    [InlineData("not a url", false)]
    public void The_callback_is_checked_at_startup(string callbackUrl, bool ok)
        => Assert.Equal(ok, BillingReadiness.CheckCallbackUrl(callbackUrl) is null);

    // ---------------------------------------------------------------- fixtures

    private static User Payer(TestHarness h)
    {
        var user = User.Create("Pat Payer", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static User Admin(TestHarness h)
    {
        var admin = User.Create("Ada Admin", "ada@notefusion.studio", h.Hasher.Hash("password123"), Now.AddDays(-200));
        admin.PromoteToAdmin();
        h.Db.Users.Add(admin);
        h.Db.SaveChanges();
        return admin;
    }

    private static Plan PlanFor(TestHarness h)
    {
        var plan = h.Db.Plans.FirstOrDefault();
        if (plan is not null)
            return plan;

        plan = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro (Monthly)", Price, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.SaveChanges();
        return plan;
    }

    /// <summary>A checkout opened at <paramref name="openedAtUtc"/>, and failed at <paramref name="failAt"/> if given.</summary>
    private static PaymentTransaction Payment(
        TestHarness h, User user, string reference, DateTime openedAtUtc,
        DateTime? failAt = null, string? providerReference = "set")
    {
        var tx = PaymentTransaction.Create(
            user.Id, PlanFor(h).Id, PaymentProvider.Bachs, $"checkout:{reference}", reference, Price, "USD", openedAtUtc);
        tx.AttachCheckout(
            providerReference is null ? null : $"chk_{reference}", "https://pay.test/session", "{}", openedAtUtc);
        if (failAt is { } failedAt)
            tx.MarkFailed("Provider reports this checkout can no longer be paid.", failedAt);
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();
        return tx;
    }

    private static (User User, PaymentTransaction Transaction) SeedFailed(TestHarness h)
    {
        var user = Payer(h);
        return (user, Payment(h, user, "NF_rescue", Now.AddHours(-2), failAt: Now.AddHours(-1)));
    }

    private static WebhookEvent Inbox(TestHarness h, string eventId, int receivedSecondsAgo = 0)
    {
        var e = WebhookEvent.Receive(
            PaymentProvider.Bachs, eventId, "collection.succeeded", "NF_x", "{}", Now.AddSeconds(-receivedSecondsAgo));
        h.Db.WebhookEvents.Add(e);
        h.Db.SaveChanges();
        return e;
    }

    private static GatewayVerification Paid() => new(
        Succeeded: true, AmountMinor: Price, Currency: "USD", ProviderReference: "chk_NF_rescue",
        ProviderSubscriptionRef: null, Raw: "{}", Terminal: true);

    private static GatewayVerification Unpaid(bool terminal) => new(
        Succeeded: false, AmountMinor: 0, Currency: "USD", ProviderReference: "chk_NF_rescue",
        ProviderSubscriptionRef: null, Raw: "{}", Terminal: terminal);

    private static Task<Result> Reconcile(TestHarness h, IPaymentGatewayFactory gateways, PaymentTransaction tx)
        => new ReconcilePaymentCommandHandler(h.Db, gateways, h.Clock, h.Email)
            .Handle(new ReconcilePaymentCommand(tx.Id), CancellationToken.None);

    private static Task<Result<Application.Admin.Dtos.AdminReconcileResultDto>> AdminReconcile(
        TestHarness h, User admin, Guid paymentId, IPaymentGatewayFactory gateways)
        => new ReconcilePaymentAdminCommandHandler(
                h.Db,
                new HarnessSender(h, gateways),
                new StubCurrentUser(admin.Id, admin.Role, admin.Email, admin.FullName),
                h.AuditAs(admin))
            .Handle(new ReconcilePaymentAdminCommand(paymentId), CancellationToken.None);

    private static PaymentWebhookWorker Worker(TestHarness h, ISender sender)
    {
        var services = new ServiceCollection();
        services.AddSingleton(h.Db);
        services.AddSingleton(sender);
        services.AddSingleton<IDateTimeProvider>(h.Clock);
        var provider = services.BuildServiceProvider();

        return new PaymentWebhookWorker(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new BillingSettings(),
            NullLogger<PaymentWebhookWorker>.Instance);
    }

    private static OneAnswerFactory Gateway(Result<GatewayVerification> answer) => new(answer);

    private sealed class OneAnswerFactory(Result<GatewayVerification> answer) : IPaymentGatewayFactory, IPaymentGateway
    {
        public PaymentProvider Provider => PaymentProvider.Bachs;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["USD"];

        public IPaymentGateway Resolve(PaymentProvider provider) => this;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success<IPaymentGateway>(this);

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
            => throw new NotSupportedException("Recovery never opens a checkout.");

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
            => Task.FromResult(answer);
    }

    /// <summary>
    /// Stands in for the webhook handler: marks the event processed, except for the one it is told to fail —
    /// which it stages as processed and then throws on, the way a handler dies part-way through.
    /// </summary>
    private sealed class ScriptedSender(TestHarness h, Guid? throwFor = null) : ISender
    {
        public List<Guid> Processed { get; } = [];

        public async Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default)
        {
            var command = (ProcessWebhookEventCommand)(object)request;
            Processed.Add(command.WebhookEventId);

            var e = await h.Db.WebhookEvents.FirstAsync(x => x.Id == command.WebhookEventId, cancellationToken);
            e.MarkProcessed(h.Clock.UtcNow);
            if (command.WebhookEventId == throwFor)
                throw new InvalidOperationException("boom");

            await h.Db.SaveChangesAsync(cancellationToken);
            return (TResponse)(object)Result.Success();
        }

        public Task Send<TRequest>(TRequest request, CancellationToken cancellationToken = default)
            where TRequest : IRequest
            => throw new NotSupportedException();

        public Task<object?> Send(object request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(
            IStreamRequest<TResponse> request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public IAsyncEnumerable<object?> CreateStream(object request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();
    }
}
