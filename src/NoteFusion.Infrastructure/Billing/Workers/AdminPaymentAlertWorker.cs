using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Admin.Commands;
using NoteFusion.Application.Common.Settings;

namespace NoteFusion.Infrastructure.Billing.Workers;

/// <summary>
/// Watches for payment conditions the automatic paths cannot clear and pushes one digest to the admins.
/// Runs on <see cref="PaymentReconciliationWorker"/>'s heels — the alert is about what that sweep could
/// not fix, so its cadence is the right one and needs no setting of its own.
/// </summary>
/// <remarks>
/// De-dup state is this field and nothing else: no column, no migration. A redeploy re-arms it and can
/// repeat one digest, which is the right way round to be wrong about an unfulfilled payment.
/// </remarks>
internal sealed class AdminPaymentAlertWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly BillingSettings _settings;
    private readonly ILogger<AdminPaymentAlertWorker> _logger;

    private PaymentIssueSignature? _lastNotified;

    public AdminPaymentAlertWorker(
        IServiceScopeFactory scopeFactory, BillingSettings settings, ILogger<AdminPaymentAlertWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _settings = settings;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromMinutes(Math.Max(1, _settings.ReconciliationMinutes));

        while (!stoppingToken.IsCancellationRequested)
        {
            // Delay first, unlike the reconciliation sweep. Two reasons, both about a fresh boot:
            // migrations have not necessarily finished, and webhooks that queued up while the old
            // instance was down are already older than the backlog cutoff — checking straight away
            // would alert on a backlog before PaymentWebhookWorker had its first chance to drain it.
            try
            {
                await Task.Delay(interval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            try
            {
                await CheckAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Admin payment alert check failed.");
            }
        }
    }

    private async Task CheckAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var sender = scope.ServiceProvider.GetRequiredService<ISender>();

        var result = await sender.Send(new NotifyAdminsOfPaymentIssuesCommand(_lastNotified), ct);
        if (result.IsFailure)
        {
            _logger.LogWarning("Admin payment alert check failed: {Error}", result.Error.Message);
            return;
        }

        // Only ever moves forward on a successful check, so a failed one cannot silence the next.
        _lastNotified = result.Value;

        if (result.Value.Total > 0)
            _logger.LogInformation("Payment conditions needing action: {Signature}.", result.Value);
    }
}
