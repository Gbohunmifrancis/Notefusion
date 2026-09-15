using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;

namespace NoteFusion.Infrastructure.Billing.Workers;

/// <summary>
/// Background worker that periodically clears stale payments that can no longer be processed.
/// Sweeps abandoned <c>Pending</c> transactions and expired <c>Processing</c> checkouts that
/// have exceeded their maximum validity window.
/// </summary>
internal sealed class StalePaymentCleanupWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly BillingSettings _settings;
    private readonly IWorkerHeartbeatTracker? _heartbeatTracker;
    private readonly ILogger<StalePaymentCleanupWorker> _logger;

    public StalePaymentCleanupWorker(
        IServiceScopeFactory scopeFactory,
        BillingSettings settings,
        ILogger<StalePaymentCleanupWorker> logger,
        IWorkerHeartbeatTracker? heartbeatTracker = null)
    {
        _scopeFactory = scopeFactory;
        _settings = settings;
        _logger = logger;
        _heartbeatTracker = heartbeatTracker;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromMinutes(Math.Max(5, _settings.StalePaymentSweepMinutes));

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
                _logger.LogError(ex, "Stale payment cleanup sweep failed.");
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
            var sender = scope.ServiceProvider.GetRequiredService<ISender>();

            var result = await sender.Send(new ClearStalePaymentsCommand(), ct);
            sw.Stop();

            if (result.IsFailure)
            {
                _heartbeatTracker?.RecordHeartbeat(
                    "StalePaymentCleanup", sw.ElapsedMilliseconds, "Degraded", result.Error.Message);
                _logger.LogWarning("Stale payment cleanup failed: {Error}", result.Error.Message);
                return;
            }

            var stats = result.Value;
            _heartbeatTracker?.RecordHeartbeat(
                "StalePaymentCleanup",
                sw.ElapsedMilliseconds,
                "Healthy",
                $"Pending cleared: {stats.ClearedPendingCount}, Processing cleared: {stats.ClearedProcessingCount}, Fulfilled: {stats.FulfilledCount}");

            if (stats.ClearedPendingCount > 0 || stats.ClearedProcessingCount > 0 || stats.FulfilledCount > 0)
            {
                _logger.LogInformation(
                    "Stale payment cleanup: cleared {Pending} pending, {Processing} processing, fulfilled {Fulfilled}.",
                    stats.ClearedPendingCount, stats.ClearedProcessingCount, stats.FulfilledCount);
            }
        }
        catch (Exception ex)
        {
            sw.Stop();
            _heartbeatTracker?.RecordHeartbeat(
                "StalePaymentCleanup", sw.ElapsedMilliseconds, "Failed", ex.Message);
            throw;
        }
    }
}
