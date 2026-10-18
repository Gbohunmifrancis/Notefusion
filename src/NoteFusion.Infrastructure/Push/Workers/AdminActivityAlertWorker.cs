using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Admin.ActivityAlerts;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Push.Workers;

/// <summary>
/// Pushes the admins "someone just signed up" and "someone is transcribing" (<see cref="SendAdminActivityAlertsCommand"/>)
/// every half minute, one summary for whatever arrived since the last run. The window starts when the API does and is
/// kept in memory (one instance): a restart skips what happened while it was down rather than announcing it late, and
/// Overview lists it either way. <c>AdminActivityAlerts__Enabled=false</c> turns it off.
/// </summary>
internal sealed class AdminActivityAlertWorker : BackgroundService
{
    internal static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    /// <summary>The window stops this far short of now, so a row whose transaction commits a moment late is not passed.</summary>
    internal static readonly TimeSpan Lag = TimeSpan.FromSeconds(5);

    /// <summary>After a run of failures, older than this is no longer news.</summary>
    internal static readonly TimeSpan MaxBacklog = TimeSpan.FromHours(1);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<AdminActivityAlertWorker> _logger;
    private readonly IWorkerHeartbeatTracker? _heartbeats;
    private DateTime _after;

    public AdminActivityAlertWorker(
        IServiceScopeFactory scopeFactory,
        IDateTimeProvider clock,
        ILogger<AdminActivityAlertWorker> logger,
        IWorkerHeartbeatTracker? heartbeats = null)
    {
        _scopeFactory = scopeFactory;
        _clock = clock;
        _logger = logger;
        _heartbeats = heartbeats;
        _after = clock.UtcNow - Lag;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                var run = await RunOnceAsync(stoppingToken);
                sw.Stop();
                if (run is null)
                    continue;
                _heartbeats?.RecordHeartbeat(
                    "AdminActivityAlerts",
                    sw.ElapsedMilliseconds,
                    run.Error is null ? "Healthy" : "Degraded",
                    run.Signups + run.Transcriptions == 0
                        ? "Nothing new to report"
                        : $"{run.Signups} sign-up(s), {run.Transcriptions} transcription(s) to {run.Devices} admin phone(s)"
                          + (run.Error is null ? "" : $" · {run.Error}"));
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                sw.Stop();
                _heartbeats?.RecordHeartbeat("AdminActivityAlerts", sw.ElapsedMilliseconds, "Failed", ex.Message);
                _logger.LogError(ex, "Admin activity push run failed.");
            }
        }
    }

    /// <summary>One run over the window since the last; null when the window is empty or the run failed.</summary>
    internal async Task<AdminActivityRun?> RunOnceAsync(CancellationToken ct)
    {
        var until = _clock.UtcNow - Lag;
        if (_after < until - MaxBacklog)
            _after = until - MaxBacklog;
        if (until <= _after)
            return null;

        using var scope = _scopeFactory.CreateScope();
        var result = await scope.ServiceProvider.GetRequiredService<ISender>()
            .Send(new SendAdminActivityAlertsCommand(_after, until), ct);
        if (result.IsFailure)
        {
            _logger.LogWarning("Admin activity push run refused: {Error}", result.Error.Message);
            return null;
        }

        _after = until;
        return result.Value;
    }
}
