using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Outreach;

namespace NoteFusion.Infrastructure.Outreach;

/// <summary>
/// Runs <see cref="OutreachRunner"/> every <see cref="OutreachSettings.IntervalMinutes"/>. Does nothing at all,
/// and says why once at startup, unless <c>Outreach__Enabled</c> is true and a founder name and reply-to
/// address are set.
/// </summary>
internal sealed class OutreachWorker : BackgroundService
{
    /// <summary>Not at start-up: a deploy should settle before it starts writing to people.</summary>
    private static readonly TimeSpan FirstRunDelay = TimeSpan.FromMinutes(5);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly OutreachSettings _settings;
    private readonly ILogger<OutreachWorker> _logger;
    private readonly IWorkerHeartbeatTracker? _heartbeatTracker;

    public OutreachWorker(
        IServiceScopeFactory scopeFactory,
        OutreachSettings settings,
        ILogger<OutreachWorker> logger,
        IWorkerHeartbeatTracker? heartbeatTracker = null)
    {
        _scopeFactory = scopeFactory;
        _settings = settings;
        _logger = logger;
        _heartbeatTracker = heartbeatTracker;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (_settings.DisabledReason is { } reason)
        {
            _logger.LogInformation("Customer-research outreach is off: {Reason}.", reason);
            return;
        }

        _logger.LogInformation(
            "Customer-research outreach is on: up to {Batch} accounts every {Minutes} min, 09:00-19:00 in each account's own time zone (WAT when unknown), from {Founder}.",
            _settings.BatchSize, _settings.IntervalMinutes, _settings.FounderName);

        var delay = FirstRunDelay;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(delay, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            delay = TimeSpan.FromMinutes(Math.Max(1, _settings.IntervalMinutes));

            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var sent = await scope.ServiceProvider.GetRequiredService<OutreachRunner>().RunAsync(stoppingToken);
                _heartbeatTracker?.RecordHeartbeat("Outreach", sw.ElapsedMilliseconds, "Healthy", $"Wrote to {sent} accounts");
                if (sent > 0)
                    _logger.LogInformation("Outreach: wrote to {Count} accounts.", sent);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _heartbeatTracker?.RecordHeartbeat("Outreach", sw.ElapsedMilliseconds, "Failed", ex.Message);
                _logger.LogError(ex, "Outreach run failed.");
            }
        }
    }
}
