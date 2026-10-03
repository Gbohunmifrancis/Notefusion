using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Persistence;

namespace NoteFusion.Infrastructure.Billing.Workers;

/// <summary>
/// Drains the webhook inbox (the "Background Worker" step of Receive → Validate → Persist → Publish →
/// Worker). It polls for <see cref="WebhookStatus.Received"/> rows and hands each to
/// <see cref="ProcessWebhookEventCommand"/>, which applies the effect exactly once inside a single
/// transaction. Processing is decoupled from the HTTP request so the provider always gets a fast 200
/// and retries here — not on their side — drive eventual delivery. A handler failure (or throw) is
/// recorded on the row (incrementing attempts) so it is retried, after a growing delay, until the
/// configured limit, then parked as Failed for reconciliation. Each event is isolated: one that keeps
/// failing never blocks the others.
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

    /// <summary>
    /// One pass over the inbox. Internal so a test can drive a single pass without the polling loop.
    /// </summary>
    internal async Task DrainAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var sender = scope.ServiceProvider.GetRequiredService<ISender>();
        var clock = scope.ServiceProvider.GetRequiredService<IDateTimeProvider>();
        var now = clock.UtcNow;

        // Backoff is decided per row (WebhookEvent.IsDueForRetry), so a window of candidates is read and
        // filtered here. Fewest attempts first: a fresh event is never queued behind one that is waiting
        // out a long retry delay.
        var candidates = await db.WebhookEvents
            .Where(e => e.Status == WebhookStatus.Received)
            .OrderBy(e => e.ProcessAttempts)
            .ThenBy(e => e.ReceivedAtUtc)
            .Take(BatchSize * 10)
            .Select(e => new { e.Id, e.ProcessAttempts, e.LastAttemptAtUtc })
            .ToListAsync(ct);

        var due = candidates
            .Where(e => WebhookEvent.IsDueForRetry(e.ProcessAttempts, e.LastAttemptAtUtc, now))
            .Take(BatchSize)
            .Select(e => e.Id)
            .ToList();

        foreach (var id in due)
        {
            string error;
            try
            {
                var result = await sender.Send(new ProcessWebhookEventCommand(id), ct);
                if (result.IsSuccess)
                    continue;
                error = result.Error.Message;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                // One event that throws — an illegal state transition, a constraint the save tripped — must
                // not stop every event behind it. It is recorded like any other failure and retried later.
                _logger.LogError(ex, "Webhook {Id} processing threw.", id);
                error = ex.Message;
            }

            try
            {
                // The handler shares this context. A failure part-way through can leave staged changes
                // tracked, and they must not ride along with the failure record into the database.
                db.ChangeTracker.Clear();

                // Record the failure on the row so it retries after a backoff, then parks after the limit.
                var e = await db.WebhookEvents.FirstOrDefaultAsync(x => x.Id == id, ct);
                if (e is null || e.Status != WebhookStatus.Received)
                    continue;

                e.RecordFailure(error, _settings.MaxWebhookAttempts, clock.UtcNow);
                await db.SaveChangesAsync(ct);
                _logger.LogWarning("Webhook {Id} processing failed: {Error}", id, error);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                db.ChangeTracker.Clear();
                _logger.LogError(ex, "Could not record the failure of webhook {Id}.", id);
            }
        }
    }
}
