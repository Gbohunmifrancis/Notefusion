using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Reminders;

namespace NoteFusion.Infrastructure.Practice;

/// <summary>
/// Runs <see cref="PracticeReminderRunner"/> every <see cref="PracticeReminderSettings.IntervalMinutes"/> (10): each
/// run sends the reminders whose moment has come on their singers' own clocks. Says once at startup when it is off.
/// </summary>
internal sealed class PracticeReminderWorker : BackgroundService
{
    /// <summary>Not at start-up: a deploy should settle before it starts writing to people.</summary>
    private static readonly TimeSpan FirstRunDelay = TimeSpan.FromMinutes(2);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly PracticeReminderSettings _settings;
    private readonly ILogger<PracticeReminderWorker> _logger;
    private readonly IWorkerHeartbeatTracker? _heartbeatTracker;

    public PracticeReminderWorker(
        IServiceScopeFactory scopeFactory,
        PracticeReminderSettings settings,
        ILogger<PracticeReminderWorker> logger,
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
            _logger.LogInformation("Practice reminders are off: PracticeReminders__Enabled is false.");
            return;
        }

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
                var sent = await scope.ServiceProvider.GetRequiredService<PracticeReminderRunner>().RunAsync(stoppingToken);
                _heartbeatTracker?.RecordHeartbeat("PracticeReminders", sw.ElapsedMilliseconds, "Healthy", $"Sent {sent} reminders");
                if (sent > 0)
                    _logger.LogInformation("Practice reminders: sent {Count}.", sent);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _heartbeatTracker?.RecordHeartbeat("PracticeReminders", sw.ElapsedMilliseconds, "Failed", ex.Message);
                _logger.LogError(ex, "Practice reminder run failed.");
            }
        }
    }
}
