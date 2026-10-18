using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Billing.GooglePlay;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure.Persistence;

namespace NoteFusion.Infrastructure.Billing.Workers;

/// <summary>
/// The backstop behind the app's call and Google's notifications, every 15 minutes: a new subscription not yet
/// acknowledged (Google refunds one left three days), a one-song purchase not yet consumed, and a renewal that should
/// have come and was not heard of (a lost notification, read again at most every six hours). Each is applied
/// through <see cref="GooglePlaySync"/>, exactly as a notification would be. Idle without a service account.
/// </summary>
internal sealed class GooglePlaySyncWorker : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan AcknowledgeWindow = TimeSpan.FromDays(3);
    private static readonly TimeSpan MissedRenewalWindow = TimeSpan.FromDays(3);
    private static readonly TimeSpan RecheckEvery = TimeSpan.FromHours(6);
    private const int BatchSize = 50;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<GooglePlaySyncWorker> _logger;

    public GooglePlaySyncWorker(IServiceScopeFactory scopeFactory, ILogger<GooglePlaySyncWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
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
                _logger.LogError(ex, "Google Play sync sweep failed.");
            }

            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    internal async Task SweepAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        if (!scope.ServiceProvider.GetRequiredService<IGooglePlayClient>().IsConfigured)
            return;

        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var now = scope.ServiceProvider.GetRequiredService<IDateTimeProvider>().UtcNow;
        var ackSince = now - AcknowledgeWindow;
        var renewalSince = now - MissedRenewalWindow;
        var recheckBefore = now - RecheckEvery;

        var due = await db.GooglePlayPurchases.AsNoTracking()
            .Where(p => p.ReplacedByToken == null
                        && ((p.IsSubscription && !p.Acknowledged && p.CreatedAtUtc > ackSince
                             && (p.State == GooglePlaySync.StateActive || p.State == GooglePlaySync.StateCanceled
                                 || p.State == GooglePlaySync.StateGrace))
                            || (!p.IsSubscription && !p.Consumed && p.State == GooglePlaySync.OneTimePurchased)
                            || (p.IsSubscription && p.AutoRenewing && p.ExpiryUtc < now && p.ExpiryUtc > renewalSince
                                && p.UpdatedAtUtc < recheckBefore)))
            .OrderBy(p => p.UpdatedAtUtc)
            .Take(BatchSize)
            .Select(p => new { p.PurchaseToken, p.ProductId, p.IsSubscription })
            .ToListAsync(ct);

        foreach (var token in due)
        {
            // A scope per token: one that fails to save must not leave its changes in the next one's context.
            using var item = _scopeFactory.CreateScope();
            var sync = item.ServiceProvider.GetRequiredService<GooglePlaySync>();
            var result = token.IsSubscription
                ? await sync.SyncSubscriptionAsync(token.PurchaseToken, caller: null, ct)
                : await sync.SyncOneTimeAsync(token.ProductId, token.PurchaseToken, caller: null, ct);
            if (result.IsFailure && result.Error == BillingErrors.PlayUnavailable)
                break;
        }
    }
}
