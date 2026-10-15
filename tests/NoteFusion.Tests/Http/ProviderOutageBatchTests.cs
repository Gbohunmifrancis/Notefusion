using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Outreach;
using NoteFusion.Application.Preview.Commands;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Billing.Workers;
using NoteFusion.Infrastructure.Outreach;
using NoteFusion.Infrastructure.Transcriptions.Workers;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Http;

/// <summary>
/// Background batches while a provider's breaker is open: they stop (or skip that provider) instead of trying
/// every item, claim nothing they cannot send, and pick the work up on the next run once it answers again.
/// </summary>
public class ProviderOutageBatchTests
{
    /// <summary>11:00 WAT, inside outreach sending hours.</summary>
    private static readonly DateTime Now = new(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc);

    // ---------------------------------------------------------------- outreach

    [Fact]
    public async Task Outreach_stops_while_email_is_down_claims_nothing_and_sends_on_the_next_run()
    {
        using var h = new TestHarness(Now);
        Account(h, "ada@example.com");
        Account(h, "bo@example.com");
        var health = new Outage(OutboundProviders.Email);

        Assert.Equal(0, await Outreach(h, health));
        Assert.Empty(h.Email.Outreach);
        Assert.Empty(h.Db.OutreachMessages.AsNoTracking());

        health.Down.Clear();
        Assert.Equal(2, await Outreach(h, health));
        Assert.Equal(2, h.Email.Outreach.Count);
        Assert.All(h.Db.OutreachMessages.AsNoTracking(), m => Assert.Equal(OutreachStatus.Sent, m.Status));
    }

    [Fact]
    public async Task A_send_refused_by_an_open_breaker_mid_run_is_not_a_spent_try()
    {
        using var h = new TestHarness(Now);
        Account(h, "ada@example.com");
        var health = new Outage();

        h.Email.OutreachError = ProviderErrors.Unavailable;
        await Outreach(h, health);
        var held = h.Db.OutreachMessages.AsNoTracking().Single();
        Assert.Equal((OutreachStatus.Failed, 0), (held.Status, held.Attempts));

        // The provider is back: the retry sweep sends it as its first real try, and it keeps one more.
        h.Email.OutreachError = null;
        h.Clock.UtcNow = Now.AddHours(1);
        Assert.Equal(1, await Outreach(h, health));
        var sent = h.Db.OutreachMessages.AsNoTracking().Single();
        Assert.Equal((OutreachStatus.Sent, 1), (sent.Status, sent.Attempts));
        Assert.Equal(2, h.Email.Outreach.Count);
    }

    [Fact]
    public async Task A_retry_refused_by_an_open_breaker_keeps_its_attempt()
    {
        using var h = new TestHarness(Now);
        Account(h, "ada@example.com");
        var health = new Outage();

        h.Email.OutreachFails = "Resend returned 500"; // a real failed try
        await Outreach(h, health);
        h.Email.OutreachFails = null;

        h.Email.OutreachError = ProviderErrors.Unavailable; // the retry is refused unsent
        h.Clock.UtcNow = Now.AddHours(1);
        await Outreach(h, health);
        var held = h.Db.OutreachMessages.AsNoTracking().Single();
        Assert.Equal((OutreachStatus.Failed, 1), (held.Status, held.Attempts));

        h.Email.OutreachError = null;
        h.Clock.UtcNow = Now.AddHours(2);
        await Outreach(h, health);
        Assert.Equal(OutreachStatus.Sent, h.Db.OutreachMessages.AsNoTracking().Single().Status);
    }

    // ---------------------------------------------------------------- email batches

    [Fact]
    public async Task The_failed_transcription_tips_wait_for_the_email_provider_without_being_claimed()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Ada Lovelace", "ada@example.com", "hash", Now.AddDays(-3));
        h.Db.Users.Add(user);
        var job = TranscriptionJob.Record("job-1", user.Id, Now.AddHours(-1));
        job.Settle(null, Now.AddMinutes(-50));
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();
        var health = new Outage(OutboundProviders.Email);

        Assert.Equal(0, await Tips(h, health));
        Assert.Empty(h.Email.Sent);
        Assert.Null(h.Db.Users.AsNoTracking().Single().FailedTranscriptionEmailSentAtUtc);

