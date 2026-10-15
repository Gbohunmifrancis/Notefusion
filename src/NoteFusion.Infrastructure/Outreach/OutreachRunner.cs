using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Outreach;
using NoteFusion.Infrastructure.Persistence;

namespace NoteFusion.Infrastructure.Outreach;

/// <summary>
/// One outreach run: nothing unless outreach is configured and it is sending hours (09:00–19:00 WAT); then
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
        if (!_settings.IsActive || !OutreachRules.IsSendingHour(_clock.UtcNow))
            return 0;

        var budget = Math.Max(1, _settings.BatchSize);
        var sent = 0;

        foreach (var id in await _outreach.FindRetriesAsync(budget, ct))
        {
            if (await IsolatedAsync(() => _outreach.RetryAsync(id, ct), "retry", id, ct))
                sent++;
        }

        var left = budget - sent;
        if (left <= 0)
            return sent;

        foreach (var candidate in await _outreach.FindDueAsync(left, ct))
        {
            if (await IsolatedAsync(() => _outreach.SendAsync(candidate, ct), candidate.Segment.ToString(), candidate.UserId, ct))
                sent++;
        }

        return sent;
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
