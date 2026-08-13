using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Persistence;

namespace NoteFusion.Infrastructure.Billing.Workers;

/// <summary>
/// Drains the webhook inbox (the "Background Worker" step of Receive → Validate → Persist → Publish →
/// Worker). It polls for <see cref="WebhookStatus.Received"/> rows and hands each to
/// <see cref="ProcessWebhookEventCommand"/>, which applies the effect exactly once inside a single
/// transaction. Processing is decoupled from the HTTP request so the provider always gets a fast 200
/// and retries here — not on their side — drive eventual delivery. A handler failure is recorded on
/// the row (incrementing attempts) so it is retried until the configured limit, then parked as Failed
/// for reconciliation.
/// </summary>
internal sealed class PaymentWebhookWorker : BackgroundService
{
    private const int BatchSize = 20;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly BillingSettings _settings;
    private readonly ILogger<PaymentWebhookWorker> _logger;

    public PaymentWebhookWorker(
        IServiceScopeFactory scopeFactory, BillingSettings settings, ILogger<PaymentWebhookWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _settings = settings;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromSeconds(Math.Max(1, _settings.WebhookPollSeconds));

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await DrainAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // A worker must never die on a transient fault; log and keep polling.
                _logger.LogError(ex, "Webhook worker tick failed.");
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

    private async Task DrainAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var sender = scope.ServiceProvider.GetRequiredService<ISender>();

        var pending = await db.WebhookEvents
            .Where(e => e.Status == WebhookStatus.Received)
            .OrderBy(e => e.ReceivedAtUtc)
            .Take(BatchSize)
            .Select(e => e.Id)
            .ToListAsync(ct);

        foreach (var id in pending)
        {
            var result = await sender.Send(new ProcessWebhookEventCommand(id), ct);
            if (result.IsSuccess)
                continue;

            // Record the failure on the row so it retries, then parks after the attempt limit.
            var e = await db.WebhookEvents.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (e is null || e.Status != WebhookStatus.Received)
                continue;

            e.RecordFailure(result.Error.Message, _settings.MaxWebhookAttempts, DateTimeUtc(scope));
            await db.SaveChangesAsync(ct);
            _logger.LogWarning("Webhook {Id} processing failed: {Error}", id, result.Error.Message);
        }
    }

    private static DateTime DateTimeUtc(IServiceScope scope)
        => scope.ServiceProvider.GetRequiredService<Application.Common.Interfaces.IDateTimeProvider>().UtcNow;
}
