using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Activity.Commands;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Activity;

/// <summary>
/// Once a day, deletes the activity the dashboard keeps for 180 days: web events and the transcription
/// activity log. Same shape as the billing sweeps: a failed run is logged and retried the next day.
/// </summary>
internal sealed class ActivityRetentionWorker : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(24);

    /// <summary>Not at start-up: a deploy should not begin by deleting rows.</summary>
    private static readonly TimeSpan FirstRunDelay = TimeSpan.FromMinutes(10);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ActivityRetentionWorker> _logger;
    private readonly IWorkerHeartbeatTracker? _heartbeatTracker;

    public ActivityRetentionWorker(
        IServiceScopeFactory scopeFactory,
        ILogger<ActivityRetentionWorker> logger,
        IWorkerHeartbeatTracker? heartbeatTracker = null)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _heartbeatTracker = heartbeatTracker;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
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
            delay = Interval;

            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var result = await scope.ServiceProvider.GetRequiredService<ISender>().Send(new PurgeOldActivityCommand(), stoppingToken);
                sw.Stop();
                if (result.IsSuccess)
                {
                    _heartbeatTracker?.RecordHeartbeat("ActivityRetention", sw.ElapsedMilliseconds, "Healthy",
                        $"Deleted {result.Value.WebEvents} web events, {result.Value.TranscriptionLogs} activity rows");
                    if (result.Value.WebEvents + result.Value.TranscriptionLogs > 0)
                        _logger.LogInformation("Activity retention: deleted {Events} web events and {Logs} activity rows.",
                            result.Value.WebEvents, result.Value.TranscriptionLogs);
                }
                else
                {
                    _heartbeatTracker?.RecordHeartbeat("ActivityRetention", sw.ElapsedMilliseconds, "Degraded", result.Error.Message);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _heartbeatTracker?.RecordHeartbeat("ActivityRetention", sw.ElapsedMilliseconds, "Failed", ex.Message);
                _logger.LogError(ex, "Activity retention sweep failed.");
            }
        }
    }
}
