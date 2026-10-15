using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Billing.Workers;
using NoteFusion.Infrastructure.Transcriptions.Workers;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The background sweeps take their items one at a time: one that throws is logged and skipped, its
/// half-staged changes are dropped rather than committed by the next item's save, and the rest of the
/// batch still runs.
/// </summary>
public class WorkerIsolationTests
{
    private static readonly DateTime Now = new(2026, 9, 10, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task A_payment_that_throws_does_not_stop_the_reconciliation_sweep_or_leak_its_changes()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Pat Payer", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        h.Db.Users.Add(user);
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro (Monthly)", 999, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.SaveChanges();

        // Newest first, so the one that throws is asked about before the other.
        var good = Payment(h, user, plan, "NF_good", Now.AddMinutes(-20));
        var bad = Payment(h, user, plan, "NF_bad", Now.AddMinutes(-10));

        var asked = new List<Guid>();
        var sender = new ScriptedSender(async (request, ct) =>
        {
            var id = ((ReconcilePaymentCommand)request).PaymentTransactionId;
            asked.Add(id);
            var tx = await h.Db.PaymentTransactions.FirstAsync(t => t.Id == id, ct);
            tx.MarkFailed("staged by the payment that then throws", Now);
            if (id == bad.Id)
                throw new InvalidOperationException("boom");
            await h.Db.SaveChangesAsync(ct);
            return Result.Success();
        });

        var worker = new PaymentReconciliationWorker(
            Scope(h, sender), new BillingSettings(), NullLogger<PaymentReconciliationWorker>.Instance);
        await worker.SweepAsync(CancellationToken.None);

        Assert.Equal(new[] { bad.Id, good.Id }, asked);
        var statuses = await h.Db.PaymentTransactions.AsNoTracking().ToDictionaryAsync(t => t.Id, t => t.Status);
        Assert.Equal(PaymentStatus.Failed, statuses[good.Id]);
        // The thrower's staged change was dropped, not committed by the next payment's save.
        Assert.Equal(PaymentStatus.Processing, statuses[bad.Id]);
    }

    [Fact]
    public async Task A_job_whose_follow_up_keeps_failing_sits_out_later_sweeps_and_does_not_block_the_rest()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Sam Singer", "sam@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        h.Db.Users.Add(user);
        var bad = TranscriptionJob.Record("job-bad", user.Id, Now.AddMinutes(-30));
        var good = TranscriptionJob.Record("job-good", user.Id, Now.AddMinutes(-20));
        h.Db.TranscriptionJobs.AddRange(bad, good);
        h.Db.SaveChanges();

        var asked = new List<Guid>();
        var sender = new ScriptedSender((request, _) =>
        {
            var id = ((NotifyTranscriptionReadyCommand)request).JobRowId;
            asked.Add(id);
            return id == bad.Id
                ? throw new InvalidOperationException("boom")
                : Task.FromResult<object>(Result.Success());
        });

        var worker = new TranscriptionCompletionWorker(Scope(h, sender), NullLogger<TranscriptionCompletionWorker>.Instance);
        await worker.SweepAsync(CancellationToken.None);
        await worker.SweepAsync(CancellationToken.None);

        // First sweep: both, oldest first. Second: the one that threw is backed off; the other still runs.
        Assert.Equal(new[] { bad.Id, good.Id, good.Id }, asked);
    }

    private static PaymentTransaction Payment(TestHarness h, User user, Plan plan, string reference, DateTime openedAtUtc)
    {
        var tx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Bachs, $"checkout:{reference}", reference, 999, "USD", openedAtUtc);
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

    private sealed class ScriptedSender(Func<object, CancellationToken, Task<object>> handle) : ISender
    {
        public async Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default)
            => (TResponse)await handle(request, cancellationToken);

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
