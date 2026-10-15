using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Persistence;

namespace NoteFusion.Infrastructure.Billing.Workers;

/// <summary>
/// Periodically reconciles payments against the provider so a dropped webhook never silently loses a
/// customer their subscription. It sweeps transactions still in <see cref="PaymentStatus.Processing"/>
/// past a short grace window (long enough for the normal webhook to arrive) and asks the provider what
/// happened via <see cref="ReconcilePaymentCommand"/>. Rows that went <see cref="PaymentStatus.Failed"/>
/// in the last two days are asked about again too, less often, because a checkout we closed can still
/// have been paid. This is the safety net behind the webhook inbox, not the primary path.
/// </summary>
internal sealed class PaymentReconciliationWorker : BackgroundService
{
    private const int BatchSize = 50;

    /// <summary>How far back a failed checkout is still worth asking the provider about.</summary>
    private static readonly TimeSpan FailedLookback = TimeSpan.FromHours(48);

    /// <summary>
    /// How often failed rows join the sweep. Nearly all of them really are dead, and each is a provider call,
    /// so they are not asked about every few minutes; the customer who is waiting on one is covered sooner
    /// by <c>ConfirmPaymentCommand</c> and by the provider's own webhook.
    /// </summary>
    private static readonly TimeSpan FailedRecheckInterval = TimeSpan.FromMinutes(30);

    private DateTime _nextFailedRecheckUtc = DateTime.MinValue;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly BillingSettings _settings;
    private readonly IWorkerHeartbeatTracker? _heartbeatTracker;
    private readonly ILogger<PaymentReconciliationWorker> _logger;

    public PaymentReconciliationWorker(
        IServiceScopeFactory scopeFactory,
        BillingSettings settings,
        ILogger<PaymentReconciliationWorker> logger,
        IWorkerHeartbeatTracker? heartbeatTracker = null)
    {
        _scopeFactory = scopeFactory;
        _settings = settings;
        _logger = logger;
        _heartbeatTracker = heartbeatTracker;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromMinutes(Math.Max(1, _settings.ReconciliationMinutes));

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SweepAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Reconciliation sweep failed.");
            }

            try
            {
                await Task.Delay(interval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    internal async Task SweepAsync(CancellationToken ct)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var sender = scope.ServiceProvider.GetRequiredService<ISender>();
            var clock = scope.ServiceProvider.GetRequiredService<IDateTimeProvider>();

            var now = clock.UtcNow;
            var includeFailed = now >= _nextFailedRecheckUtc;
            var due = await SelectDueAsync(db, now, _settings, includeFailed, ct);
            if (includeFailed)
                _nextFailedRecheckUtc = now + FailedRecheckInterval;

            var failedReconcile = 0;
            foreach (var id in due)
            {
                // One payment that throws (a provider answer we cannot parse, a constraint violation) must not
                // stop the rest of the sweep, and must not leave its half-staged changes in the shared context
                // for the next payment's save to commit.
                try
                {
                    var result = await sender.Send(new ReconcilePaymentCommand(id), ct);
                    if (result.IsFailure)
                    {
                        failedReconcile++;
                        _logger.LogWarning("Reconciliation of {Id} failed: {Error}", id, result.Error.Message);
                    }
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    failedReconcile++;
                    _logger.LogError(ex, "Reconciliation of {Id} threw; moving on to the next payment.", id);
                }
                finally
                {
                    db.ChangeTracker.Clear();
                }
            }

            sw.Stop();
            _heartbeatTracker?.RecordHeartbeat(
                "PaymentReconciliation",
                sw.ElapsedMilliseconds,
                failedReconcile > 0 ? "Degraded" : "Healthy",
                due.Count > 0 ? $"Swept {due.Count} payments ({failedReconcile} failed)" : "No stuck payments");

            if (due.Count > 0)
                _logger.LogInformation("Reconciliation swept {Count} payment(s).", due.Count);
        }
        catch (Exception ex)
        {
            sw.Stop();
            _heartbeatTracker?.RecordHeartbeat(
                "PaymentReconciliation", sw.ElapsedMilliseconds, "Failed", ex.Message);
            throw;
        }
    }

    /// <summary>
    /// The payments one sweep asks the provider about: Processing rows past the grace window, newest first,
    /// and — when <paramref name="includeFailed"/> — rows failed in the last two days that the provider can
    /// still be asked about, newest first. Internal so the selection can be tested without the loop.
    /// </summary>
    internal static async Task<List<Guid>> SelectDueAsync(
        ApplicationDbContext db, DateTime utcNow, BillingSettings settings, bool includeFailed, CancellationToken ct)
    {
        // Same window the admin console calls "stuck", read from the one place both can see it.
        var cutoff = utcNow - TimeSpan.FromMinutes(Math.Max(1, settings.ReconciliationGraceMinutes));

        // Newest first. The row a customer is waiting on is the one they just paid; oldest first would let a
        // backlog the provider cannot settle (abandoned carts, answers we cannot read) take every slot of
        // the batch, sweep after sweep, while that row waits. Older stragglers are ClearStalePayments' job.
        var due = await db.PaymentTransactions
            .Where(t => t.Status == PaymentStatus.Processing && t.UpdatedAtUtc < cutoff)
            .OrderByDescending(t => t.UpdatedAtUtc)
            .Take(BatchSize)
            .Select(t => t.Id)
            .ToListAsync(ct);

        if (!includeFailed)
            return due;

        // A checkout we closed can still have been paid (a sweep that failed it mid-payment, a webhook
        // that went astray). No reference means no way to ask, so those are left out.
        var failedSince = utcNow - FailedLookback;
        due.AddRange(await db.PaymentTransactions
            .Where(t => t.Status == PaymentStatus.Failed
                        && t.UpdatedAtUtc >= failedSince
                        && t.ProviderReference != null)
            .OrderByDescending(t => t.UpdatedAtUtc)
            .Take(BatchSize)
            .Select(t => t.Id)
            .ToListAsync(ct));

        return due;
    }
}
