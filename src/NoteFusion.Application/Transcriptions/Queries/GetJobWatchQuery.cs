using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Queries;

/// <summary>
/// Whether the caller may watch a job's event stream (<see cref="IJobEvents"/>): their own job, or an anonymous preview
/// by its id as its GET allows. <see cref="JobWatchState.Watcher"/> is what their open streams are counted under.
/// </summary>
public sealed record GetJobWatchQuery(string JobId, bool Preview = false) : IRequest<Result<JobWatchState>>;

/// <summary><paramref name="Ended"/>: the job is settled already, so the stream says so and closes.</summary>
public sealed record JobWatchState(bool Ended, string Watcher);

public sealed class GetJobWatchQueryHandler : IRequestHandler<GetJobWatchQuery, Result<JobWatchState>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IClientIpAddress _ip;

    public GetJobWatchQueryHandler(IApplicationDbContext db, ICurrentUser caller, IClientIpAddress ip)
    {
        _db = db;
        _caller = caller;
        _ip = ip;
    }

    public async Task<Result<JobWatchState>> Handle(GetJobWatchQuery request, CancellationToken ct)
    {
        if (request.Preview)
        {
            var preview = await _db.PreviewJobs
                .Where(p => p.JobId == request.JobId)
                .Select(p => new { p.CompletedAtUtc })
                .FirstOrDefaultAsync(ct);
            return preview is null
                ? TranscriptionErrors.JobNotFound
                : new JobWatchState(preview.CompletedAtUtc is not null, $"ip:{_ip.Current}");
        }

        // NotFound for a job that is not the caller's, as its GET answers: confirming a stranger's job exists is a leak.
        if (_caller.UserId is not { } caller)
            return TranscriptionErrors.JobNotFound;
        var job = await _db.TranscriptionJobs
            .Where(j => j.JobId == request.JobId && j.UserId == caller)
            .Select(j => new { j.SettledAtUtc })
            .FirstOrDefaultAsync(ct);
        return job is null
            ? TranscriptionErrors.JobNotFound
            : new JobWatchState(job.SettledAtUtc is not null, $"user:{caller}");
    }
}
