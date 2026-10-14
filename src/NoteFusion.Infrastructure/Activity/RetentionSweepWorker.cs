using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Activity;

/// <summary>
/// Every ten minutes, the two sweeps that keep people coming back: finished transcriptions nobody saved
/// go into their owner's library (<see cref="AutoSaveFinishedTranscriptionsCommand"/>), and a Pro
/// checkout left unfinished gets one email (<see cref="RemindAbandonedCheckoutsCommand"/>). Each runs in
/// its own scope, so one failing does not stop the other; a failed run is logged and tried again on the
/// next tick.
/// </summary>
internal sealed class RetentionSweepWorker : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(10);

    /// <summary>Not at start-up: a deploy should settle before it starts writing sheets and sending email.</summary>
    private static readonly TimeSpan FirstRunDelay = TimeSpan.FromMinutes(5);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<RetentionSweepWorker> _logger;
    private readonly IWorkerHeartbeatTracker? _heartbeatTracker;

    public RetentionSweepWorker(
        IServiceScopeFactory scopeFactory,
        ILogger<RetentionSweepWorker> logger,
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

            await RunAsync("AutoSaveSheets", new AutoSaveFinishedTranscriptionsCommand(),
                n => $"Kept {n} unsaved sheets", stoppingToken);
            await RunAsync("CheckoutReminders", new RemindAbandonedCheckoutsCommand(),
                n => $"Sent {n} checkout reminders", stoppingToken);
        }
    }

    private async Task RunAsync(
        string name, IRequest<Result<int>> command, Func<int, string> describe, CancellationToken ct)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var result = await scope.ServiceProvider.GetRequiredService<ISender>().Send(command, ct);
            sw.Stop();
            if (result.IsSuccess)
            {
                _heartbeatTracker?.RecordHeartbeat(name, sw.ElapsedMilliseconds, "Healthy", describe(result.Value));
                if (result.Value > 0)
                    _logger.LogInformation("{Sweep}: {Detail}.", name, describe(result.Value));
            }
            else
            {
                _heartbeatTracker?.RecordHeartbeat(name, sw.ElapsedMilliseconds, "Degraded", result.Error.Message);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Shutting down; the loop exits on its next check.
        }
        catch (Exception ex)
        {
            _heartbeatTracker?.RecordHeartbeat(name, sw.ElapsedMilliseconds, "Failed", ex.Message);
            _logger.LogError(ex, "{Sweep} sweep failed.", name);
        }
    }
}
