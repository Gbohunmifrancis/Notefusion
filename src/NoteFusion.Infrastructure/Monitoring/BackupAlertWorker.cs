using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Admin.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Monitoring;

/// <summary>
/// Every 15 minutes: asks <see cref="NotifyAdminsOfBackupProblemsCommand"/> whether the backups need a
/// person, and once a day drops WAL reports older than <see cref="WalReportRetention"/> (the backup
/// container may only insert into backup_runs, so the API does the tidying).
/// </summary>
/// <remarks>
/// The alert's memory is this field, as with the payment alert: a redeploy re-arms it and can repeat one
/// alert, which is the right way round to be wrong about backups.
/// </remarks>
internal sealed class BackupAlertWorker : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(15);

    /// <summary>A WAL report every 2–10 minutes adds up; a month of them is plenty of history.</summary>
    public static readonly TimeSpan WalReportRetention = TimeSpan.FromDays(30);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IWorkerHeartbeatTracker? _heartbeats;
    private readonly ILogger<BackupAlertWorker> _logger;

    private BackupAlertState? _last;
    private DateTime _lastPruneUtc = DateTime.MinValue;

    public BackupAlertWorker(
        IServiceScopeFactory scopeFactory, ILogger<BackupAlertWorker> logger, IWorkerHeartbeatTracker? heartbeats = null)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _heartbeats = heartbeats;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            // Delay first: a fresh boot has not necessarily migrated yet, and the backup container may
            // still be on its way up after the same deploy.
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
                using var scope = _scopeFactory.CreateScope();
                var sender = scope.ServiceProvider.GetRequiredService<ISender>();
                var result = await sender.Send(new NotifyAdminsOfBackupProblemsCommand(_last), stoppingToken);
                if (result.IsSuccess)
                    _last = result.Value;

                var clock = scope.ServiceProvider.GetRequiredService<IDateTimeProvider>();
                if (clock.UtcNow - _lastPruneUtc > TimeSpan.FromDays(1))
                {
                    var cutoff = clock.UtcNow - WalReportRetention;
                    var db = scope.ServiceProvider.GetRequiredService<IApplicationDbContext>();
                    var removed = await db.BackupRuns
                        .Where(r => r.Kind == BackupRunKind.Wal && r.FinishedAtUtc < cutoff)
                        .ExecuteDeleteAsync(stoppingToken);
                    _lastPruneUtc = clock.UtcNow;
                    if (removed > 0)
                        _logger.LogInformation("Pruned {Count} WAL report(s) older than {Days} days.", removed, WalReportRetention.TotalDays);
                }

                _heartbeats?.RecordHeartbeat(
                    "BackupAlert", sw.ElapsedMilliseconds, result.IsSuccess ? "Healthy" : "Degraded",
                    result.IsSuccess
                        ? (_last is { Keys.Count: > 0 } ? $"{_last.Keys.Count} backup problem(s) open" : "Backups OK or not set up")
                        : result.Error.Message);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _heartbeats?.RecordHeartbeat("BackupAlert", sw.ElapsedMilliseconds, "Failed", ex.Message);
                _logger.LogError(ex, "Backup alert check failed.");
            }
        }
    }
}
