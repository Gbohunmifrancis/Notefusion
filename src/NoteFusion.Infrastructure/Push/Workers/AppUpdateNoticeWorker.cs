using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Devices.Commands;
using NoteFusion.Infrastructure.Persistence;

namespace NoteFusion.Infrastructure.Push.Workers;

/// <summary>
/// Sweeps users with at least one device still running a build older than
/// <see cref="AppReleaseSettings.LatestBuild"/> and hands each to
/// <see cref="NotifyAppUpdateCommand"/>, which does the notifying and owns the once-per-release rule.
/// </summary>
/// <remarks>
/// With <c>LatestBuild</c> at its default of zero the predicate matches nothing, so a deployment that
/// has not been told about a release stays quiet rather than telling everyone to update to the build
/// they are already on.
/// </remarks>
internal sealed class AppUpdateNoticeWorker : BackgroundService
{
    private const int BatchSize = 50;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly AppReleaseSettings _settings;
    private readonly ILogger<AppUpdateNoticeWorker> _logger;

    public AppUpdateNoticeWorker(
        IServiceScopeFactory scopeFactory, AppReleaseSettings settings, ILogger<AppUpdateNoticeWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _settings = settings;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromMinutes(Math.Max(1, _settings.NoticeIntervalMinutes));

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
                _logger.LogError(ex, "App update notice sweep failed.");
            }

            try
            {
                await Task.Delay(interval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task SweepAsync(CancellationToken ct)
    {
        // Cheapest possible no-op for the overwhelmingly common case: no release to announce. Checked
        // before the scope so an idle deployment does not build a DI scope every interval either.
        if (_settings.LatestBuild <= 0)
            return;

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var sender = scope.ServiceProvider.GetRequiredService<ISender>();

        // Distinct users, not devices: the command notifies a user once and marks all of their
        // devices, so a two-device user must appear here once or the second row would send again.
        var due = await db.DeviceTokens
            .Where(t => t.AppBuild < _settings.LatestBuild && t.NotifiedBuild < _settings.LatestBuild)
            .Select(t => t.UserId)
            .Distinct()
            .Take(BatchSize)
            .ToListAsync(ct);

        foreach (var userId in due)
        {
            var result = await sender.Send(new NotifyAppUpdateCommand(userId), ct);
            if (result.IsFailure)
                _logger.LogWarning("Update notice for {UserId} failed: {Error}", userId, result.Error.Message);
        }

        if (due.Count > 0)
            _logger.LogInformation("Sent {Count} app update notice(s).", due.Count);
    }
}
