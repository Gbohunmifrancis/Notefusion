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
/// happened via <see cref="ReconcilePaymentCommand"/>. This is the safety net behind the webhook inbox,
/// not the primary path — it runs infrequently.
/// </summary>
internal sealed class PaymentReconciliationWorker : BackgroundService
{
    private const int BatchSize = 50;

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

    private async Task SweepAsync(CancellationToken ct)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var sender = scope.ServiceProvider.GetRequiredService<ISender>();
            var clock = scope.ServiceProvider.GetRequiredService<IDateTimeProvider>();

            // Same window the admin console calls "stuck", read from the one place both can see it.
            var cutoff = clock.UtcNow - TimeSpan.FromMinutes(Math.Max(1, _settings.ReconciliationGraceMinutes));

            var stuck = await db.PaymentTransactions
                .Where(t => t.Status == PaymentStatus.Processing && t.UpdatedAtUtc < cutoff)
                .OrderBy(t => t.UpdatedAtUtc)
                .Take(BatchSize)
                .Select(t => t.Id)
                .ToListAsync(ct);

            var failedReconcile = 0;
            foreach (var id in stuck)
            {
                var result = await sender.Send(new ReconcilePaymentCommand(id), ct);
                if (result.IsFailure)
                {
                    failedReconcile++;
                    _logger.LogWarning("Reconciliation of {Id} failed: {Error}", id, result.Error.Message);
                }
            }

            sw.Stop();
            _heartbeatTracker?.RecordHeartbeat(
                "PaymentReconciliation",
                sw.ElapsedMilliseconds,
                failedReconcile > 0 ? "Degraded" : "Healthy",
                stuck.Count > 0 ? $"Swept {stuck.Count} stuck payments ({failedReconcile} failed)" : "No stuck payments");

            if (stuck.Count > 0)
                _logger.LogInformation("Reconciliation swept {Count} stuck payment(s).", stuck.Count);
        }
        catch (Exception ex)
        {
            sw.Stop();
            _heartbeatTracker?.RecordHeartbeat(
                "PaymentReconciliation", sw.ElapsedMilliseconds, "Failed", ex.Message);
            throw;
        }
    }
}
