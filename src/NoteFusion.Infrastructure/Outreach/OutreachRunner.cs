using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Outreach;
using NoteFusion.Infrastructure.Persistence;

namespace NoteFusion.Infrastructure.Outreach;

/// <summary>
/// One outreach run: nothing unless outreach is configured; then, to accounts in their own sending hours (09:00–19:00),
/// the failed sends due their one retry, then the accounts due a message, at most
/// <see cref="OutreachSettings.BatchSize"/> in all, so the backlog after the first deploy trickles out.
/// Each account is isolated: one that throws is logged, its half-staged changes dropped, and the run goes on.
/// </summary>
public sealed class OutreachRunner
{
    private readonly ApplicationDbContext _db;
    private readonly OutreachService _outreach;
    private readonly OutreachSettings _settings;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<OutreachRunner> _logger;

    public OutreachRunner(
        ApplicationDbContext db,
        OutreachService outreach,
        OutreachSettings settings,
        IDateTimeProvider clock,
        ILogger<OutreachRunner> logger)
    {
        _db = db;
        _outreach = outreach;
        _settings = settings;
        _clock = clock;
        _logger = logger;
    }

    /// <returns>How many accounts were written to (retries included).</returns>
    public async Task<int> RunAsync(CancellationToken ct)
    {
        // Each account's own sending hours are applied where it is chosen (FindDueAsync, FindRetriesAsync).
        if (!_settings.IsActive)
            return 0;

        var budget = Math.Max(1, _settings.BatchSize);
        var sent = 0;

        foreach (var id in await _outreach.FindRetriesAsync(budget, ct))
        {
            if (StopForOutage())
                return sent;
            if (await IsolatedAsync(() => _outreach.RetryAsync(id, ct), "retry", id, ct))
                sent++;
        }

        var left = budget - sent;
        if (left <= 0)
            return sent;

        foreach (var candidate in await _outreach.FindDueAsync(left, ct))
        {
            if (StopForOutage())
                return sent;
            if (await IsolatedAsync(() => _outreach.SendAsync(candidate, ct), candidate.Segment.ToString(), candidate.UserId, ct))
                sent++;
        }

        return sent;
    }

    /// <summary>
    /// Email or push is refusing calls (its breaker is open): the rest of the run would be claimed and not
    /// sent, so it waits for the next run. Asked before every account, so one that opens mid-run stops it too.
    /// </summary>
    private bool StopForOutage()
    {
        if (!_outreach.ProvidersUnavailable)
            return false;
        _logger.LogWarning("Outreach paused for this run: the email or push provider is unavailable.");
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
            _logger.LogError(ex, "Outreach {What} for {Id} failed; going on with the rest.", what, id);
            _db.ChangeTracker.Clear();
            return false;
        }
    }
}
