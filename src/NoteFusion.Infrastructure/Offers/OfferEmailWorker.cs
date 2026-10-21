using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Offers;

namespace NoteFusion.Infrastructure.Offers;

/// <summary>
/// Runs <see cref="OfferEmailService"/> every <see cref="OfferSettings.IntervalMinutes"/> (five by default): the offer
/// emails an admin queued go out in each person's own sending hours as the email quota allows. Does nothing, and says so
/// once at startup, while <c>Offers__Enabled</c> is false. A failed run is logged and the next one tries again.
/// </summary>
internal sealed class OfferEmailWorker : BackgroundService
{
    /// <summary>Not at start-up: a deploy should settle before it starts writing to people.</summary>
    private static readonly TimeSpan FirstRunDelay = TimeSpan.FromMinutes(2);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly OfferSettings _settings;
    private readonly ILogger<OfferEmailWorker> _logger;
    private readonly IWorkerHeartbeatTracker? _heartbeatTracker;

    public OfferEmailWorker(
        IServiceScopeFactory scopeFactory,
        OfferSettings settings,
        ILogger<OfferEmailWorker> logger,
        IWorkerHeartbeatTracker? heartbeatTracker = null)
    {
        _scopeFactory = scopeFactory;
        _settings = settings;
        _logger = logger;
        _heartbeatTracker = heartbeatTracker;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_settings.Enabled)
        {
            _logger.LogInformation("Offer emails are off: Offers__Enabled is false. Queued offer emails wait.");
            return;
        }

        try
        {
            await Task.Delay(FirstRunDelay, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(Math.Max(1, _settings.IntervalMinutes)));
        do
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var sent = await scope.ServiceProvider.GetRequiredService<OfferEmailService>().RunAsync(stoppingToken);
                _heartbeatTracker?.RecordHeartbeat("OfferEmails", sw.ElapsedMilliseconds, "Healthy", $"Sent {sent} offer emails");
                if (sent > 0)
                    _logger.LogInformation("Offer emails: sent {Count}.", sent);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _heartbeatTracker?.RecordHeartbeat("OfferEmails", sw.ElapsedMilliseconds, "Failed", ex.Message);
                _logger.LogError(ex, "Offer email run failed.");
            }
        }
        while (await WaitAsync(timer, stoppingToken));
    }

    private static async Task<bool> WaitAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            return await timer.WaitForNextTickAsync(ct);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}
