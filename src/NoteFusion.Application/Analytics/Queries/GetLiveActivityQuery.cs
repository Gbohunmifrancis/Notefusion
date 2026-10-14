using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Analytics.Queries;

/// <summary>Someone online now: seen within <see cref="LastSeen.OnlineWindow"/>.</summary>
public sealed record LiveUserDto(Guid Id, string FullName, string Email, string? Country, DateTime SeenAtUtc);

/// <summary>
/// A transcription started in the last few minutes: an account's job, or a free preview on the website
/// (no account, so no name).
/// </summary>
public sealed record LiveJobDto(
    string JobId, Guid? UserId, string? FullName, string? Email, string Kind, bool Preview, bool Finished, DateTime StartedAtUtc);

public sealed record LiveActivityDto(DateTime ServerTimeUtc, IReadOnlyList<LiveUserDto> Online, IReadOnlyList<LiveJobDto> Transcribing);

/// <summary>
/// What is happening right now, for the console's live notices: who is online and which transcriptions
/// have just started. The console polls it and announces what is new since its last look, so this only
/// has to be cheap and current, not a history.
/// </summary>
public sealed record GetLiveActivityQuery : IRequest<Result<LiveActivityDto>>
{
    /// <summary>How far back a started transcription is still news.</summary>
    public static readonly TimeSpan RecentJobs = TimeSpan.FromMinutes(10);
    public const int MaxRows = 50;
}

public sealed class GetLiveActivityQueryHandler : IRequestHandler<GetLiveActivityQuery, Result<LiveActivityDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetLiveActivityQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<LiveActivityDto>> Handle(GetLiveActivityQuery request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var onlineSince = now - LastSeen.OnlineWindow;
        var jobsSince = now - GetLiveActivityQuery.RecentJobs;

        var online = await _db.RealUsers().AsNoTracking()
            .Where(u => u.LastSeenAtUtc != null && u.LastSeenAtUtc >= onlineSince)
            .OrderByDescending(u => u.LastSeenAtUtc)
            .Take(GetLiveActivityQuery.MaxRows)
            .Select(u => new LiveUserDto(u.Id, u.FullName, u.Email, u.Country, u.LastSeenAtUtc!.Value))
            .ToListAsync(ct);

        var jobs = await _db.RealJobs().AsNoTracking()
            .Where(j => j.CreatedAtUtc >= jobsSince)
            .OrderByDescending(j => j.CreatedAtUtc)
            .Take(GetLiveActivityQuery.MaxRows)
            .Select(j => new
            {
                j.JobId, j.UserId, j.Kind, j.CreatedAtUtc, Finished = j.SettledAtUtc != null || j.ResultJson != null,
                User = _db.Users.Where(u => u.Id == j.UserId).Select(u => new { u.FullName, u.Email }).FirstOrDefault()
            })
            .ToListAsync(ct);
        var previews = await _db.RealPreviews().AsNoTracking()
            .Where(p => p.CreatedAtUtc >= jobsSince)
            .OrderByDescending(p => p.CreatedAtUtc)
            .Take(GetLiveActivityQuery.MaxRows)
            .Select(p => new { p.JobId, p.Kind, p.CreatedAtUtc, Finished = p.CompletedAtUtc != null })
            .ToListAsync(ct);

        var transcribing = jobs
            .Select(j => new LiveJobDto(j.JobId, j.UserId, j.User?.FullName, j.User?.Email,
                j.Kind == TranscriptionJobKind.Link ? "song link" : j.Kind == TranscriptionJobKind.Song ? "song upload" : "recording",
                false, j.Finished, j.CreatedAtUtc))
            .Concat(previews.Select(p => new LiveJobDto(p.JobId, null, null, null,
                p.Kind == "link" ? "song link" : "recording", true, p.Finished, p.CreatedAtUtc)))
            .OrderByDescending(j => j.StartedAtUtc)
            .Take(GetLiveActivityQuery.MaxRows)
            .ToList();

        return new LiveActivityDto(now, online, transcribing);
    }
}
