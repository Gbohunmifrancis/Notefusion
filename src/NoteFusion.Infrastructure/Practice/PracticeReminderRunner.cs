using Microsoft.Extensions.Logging;
using NoteFusion.Application.Practice.Reminders;
using NoteFusion.Infrastructure.Persistence;

namespace NoteFusion.Infrastructure.Practice;

/// <summary>
/// One practice reminder run: nothing unless the sweep is on; then the failed sends due their one retry, then the
/// accounts due a reminder now, at most <see cref="PracticeReminderSettings.BatchSize"/> in all. Stops for the run
/// when Expo's breaker is open (<see cref="Application.Common.Interfaces.IProviderHealth"/>), asked before every
/// account. Each account is isolated: one that throws is logged, its half-staged changes dropped, and the run goes on.
/// </summary>
public sealed class PracticeReminderRunner
{
    private readonly ApplicationDbContext _db;
    private readonly PracticeReminderService _reminders;
    private readonly PracticeReminderSettings _settings;
    private readonly ILogger<PracticeReminderRunner> _logger;

    public PracticeReminderRunner(
        ApplicationDbContext db,
        PracticeReminderService reminders,
        PracticeReminderSettings settings,
        ILogger<PracticeReminderRunner> logger)
    {
        _db = db;
        _reminders = reminders;
        _settings = settings;
        _logger = logger;
    }

    /// <returns>How many reminders were sent or tried (retries included).</returns>
    public async Task<int> RunAsync(CancellationToken ct)
    {
        if (!_settings.Enabled)
            return 0;

        var budget = Math.Max(1, _settings.BatchSize);
        var sent = 0;

        foreach (var id in await _reminders.FindRetriesAsync(budget, ct))
        {
            if (StopForOutage())
                return sent;
            if (await IsolatedAsync(() => _reminders.RetryAsync(id, ct), "retry", id, ct))
                sent++;
        }

        var left = budget - sent;
        if (left <= 0)
            return sent;

        foreach (var candidate in await _reminders.FindDueAsync(left, ct))
        {
            if (StopForOutage())
                return sent;
            if (await IsolatedAsync(() => _reminders.SendAsync(candidate, ct), candidate.Due.Kind.ToString(), candidate.UserId, ct))
                sent++;
        }

        return sent;
    }

    private bool StopForOutage()
    {
        if (!_reminders.ProviderUnavailable)
            return false;
        _logger.LogWarning("Practice reminders paused for this run: the push provider is unavailable.");
        return true;
    }

    private async Task<bool> IsolatedAsync(Func<Task<bool>> work, string what, Guid id, CancellationToken ct)
    {
        try
        {
            return await work();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Practice reminder {What} for {Id} failed; going on with the rest.", what, id);
            _db.ChangeTracker.Clear();
            return false;
        }
    }
}
