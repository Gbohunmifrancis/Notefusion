using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Persistence;

namespace NoteFusion.Infrastructure.Billing.Workers;

/// <summary>
/// Sweeps subscriptions whose paid period ends inside
/// <see cref="NotifySubscriptionExpiringCommand.NoticeWindow"/> and hands each to
/// <see cref="NotifySubscriptionExpiringCommand"/>, which does the notifying and owns the
/// once-per-period rule. Nothing else in the system looks ahead of a period end, so without this a
/// renewal charge arrives with no warning and a cancellation lapses in silence.
/// </summary>
internal sealed class SubscriptionExpiryWorker : BackgroundService
{
    private const int BatchSize = 50;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly BillingSettings _settings;
    private readonly ILogger<SubscriptionExpiryWorker> _logger;

    public SubscriptionExpiryWorker(
        IServiceScopeFactory scopeFactory, BillingSettings settings, ILogger<SubscriptionExpiryWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _settings = settings;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromMinutes(Math.Max(1, _settings.ExpiryNoticeMinutes));

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
                _logger.LogError(ex, "Subscription expiry sweep failed.");
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
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var sender = scope.ServiceProvider.GetRequiredService<ISender>();
        var clock = scope.ServiceProvider.GetRequiredService<IDateTimeProvider>();

        var now = clock.UtcNow;
        var horizon = now + NotifySubscriptionExpiringCommand.NoticeWindow;

        var due = await db.Subscriptions
            .Where(s => (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.Canceled)
                        && s.CurrentPeriodEndUtc > now
                        && s.CurrentPeriodEndUtc <= horizon
                        // Spelled out rather than a bare `!=`: a never-notified row holds NULL, and in
                        // SQL's three-valued logic `NULL <> value` is NULL, not true — which would skip
                        // exactly the rows this sweep exists to find.
                        && (s.ExpiryNoticeSentForPeriodEndUtc == null
                            || s.ExpiryNoticeSentForPeriodEndUtc != s.CurrentPeriodEndUtc))
            .OrderBy(s => s.CurrentPeriodEndUtc)
            .Take(BatchSize)
            .Select(s => s.Id)
            .ToListAsync(ct);

        foreach (var id in due)
        {
            var result = await sender.Send(new NotifySubscriptionExpiringCommand(id), ct);
            if (result.IsFailure && ProviderErrors.IsUnavailable(result.Error))
            {
                // Email or push is down: the rest would be refused too. They are still due next sweep.
                _logger.LogWarning("Expiry notices paused for this sweep: the email or push provider is unavailable.");
                break;
            }
            if (result.IsFailure)
                _logger.LogWarning("Expiry notice for {Id} failed: {Error}", id, result.Error.Message);
        }

        if (due.Count > 0)
            _logger.LogInformation("Sent {Count} subscription expiry notice(s).", due.Count);
    }
}
