using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Admin.Inbox;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Push.Workers;

/// <summary>
/// Every minute, asks <see cref="WatchAdminInboxCommand"/> for mail that came in since the last look and tells the
/// admins' consoles. Where the inbox stood and the ids already told are kept in memory (one API instance): the first
/// look after a start only notes the place. Off with <c>AdminConsoleAlerts__Enabled=false</c>, as the other console alerts.
/// </summary>
internal sealed class AdminInboxWatchWorker : BackgroundService
{
    internal static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    /// <summary>Ids told and still within the newest page; older ones fall out.</summary>
    private const int RememberIds = 200;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<AdminInboxWatchWorker> _logger;
    private readonly IWorkerHeartbeatTracker? _heartbeats;
    private readonly Queue<Guid> _toldOrder = new();
    private readonly HashSet<Guid> _told = [];
    private DateTime? _seenUpTo;

    public AdminInboxWatchWorker(
        IServiceScopeFactory scopeFactory, ILogger<AdminInboxWatchWorker> logger, IWorkerHeartbeatTracker? heartbeats = null)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _heartbeats = heartbeats;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                var run = await RunOnceAsync(stoppingToken);
                _heartbeats?.RecordHeartbeat("AdminInboxWatch", sw.ElapsedMilliseconds, "Healthy",
                    run.Told.Count == 0 ? "No new mail" : $"{run.Told.Count} new email(s) told");
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // Resend away or the key unset: the Mail page says so itself; here it is a warning, not an error a minute.
                _heartbeats?.RecordHeartbeat("AdminInboxWatch", sw.ElapsedMilliseconds, "Failed", ex.Message);
                _logger.LogWarning(ex, "Could not look at the inbox for new mail.");
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

    internal async Task<WatchAdminInboxRun> RunOnceAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var run = await scope.ServiceProvider.GetRequiredService<ISender>()
            .Send(new WatchAdminInboxCommand(_seenUpTo, _told), ct);
        _seenUpTo = run.SeenUpTo;
        foreach (var id in run.Told)
            if (_told.Add(id))
                _toldOrder.Enqueue(id);
        while (_toldOrder.Count > RememberIds)
            _told.Remove(_toldOrder.Dequeue());
        return run;
    }
}
