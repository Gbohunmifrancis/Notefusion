using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Preview.Commands;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Infrastructure.Persistence;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Transcriptions.Workers;

/// <summary>
/// Sweeps transcription jobs that have not reached a terminal state and hands each to
/// <see cref="NotifyTranscriptionReadyCommand"/>, which asks the ML service where it got to and owns
/// the caching, trial-charging and push; does the same for open website previews
/// (<see cref="SettlePreviewJobCommand"/>); then sends the failed-transcription tips email
/// (<see cref="EmailFailedTranscriptionTipsCommand"/>).
/// </summary>
/// <remarks>
/// <para>
/// This is the whole of "process it in the background": until it existed, the client's poll was the
/// only thing watching, and that poll is torn down when the record screen unmounts — so leaving the
/// screen abandoned the transcription with no result and no message.
/// </para>
/// <para>
/// Like the billing workers, this assumes a single API instance. Two instances would occasionally
/// notify twice for one job; nothing would be charged twice, because the entity's markers are
/// idempotent, and a second banner is not worth a distributed lock at this size.
/// </para>
/// </remarks>
internal sealed class TranscriptionCompletionWorker : BackgroundService
{
    /// <summary>
    /// Small: each id costs one call to the ML service, and open jobs are inherently few — a job lives
    /// for the length of one transcription. A large batch would only ever mean something is wrong.
    /// </summary>
    private const int BatchSize = 25;

    /// <summary>
    /// Now acts purely as a dead-letter fallback if a webhook fails to deliver.
    /// Polling is expensive, so it only runs every 5 minutes.
    /// </summary>
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);

    /// <summary>
    /// How long a job whose follow-up failed is left out of the sweep. Oldest-first with a fixed batch means
    /// a job that fails every time would otherwise hold its slot forever, and a batch of them would starve
    /// every job behind. Such a job is still closed at the command's age cutoff once it is retried.
    /// </summary>
    internal static readonly TimeSpan FailedBackoff = TimeSpan.FromMinutes(30);

    /// <summary>Jobs left out of the sweep until the time given. In memory: a restart simply retries them.</summary>
    private readonly Dictionary<Guid, DateTime> _backoff = [];

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<TranscriptionCompletionWorker> _logger;

    public TranscriptionCompletionWorker(
        IServiceScopeFactory scopeFactory, ILogger<TranscriptionCompletionWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
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
                _logger.LogError(ex, "Transcription completion sweep failed.");
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

    internal async Task SweepAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var sender = scope.ServiceProvider.GetRequiredService<ISender>();

        var now = DateTime.UtcNow;
        foreach (var expired in _backoff.Where(kv => kv.Value <= now).Select(kv => kv.Key).ToList())
            _backoff.Remove(expired);
        var skipped = _backoff.Keys.ToList();

        // No age filter here on purpose: a job too old to finish still has to be closed, or it stays in
        // this result set forever. The command applies the cutoff and stamps those rows shut. Oldest
        // first so nothing can be starved by a steady stream of new work.
        var open = await db.TranscriptionJobs
            .Where(j => j.SettledAtUtc == null && !skipped.Contains(j.Id))
            .OrderBy(j => j.CreatedAtUtc)
            .Take(BatchSize)
            .Select(j => j.Id)
            .ToListAsync(ct);

        foreach (var id in open)
            await FollowUpAsync(db, id, () => sender.Send(new NotifyTranscriptionReadyCommand(id), ct), now, ct);

        // Website previews, the same way: until the sweep looked at them only the visitor's own poll ever
        // finished one, so a closed tab left a preview "still running" for good.
        var previews = await db.PreviewJobs
            .Where(p => p.CompletedAtUtc == null && !skipped.Contains(p.Id))
            .OrderBy(p => p.CreatedAtUtc)
            .Take(BatchSize)
            .Select(p => p.Id)
            .ToListAsync(ct);

        foreach (var id in previews)
            await FollowUpAsync(db, id, () => sender.Send(new SettlePreviewJobCommand(id), ct), now, ct);

        // Then a word to anyone whose transcription failed, once the jobs above are closed.
        try
        {
            var emailed = await sender.Send(new EmailFailedTranscriptionTipsCommand(), ct);
            if (emailed.IsSuccess && emailed.Value > 0)
                _logger.LogInformation("Emailed {Count} account(s) tips after a failed transcription.", emailed.Value);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed-transcription emails threw.");
        }
        finally
        {
            db.ChangeTracker.Clear();
        }
    }

    /// <summary>
    /// One job on its own: one that throws is logged, its staged changes are dropped so the next job's save
    /// cannot commit them, and it sits out a few sweeps so it cannot block the batch.
    /// </summary>
    private async Task FollowUpAsync(
        ApplicationDbContext db, Guid id, Func<Task<Result>> send, DateTime now, CancellationToken ct)
    {
        try
        {
            var result = await send();
            if (result.IsFailure)
            {
                _backoff[id] = now + FailedBackoff;
                _logger.LogWarning("Transcription follow-up for {Id} failed: {Error}", id, result.Error.Message);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _backoff[id] = now + FailedBackoff;
            _logger.LogError(ex, "Transcription follow-up for {Id} threw; skipping it for a while.", id);
        }
        finally
        {
            db.ChangeTracker.Clear();
        }
    }
}
