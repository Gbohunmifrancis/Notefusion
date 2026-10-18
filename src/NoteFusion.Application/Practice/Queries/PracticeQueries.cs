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
/// The next drill on the caller's practice path (<see cref="PracticePath"/>): the same until a take of it is marked,
/// then the one the path moves to — the next, the same again, an easier variant, or a skip ahead.
/// </summary>
public sealed record GetNextDrillQuery : IRequest<Result<DrillDto>>;

/// <summary>
/// GET /api/practice/drills/today, kept for shipped apps that ask for "today's drill": the same answer as
/// <see cref="GetNextDrillQuery"/>, so they too move on along the path after each marked take.
/// </summary>
public sealed record GetTodayDrillQuery : IRequest<Result<DrillDto>>;

/// <summary>The caller's XP, level, streak, weekly goal, badges, last seven days and place on the path.</summary>
public sealed record GetPracticeProgressQuery : IRequest<Result<PracticeProgressDto>>;

public sealed class GetNextDrillQueryHandler : IRequestHandler<GetNextDrillQuery, Result<DrillDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IClientTimeZone _timeZone;

    public GetNextDrillQueryHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, IClientTimeZone timeZone)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _timeZone = timeZone;
    }

    public async Task<Result<DrillDto>> Handle(GetNextDrillQuery request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        return await NextAsync(_db, _clock, _timeZone, userId, cancellationToken);
    }

    /// <summary>The account's next drill on its track's path, with the day's allowance.</summary>
    internal static async Task<DrillDto> NextAsync(
        IApplicationDbContext db, IDateTimeProvider clock, IClientTimeZone timeZone, Guid userId, CancellationToken ct)
    {
        var zone = PracticeTime.Resolve(timeZone.Current);
        var today = PracticeTime.LocalDate(clock.UtcNow, zone);
        var facts = await PracticeRecorder.FactsAsync(db, userId, ct);
        var track = await PracticeTrackOf(db, userId, ct);
        var reading = await PracticePathReader.ReadAsync(db, userId, facts, ct);
        var level = PracticeMath.LevelFor(PracticeMath.TotalXp(facts));
        var stop = PracticePath.Next(userId, track, reading, level.Index);
        var drill = stop.Drill;
        var allowance = new DrillAllowanceDto(
            facts.Count(f => f.Kind == PracticeKind.Drill && f.LocalDate == today),
            PracticeRules.DrillGradesPerDay(await ProStatus.IsProAsync(db, clock, userId, ct)),
            PracticeTime.NextMidnightUtc(today, zone));

        return new DrillDto(
            drill.Id,
            drill.Pattern.Title,
            level.Index,
            level.Name,
            drill.KeyName,
            drill.Key.DohHeader(),
            drill.TempoBpm,
            DrillCatalogue.TimeSignature,
            DrillCatalogue.LegacyLeadInBeats,
            drill.MaxTakeSeconds,
            drill.Notes,
            today,
            allowance,
            track,
            stop.Unit.Grade.Label,
            PracticePathReader.UnitTitle(stop),
            stop.Unit.UnitNumber,
            stop.Unit.UnitsInGrade,
            stop.Place.Slot + 1,
            stop.Unit.DrillCount,
            drill.Pattern.Step,
            stop.Adjustment);
    }

    /// <summary>The account's practice track, null until chosen.</summary>
    internal static Task<PracticeTrack?> PracticeTrackOf(IApplicationDbContext db, Guid userId, CancellationToken ct)
        => db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.PracticeTrack).FirstOrDefaultAsync(ct);
}

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
        return await GetNextDrillQueryHandler.NextAsync(_db, _clock, _timeZone, userId, cancellationToken);
    }
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
        var zone = PracticeTime.Resolve(timeZone.Current);
        var today = PracticeTime.LocalDate(clock.UtcNow, zone);
        var facts = await PracticeRecorder.FactsAsync(db, userId, ct);
        var earned = await db.Achievements
            .AsNoTracking()
            .Where(a => a.UserId == userId)
            .ToDictionaryAsync(a => a.Code, a => a.AwardedAtUtc, ct);
        var drills = new DrillAllowanceDto(
            facts.Count(f => f.Kind == PracticeKind.Drill && f.LocalDate == today),
            PracticeRules.DrillGradesPerDay(await ProStatus.IsProAsync(db, clock, userId, ct)),
            PracticeTime.NextMidnightUtc(today, zone));
        var track = await GetNextDrillQueryHandler.PracticeTrackOf(db, userId, ct);
        var reading = await PracticePathReader.ReadAsync(db, userId, facts, ct);
        var stop = PracticePath.Next(userId, track, reading, PracticeMath.LevelFor(PracticeMath.TotalXp(facts)).Index);

        return PracticeMath.Progress(facts, earned, today, drills, track) with { Path = PracticePathReader.Describe(stop, reading) };
    }
}
