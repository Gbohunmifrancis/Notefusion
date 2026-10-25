using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Admin.ConsoleAlerts;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Push.Workers;

/// <summary>
/// Every minute, asks <see cref="SendAdminConsoleAlertsCommand"/> whether anything needs an admin's look (failed payment
/// attempts, a wave of new accounts, one inbox making several, a flood of transcriptions) and keeps, in memory, when each
/// alert last rang so it rings at most once per cooldown. The window and the memory start when the API does (one
/// instance), as the activity alerts' do. <c>AdminConsoleAlerts__Enabled=false</c> turns it off.
/// </summary>
internal sealed class AdminConsoleAlertWorker : BackgroundService
{
    internal static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);
    internal static readonly TimeSpan Lag = TimeSpan.FromSeconds(5);
    internal static readonly TimeSpan MaxBacklog = TimeSpan.FromHours(1);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<AdminConsoleAlertWorker> _logger;
    private readonly IWorkerHeartbeatTracker? _heartbeats;
    private readonly Dictionary<string, DateTime> _lastAlerted = new(StringComparer.Ordinal);
    private DateTime _after;

    public AdminConsoleAlertWorker(
        IServiceScopeFactory scopeFactory, IDateTimeProvider clock, ILogger<AdminConsoleAlertWorker> logger,
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
                _heartbeats?.RecordHeartbeat("AdminConsoleAlerts", sw.ElapsedMilliseconds, "Healthy",
                    run.Alerted.Count == 0 ? "Nothing needs a look" : $"{run.Alerted.Count} alert(s): {string.Join(", ", run.Alerted)}");
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                sw.Stop();
                _heartbeats?.RecordHeartbeat("AdminConsoleAlerts", sw.ElapsedMilliseconds, "Failed", ex.Message);
                _logger.LogError(ex, "Admin console alert run failed.");
            }
        }
    }

    internal async Task<AdminConsoleAlertRun?> RunOnceAsync(CancellationToken ct)
    {
        var until = _clock.UtcNow - Lag;
        if (_after < until - MaxBacklog)
            _after = until - MaxBacklog;
        if (until <= _after)
            return null;

        using var scope = _scopeFactory.CreateScope();
        var result = await scope.ServiceProvider.GetRequiredService<ISender>()
            .Send(new SendAdminConsoleAlertsCommand(_after, until, _lastAlerted), ct);
        if (result.IsFailure)
        {
            _logger.LogWarning("Admin console alert run refused: {Error}", result.Error.Message);
            return null;
        }

        _after = until;
        foreach (var key in result.Value.Alerted)
            _lastAlerted[key] = until;
        // The memory only needs a day: older keys are past any cooldown.
        foreach (var stale in _lastAlerted.Where(k => until - k.Value > TimeSpan.FromDays(1)).Select(k => k.Key).ToList())
            _lastAlerted.Remove(stale);
        return result.Value;
    }
}
