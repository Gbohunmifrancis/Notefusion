using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Practice.Queries;

/// <summary>
/// Today's drill for the caller: the same all day, at the level they started the day on, from their track's slice of
/// the catalogue (<see cref="DrillCatalogue.PatternsFor"/>). Switching track mid-day shows that track's drill of the day.
/// </summary>
public sealed record GetTodayDrillQuery : IRequest<Result<DrillDto>>;

/// <summary>The caller's XP, level, streak, weekly goal, badges and last seven days.</summary>
public sealed record GetPracticeProgressQuery : IRequest<Result<PracticeProgressDto>>;

public sealed class GetTodayDrillQueryHandler : IRequestHandler<GetTodayDrillQuery, Result<DrillDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IClientTimeZone _timeZone;

    public GetTodayDrillQueryHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, IClientTimeZone timeZone)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _timeZone = timeZone;
    }

    public async Task<Result<DrillDto>> Handle(GetTodayDrillQuery request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var today = PracticeTime.LocalDate(_clock.UtcNow, PracticeTime.Resolve(_timeZone.Current));
        var facts = await PracticeRecorder.FactsAsync(_db, userId, cancellationToken);
        var track = await PracticeTrackOf(_db, userId, cancellationToken);

        // The level the day started on, so levelling up mid-evening does not swap the drill under the singer.
        var level = PracticeMath.LevelFor(PracticeMath.TotalXp(facts.Where(f => f.LocalDate < today)));
        var drill = DrillCatalogue.ForDay(userId, today, level.Index, track);
        var allowance = new DrillAllowanceDto(
            facts.Count(f => f.Kind == PracticeKind.Drill && f.LocalDate == today),
            PracticeRules.DrillGradesPerDay(await ProStatus.IsProAsync(_db, _clock, userId, cancellationToken)));

        return new DrillDto(
            drill.Id,
            drill.Pattern.Title,
            level.Index,
            level.Name,
            drill.KeyName,
            drill.Key.DohHeader(),
            drill.TempoBpm,
            DrillCatalogue.TimeSignature,
            DrillCatalogue.LeadInBeats,
            drill.MaxTakeSeconds,
            drill.Notes,
            today,
            allowance,
            track);
    }

    /// <summary>The account's practice track, null until chosen.</summary>
    internal static Task<PracticeTrack?> PracticeTrackOf(IApplicationDbContext db, Guid userId, CancellationToken ct)
        => db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.PracticeTrack).FirstOrDefaultAsync(ct);
}

public sealed class GetPracticeProgressQueryHandler : IRequestHandler<GetPracticeProgressQuery, Result<PracticeProgressDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IClientTimeZone _timeZone;

    public GetPracticeProgressQueryHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, IClientTimeZone timeZone)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _timeZone = timeZone;
    }

    public async Task<Result<PracticeProgressDto>> Handle(GetPracticeProgressQuery request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        return await ReadAsync(_db, _clock, _timeZone, userId, cancellationToken);
    }

    /// <summary>The account's progress as of the client's today; also PUT /api/practice/track's answer.</summary>
    internal static async Task<PracticeProgressDto> ReadAsync(
        IApplicationDbContext db, IDateTimeProvider clock, IClientTimeZone timeZone, Guid userId, CancellationToken ct)
    {
        var today = PracticeTime.LocalDate(clock.UtcNow, PracticeTime.Resolve(timeZone.Current));
        var facts = await PracticeRecorder.FactsAsync(db, userId, ct);
        var earned = await db.Achievements
            .AsNoTracking()
            .Where(a => a.UserId == userId)
            .ToDictionaryAsync(a => a.Code, a => a.AwardedAtUtc, ct);
        var drills = new DrillAllowanceDto(
            facts.Count(f => f.Kind == PracticeKind.Drill && f.LocalDate == today),
            PracticeRules.DrillGradesPerDay(await ProStatus.IsProAsync(db, clock, userId, ct)));
        var track = await GetTodayDrillQueryHandler.PracticeTrackOf(db, userId, ct);

        return PracticeMath.Progress(facts, earned, today, drills, track);
    }
}
