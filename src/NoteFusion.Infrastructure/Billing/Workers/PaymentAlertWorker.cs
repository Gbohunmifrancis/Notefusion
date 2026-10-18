using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Admin.PaymentAlerts;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Billing.Workers;

/// <summary>
/// Sends the admins' "someone just paid" push a few seconds after a payment completes (<see cref="SendPaymentAlertsCommand"/>).
/// The claims are written with the payments' ledger credits, whichever path fulfilled them (a webhook, the
/// reconciliation sweep, an operator's Reconcile), so this one loop is the only sender and two can never race.
/// Payments found together go out as one summary.
/// </summary>
internal sealed class PaymentAlertWorker : BackgroundService
{
    /// <summary>How often the claims are read: often enough that the push reads "now".</summary>
    internal static readonly TimeSpan Interval = TimeSpan.FromSeconds(10);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IWorkerHeartbeatTracker? _heartbeats;
    private readonly ILogger<PaymentAlertWorker> _logger;

    public PaymentAlertWorker(
        IServiceScopeFactory scopeFactory, ILogger<PaymentAlertWorker> logger, IWorkerHeartbeatTracker? heartbeats = null)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _heartbeats = heartbeats;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var result = await scope.ServiceProvider.GetRequiredService<ISender>()
                    .Send(new SendPaymentAlertsCommand(), stoppingToken);
                sw.Stop();

                if (result.IsFailure)
                {
                    _heartbeats?.RecordHeartbeat("PaymentAlerts", sw.ElapsedMilliseconds, "Degraded", result.Error.Message);
                    continue;
                }

                var run = result.Value;
                _heartbeats?.RecordHeartbeat(
                    "PaymentAlerts",
                    sw.ElapsedMilliseconds,
                    run.Failed > 0 ? "Degraded" : "Healthy",
                    run.Payments == 0
                        ? "Nothing new to report"
                        : $"{run.Payments} payment(s) to {run.Devices} admin phone(s)");
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                sw.Stop();
                _heartbeats?.RecordHeartbeat("PaymentAlerts", sw.ElapsedMilliseconds, "Failed", ex.Message);
                _logger.LogError(ex, "Payment alert run failed.");
            }
        }
    }
}
