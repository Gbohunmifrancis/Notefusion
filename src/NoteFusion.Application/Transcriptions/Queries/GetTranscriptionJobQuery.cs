using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Queries;

/// <summary>Polls the ML service for a job's status/result (GET /v1/jobs/{jobId}).</summary>
public sealed record GetTranscriptionJobQuery(string JobId) : IRequest<Result<TranscriptionJobDto>>;

/// <summary>
/// Also where a free account's trial is spent. This is the only place the API learns that a
/// transcription actually succeeded — the submit call always answers <c>Pending</c>, and the status
/// itself comes from the ML service rather than the client — so charging here means the count cannot
/// be inflated by a failed job or dodged by a client that simply stops asking.
/// </summary>
public sealed class GetTranscriptionJobQueryHandler : IRequestHandler<GetTranscriptionJobQuery, Result<TranscriptionJobDto>>
{
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public GetTranscriptionJobQueryHandler(
        ITranscriptionApi api,
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IDateTimeProvider clock)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result<TranscriptionJobDto>> Handle(
        GetTranscriptionJobQuery request, CancellationToken cancellationToken)
    {
        var job = await _db.TranscriptionJobs
            .FirstOrDefaultAsync(j => j.JobId == request.JobId, cancellationToken);

        // NotFound rather than Forbidden: confirming a stranger's job id exists is itself a leak.
        // Until this row existed, any signed-in caller could poll any job id and read the result.
        if (job is not null && _currentUser.UserId is { } caller && job.UserId != caller)
        {
            return TranscriptionErrors.JobNotFound;
        }

        var result = await _api.GetJobAsync(request.JobId, cancellationToken);
        if (result.IsFailure)
        {
            return result;
        }

        // A job with no row was submitted before this table existed, or anonymously. Let it through
        // uncharged — breaking an in-flight transcription across a deploy is the worse trade.
        if (job is null || result.Value.Status != TranscriptionStatus.Done)
        {
            return result;
        }

        // Pro at the moment of success, so nothing to charge. Asked here rather than recorded at submit
        // time: a job row is written for Pro submissions too, and stamping the verdict on it up front
        // would mean a subscription that lapses months later finds its past Pro work already counted
        // against the five. The cost of asking late is that a job outliving the subscription that paid
        // for it does spend a trial — one credit, in the minutes a transcription takes, so not worth a
        // column to avoid.
        if (await IsProAsync(job.UserId, cancellationToken))
        {
            return result;
        }

        if (job.ConsumeTrial(_clock.UtcNow))
        {
            await _db.SaveChangesAsync(cancellationToken);
        }

        return result;
    }

    private async Task<bool> IsProAsync(Guid userId, CancellationToken ct)
    {
        var sub = await _db.Subscriptions
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);

        return sub is not null && sub.IsActiveAt(_clock.UtcNow);
    }
}
