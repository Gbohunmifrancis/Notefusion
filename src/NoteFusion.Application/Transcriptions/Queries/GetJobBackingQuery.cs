using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Queries;

/// <summary>
/// A finished job's backing (an MP3 of the song's instrumental), for the job's owner, while it is held: kept with the
/// sheet the job was filed as (an upload's, for as long as the sheet lives), else the worker's copy while it still
/// has the job (a link's, minutes). <see cref="LibraryErrors.BackingNotFound"/> otherwise, and for anyone else's job.
/// </summary>
public sealed record GetJobBackingQuery(string JobId) : IRequest<Result<byte[]>>;

public sealed class GetJobBackingQueryHandler(
    IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, ITranscriptionApi api, IBackingStorage backing)
    : IRequestHandler<GetJobBackingQuery, Result<byte[]>>
{
    public async Task<Result<byte[]>> Handle(GetJobBackingQuery request, CancellationToken ct)
    {
        if (currentUser.UserId is not { } userId)
            return LibraryErrors.BackingNotFound;

        var job = await db.TranscriptionJobs.AsNoTracking()
            .Where(j => j.JobId == request.JobId && j.UserId == userId)
            .Select(j => new { j.SettledAtUtc })
            .FirstOrDefaultAsync(ct);
        if (job is null)
            return LibraryErrors.BackingNotFound;

        var key = await db.Transcriptions.AsNoTracking()
            .Where(t => t.UserId == userId && t.SourceJobId == request.JobId && t.BackingKey != null)
            .Select(t => t.BackingKey)
            .FirstOrDefaultAsync(ct);
        if (key is not null && await backing.ReadAsync(key, ct) is { IsSuccess: true } kept)
            return kept;

        // The worker forgets a finished job within its keep time: past it there is nothing to ask for.
        if (job.SettledAtUtc is { } settledAt && clock.UtcNow - settledAt > GetTranscriptionJobQueryHandler.WorkerKeepsJobsFor)
            return LibraryErrors.BackingNotFound;

        var answer = await api.GetJobAsync(request.JobId, ct);
        if (answer.IsFailure
            || answer.Value is not { Status: TranscriptionStatus.Done, Result.BackingAudioBase64: { Length: > 0 } base64 })
            return LibraryErrors.BackingNotFound;

        try
        {
            return Convert.FromBase64String(base64);
        }
        catch (FormatException)
        {
            return LibraryErrors.BackingNotFound;
        }
    }
}
