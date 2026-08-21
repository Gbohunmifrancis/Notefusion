using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Infrastructure.Persistence;

namespace NoteFusion.Infrastructure.Transcriptions.Workers;

/// <summary>
/// Sweeps transcription jobs that have not reached a terminal state and hands each to
/// <see cref="NotifyTranscriptionReadyCommand"/>, which asks the ML service where it got to and owns
/// the caching, trial-charging and push.
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
    /// Short, because this interval is added to how long someone waits for their notification after the
    /// music has actually finished being transcribed.
    /// </summary>
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(10);

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

    private async Task SweepAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var sender = scope.ServiceProvider.GetRequiredService<ISender>();

        // No age filter here on purpose: a job too old to finish still has to be closed, or it stays in
        // this result set forever. The command applies the cutoff and stamps those rows shut. Oldest
        // first so nothing can be starved by a steady stream of new work.
        var open = await db.TranscriptionJobs
            .Where(j => j.SettledAtUtc == null)
            .OrderBy(j => j.CreatedAtUtc)
            .Take(BatchSize)
            .Select(j => j.Id)
            .ToListAsync(ct);

        foreach (var id in open)
        {
            var result = await sender.Send(new NotifyTranscriptionReadyCommand(id), ct);
            if (result.IsFailure)
                _logger.LogWarning("Transcription follow-up for {Id} failed: {Error}", id, result.Error.Message);
        }
    }
}