        health.Down.Clear();
        Assert.Equal(1, await Tips(h, health));
        Assert.Single(h.Email.Sent);
    }

    [Fact]
    public async Task Abandoned_checkout_reminders_wait_for_the_email_provider_without_being_claimed()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Ada Lovelace", "ada@example.com", "hash", Now.AddDays(-10));
        h.Db.Users.Add(user);
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "NoteFusion Pro (Monthly)", 750_000, "NGN", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        var tx = PaymentTransaction.Create(user.Id, plan.Id, PaymentProvider.Paystack, "idem-1", "ref-1", 750_000, "NGN", Now.AddHours(-5));
        tx.AttachCheckout("ps_1", "https://checkout.paystack.com/1", null, Now.AddHours(-5));
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();
        var health = new Outage(OutboundProviders.Email);

        Assert.Equal(0, await Remind(h, health));
        Assert.Null(h.Db.Users.AsNoTracking().Single().CheckoutReminderSentAtUtc);

        health.Down.Clear();
        Assert.Equal(1, await Remind(h, health));
        Assert.Equal("checkout-abandoned", Assert.Single(h.Email.Sent).Kind);
    }

    [Fact]
    public async Task An_expiry_notice_is_not_claimed_while_email_or_push_is_down()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Pat Pro", "pat@example.com", "hash", Now.AddDays(-60));
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", 499, "USD", BillingInterval.Monthly);
        var sub = Subscription.Start(user.Id, plan.Id, PaymentProvider.Paystack, Now.AddDays(-27), Now.AddDays(3), "s-1", Now.AddDays(-27));
        h.Db.Users.Add(user);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(sub);
        h.Db.SaveChanges();
        var health = new Outage(OutboundProviders.Push);

        var refused = await new NotifySubscriptionExpiringCommandHandler(h.Db, h.Clock, h.Email, h.Push, health)
            .Handle(new NotifySubscriptionExpiringCommand(sub.Id), default);
        Assert.Equal(ProviderErrors.Unavailable, refused.Error);
        Assert.Null(h.Db.Subscriptions.AsNoTracking().Single().ExpiryNoticeSentForPeriodEndUtc);
        Assert.Empty(h.Email.Sent);

        health.Down.Clear();
        var sent = await new NotifySubscriptionExpiringCommandHandler(h.Db, h.Clock, h.Email, h.Push, health)
            .Handle(new NotifySubscriptionExpiringCommand(sub.Id), default);
        Assert.True(sent.IsSuccess);
        Assert.Single(h.Email.Sent);
    }

    // ---------------------------------------------------------------- transcription sweep

    [Fact]
    public async Task The_completion_sweep_stops_asking_a_down_worker_but_still_closes_jobs_past_the_deadline()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Sam Singer", "sam@example.com", "hash", Now.AddDays(-30));
        h.Db.Users.Add(user);
        // The sweep runs on the wall clock, so the ages are measured from it.
        var wall = DateTime.UtcNow;
        var expired = TranscriptionJob.Record("job-old", user.Id, wall - NotifyTranscriptionReadyCommand.GiveUpAfter - TimeSpan.FromMinutes(5));
        var young = TranscriptionJob.Record("job-new", user.Id, wall.AddMinutes(-3));
        h.Db.TranscriptionJobs.AddRange(expired, young);
        h.Db.SaveChanges();

        var asked = new List<object>();
        var health = new Outage(OutboundProviders.Transcription);
        var worker = new TranscriptionCompletionWorker(Scope(h, Recording(asked)), NullLogger<TranscriptionCompletionWorker>.Instance, health);

        await worker.SweepAsync(CancellationToken.None);
        Assert.Collection(asked,
            r => Assert.Equal(expired.Id, Assert.IsType<NotifyTranscriptionReadyCommand>(r).JobRowId),
            r => Assert.IsType<EmailFailedTranscriptionTipsCommand>(r));

        // Back up: the young job is asked about on the next sweep, with no back-off held against it.
        asked.Clear();
        health.Down.Clear();
        await worker.SweepAsync(CancellationToken.None);
        Assert.Contains(asked, r => r is NotifyTranscriptionReadyCommand n && n.JobRowId == young.Id);
    }

    // ---------------------------------------------------------------- payments

    [Fact]
    public async Task Reconciliation_skips_a_down_provider_and_still_asks_the_others()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Pat Payer", "pat@example.com", "hash", Now.AddDays(-30));
        h.Db.Users.Add(user);
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro (Monthly)", 999, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.SaveChanges();
        var bachs = Payment(h, user, plan, PaymentProvider.Bachs, "NF_b", Now.AddMinutes(-20));
        var paystack = Payment(h, user, plan, PaymentProvider.Paystack, "NF_p", Now.AddMinutes(-30));

        var asked = new List<object>();
        var health = new Outage(OutboundProviders.Payment(PaymentProvider.Bachs));
        var worker = new PaymentReconciliationWorker(
            Scope(h, Recording(asked)), new BillingSettings(), NullLogger<PaymentReconciliationWorker>.Instance, health: health);

        await worker.SweepAsync(CancellationToken.None);
        Assert.Equal(new[] { paystack.Id }, asked.Cast<ReconcilePaymentCommand>().Select(c => c.PaymentTransactionId));

        asked.Clear();
        health.Down.Clear();
        await worker.SweepAsync(CancellationToken.None);
        Assert.Contains(asked.Cast<ReconcilePaymentCommand>(), c => c.PaymentTransactionId == bachs.Id);
    }

    // ---------------------------------------------------------------- fixtures

    private sealed class Outage(params string[] down) : IProviderHealth
    {
        public HashSet<string> Down { get; } = [.. down];
        public bool IsUnavailable(string provider) => Down.Contains(provider);
    }

    private static Task<int> Outreach(TestHarness h, IProviderHealth health)
    {
        var settings = new OutreachSettings
        {
            Enabled = true,
            FounderName = "Francis",
            ReplyTo = "hello@notefusion.studio",
        };
        var service = new OutreachService(h.Db, h.Clock, h.Email, h.Push, settings, new HmacEmailUnsubscribeTokens(h.Keys), health);
        return new OutreachRunner(h.Db, service, settings, h.Clock, NullLogger<OutreachRunner>.Instance).RunAsync(default);
    }

    private static async Task<int> Tips(TestHarness h, IProviderHealth health)
        => (await new EmailFailedTranscriptionTipsCommandHandler(h.Db, h.Clock, h.Email, health)
            .Handle(new EmailFailedTranscriptionTipsCommand(), default)).Value;

    private static async Task<int> Remind(TestHarness h, IProviderHealth health)
        => (await new RemindAbandonedCheckoutsCommandHandler(h.Db, h.Clock, h.Email, health)
            .Handle(new RemindAbandonedCheckoutsCommand(), default)).Value;

    /// <summary>A verified account two days past sign-up with no transcription: due the first outreach note.</summary>
    private static void Account(TestHarness h, string email)
    {
        var user = User.Create("Ada Lovelace", email, "hash", Now.AddDays(-3));
        h.MarkEmailVerified(user);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
    }

    private static PaymentTransaction Payment(
        TestHarness h, User user, Plan plan, PaymentProvider provider, string reference, DateTime openedAtUtc)
    {
        var tx = PaymentTransaction.Create(user.Id, plan.Id, provider, $"checkout:{reference}", reference, 999, "USD", openedAtUtc);
        tx.AttachCheckout($"chk_{reference}", "https://pay.test/session", "{}", openedAtUtc);
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();
        return tx;
    }

    private static IServiceScopeFactory Scope(TestHarness h, ISender sender)
    {
        var services = new ServiceCollection();
        services.AddSingleton(h.Db);
        services.AddSingleton(sender);
        services.AddSingleton<IDateTimeProvider>(h.Clock);
        return services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>();
    }

    private static ISender Recording(List<object> asked) => new RecordingSender(asked);

    private sealed class RecordingSender(List<object> asked) : ISender
    {
        public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default)
        {
            asked.Add(request);
            object answer = request is EmailFailedTranscriptionTipsCommand ? Result<int>.Success(0) : Result.Success();
            return Task.FromResult((TResponse)answer);
        }

        public Task Send<TRequest>(TRequest request, CancellationToken cancellationToken = default) where TRequest : IRequest
            => throw new NotSupportedException();
        public Task<object?> Send(object request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();
        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();
        public IAsyncEnumerable<object?> CreateStream(object request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();
    }
}
