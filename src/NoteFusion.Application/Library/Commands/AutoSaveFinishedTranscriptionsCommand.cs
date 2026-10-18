using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

/// <summary>
/// The fallback that keeps every finished transcription in its owner's library: a job settled Done is filed at
/// once (<see cref="LibraryFiling"/>), and this sweep files any that path missed (a filing that failed, a job
/// settled before it existed) once the job has been finished for <see cref="Delay"/>.
/// </summary>
/// <remarks>
/// The result is already on the job row (<see cref="TranscriptionJob.ResultJson"/>). A sheet already filed or
/// saved by hand is left as it is, and a Save pressed later replaces the kept copy
/// (<see cref="SaveTranscriptionCommand"/>). Each job is handled once, so a sheet the user deletes afterwards
/// stays deleted.
/// </remarks>
public sealed record AutoSaveFinishedTranscriptionsCommand : IRequest<Result<int>>
{
    /// <summary>How long a finished job is left for its result screen before it is kept.</summary>
    public static readonly TimeSpan Delay = TimeSpan.FromMinutes(30);

    /// <summary>Jobs older than this are left alone: the sweep is for new work, not an archive dig.</summary>
    public static readonly TimeSpan Lookback = TimeSpan.FromDays(14);

    public const int BatchSize = 50;
}

public sealed class AutoSaveFinishedTranscriptionsCommandHandler
    : IRequestHandler<AutoSaveFinishedTranscriptionsCommand, Result<int>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IQuotaGate _gate;

    public AutoSaveFinishedTranscriptionsCommandHandler(IApplicationDbContext db, IDateTimeProvider clock, IQuotaGate gate)
    {
        _db = db;
        _clock = clock;
        _gate = gate;
    }

    public async Task<Result<int>> Handle(AutoSaveFinishedTranscriptionsCommand request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var readyBefore = now - AutoSaveFinishedTranscriptionsCommand.Delay;
        var notBefore = now - AutoSaveFinishedTranscriptionsCommand.Lookback;

        var jobs = await _db.TranscriptionJobs
            .Where(j => j.ResultJson != null
                        && j.AutoSavedAtUtc == null
                        && j.CreatedAtUtc < readyBefore
                        && j.CreatedAtUtc >= notBefore)
            .OrderBy(j => j.CreatedAtUtc)
            .Take(AutoSaveFinishedTranscriptionsCommand.BatchSize)
            .ToListAsync(ct);

        if (jobs.Count == 0)
            return 0;

        var jobIds = jobs.Select(j => j.JobId).ToList();
        var userIds = jobs.Select(j => j.UserId).Distinct().ToList();

        // Every owner's save lock, before reading what they have already saved: a Save for one of these
        // jobs landing between that read and this sweep's insert would otherwise leave two sheets for it.
        // AcquireAllAsync takes them in one fixed order, so this cannot deadlock against anything.
        await using var leases = await _gate.AcquireAllAsync(userIds.Select(QuotaGateExtensions.SaveKey), ct);
        var alreadySaved = await _db.Transcriptions
            .Where(t => t.SourceJobId != null && jobIds.Contains(t.SourceJobId))
            .Select(t => new { t.UserId, t.SourceJobId })
            .ToListAsync(ct);
        var saved = alreadySaved.Select(t => (t.UserId, t.SourceJobId!)).ToHashSet();
        var zones = (await _db.Users.Where(u => userIds.Contains(u.Id)).Select(u => new { u.Id, u.TimeZone }).ToListAsync(ct))
            .ToDictionary(u => u.Id, u => PracticeTime.Resolve(u.TimeZone));
        var liveUsers = zones.Keys.ToHashSet();

        // The cached result is the worker's whole answer, parts and MIDI included. A free owner is kept
        // what the poll hands them (ProGate.ForFree), never more: the four-part harmony is Pro, and a
        // sheet saved behind their back must not be the way round that.
        var proUsers = new HashSet<Guid>();
        foreach (var userId in liveUsers)
        {
            if (await ProStatus.IsProAsync(_db, _clock, userId, ct))
                proUsers.Add(userId);
        }

        var kept = 0;
        foreach (var job in jobs)
        {
            job.MarkAutoSaved(now);

            if (saved.Contains((job.UserId, job.JobId)) || !liveUsers.Contains(job.UserId))
                continue;
            if (TranscriptionResultCache.Deserialize(job.ResultJson!) is not { } result)
                continue;
            if (!proUsers.Contains(job.UserId))
                result = ProGate.ForFree(result);
            if (LibraryFiling.ToSheet(job, result, zones[job.UserId]) is not { } sheet)
                continue;

            _db.Transcriptions.Add(sheet);
            kept++;
        }

        await _db.SaveChangesAsync(ct);
        return kept;
    }
}
