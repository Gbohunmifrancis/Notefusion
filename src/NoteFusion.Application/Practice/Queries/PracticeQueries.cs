using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Flags;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Modes;
using NoteFusion.Core.Entities;
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
            facts.Count(f => PracticeRules.UsesDrillAllowance(f.Kind) && f.LocalDate == today),
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
    private readonly PracticeModeSettings _modes;

    /// <param name="modes">The server's mode switches (registered; every mode on when none is given).</param>
    public GetPracticeProgressQueryHandler(
        IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, IClientTimeZone timeZone, PracticeModeSettings? modes = null)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _timeZone = timeZone;
        _modes = modes ?? new PracticeModeSettings();
    }

    public async Task<Result<PracticeProgressDto>> Handle(GetPracticeProgressQuery request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        return await ReadAsync(_db, _clock, _timeZone, _currentUser, userId, _modes, cancellationToken);
    }

    /// <summary>
    /// The account's progress as of the client's today, with the practice modes live for its track; also PUT
    /// /api/practice/track's answer. While the Christmas season is on for the caller, it carries the carols path and
    /// lists the season's badge.
    /// </summary>
    internal static async Task<PracticeProgressDto> ReadAsync(
        IApplicationDbContext db, IDateTimeProvider clock, IClientTimeZone timeZone, ICurrentUser caller, Guid userId,
        PracticeModeSettings modes, CancellationToken ct)
    {
        var zone = PracticeTime.Resolve(timeZone.Current);
        var today = PracticeTime.LocalDate(clock.UtcNow, zone);
        var facts = await PracticeRecorder.FactsAsync(db, userId, ct);
        var earned = await db.Achievements
            .AsNoTracking()
            .Where(a => a.UserId == userId)
            .ToDictionaryAsync(a => a.Code, a => a.AwardedAtUtc, ct);
        var drills = new DrillAllowanceDto(
            facts.Count(f => PracticeRules.UsesDrillAllowance(f.Kind) && f.LocalDate == today),
            PracticeRules.DrillGradesPerDay(await ProStatus.IsProAsync(db, clock, userId, ct)),
            PracticeTime.NextMidnightUtc(today, zone));
        var track = await GetNextDrillQueryHandler.PracticeTrackOf(db, userId, ct);
        var reading = await PracticePathReader.ReadAsync(db, userId, facts, ct);
        var stop = PracticePath.Next(userId, track, reading, PracticeMath.LevelFor(PracticeMath.TotalXp(facts)).Index);
        var christmas = await FeatureFlags.StateForCallerAsync(db, clock.UtcNow, caller, FeatureFlag.Christmas, ct);

        return PracticeMath.Progress(facts, earned, today, drills, track, christmas.On) with
        {
            Path = PracticePathReader.Describe(stop, reading),
            Modes = PracticeModes.Live(track, modes),
            Season = christmas.On
                ? PracticePathReader.DescribeSeason(PracticePathReader.CarolStandings(facts), track, christmas.LastDay)
                : null,
        };
    }
}

/// <summary>
/// GET /api/practice/carols: the Christmas carols path with every drill ready to hear and sing, on the caller's track,
/// while the season is on for them (<see cref="PracticeErrors.SeasonOff"/> otherwise).
/// </summary>
public sealed record GetCarolsQuery : IRequest<Result<CarolsPathDto>>;

public sealed class GetCarolsQueryHandler : IRequestHandler<GetCarolsQuery, Result<CarolsPathDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IClientTimeZone _timeZone;

    public GetCarolsQueryHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, IClientTimeZone timeZone)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _timeZone = timeZone;
    }

    public async Task<Result<CarolsPathDto>> Handle(GetCarolsQuery request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        var christmas = await FeatureFlags.StateForCallerAsync(_db, _clock.UtcNow, _currentUser, FeatureFlag.Christmas, cancellationToken);
        if (!christmas.On)
            return PracticeErrors.SeasonOff;

        var zone = PracticeTime.Resolve(_timeZone.Current);
        var today = PracticeTime.LocalDate(_clock.UtcNow, zone);
        var facts = await PracticeRecorder.FactsAsync(_db, userId, cancellationToken);
        var track = await GetNextDrillQueryHandler.PracticeTrackOf(_db, userId, cancellationToken);
        var level = PracticeMath.LevelFor(PracticeMath.TotalXp(facts));
        var allowance = new DrillAllowanceDto(
            facts.Count(f => PracticeRules.UsesDrillAllowance(f.Kind) && f.LocalDate == today),
            PracticeRules.DrillGradesPerDay(await ProStatus.IsProAsync(_db, _clock, userId, cancellationToken)),
            PracticeTime.NextMidnightUtc(today, zone));

        var standings = PracticePathReader.CarolStandings(facts);
        var drills = standings
            .Select(standing =>
            {
                var carol = CarolPath.For(standing.Definition, track);
                var d = carol.Drill;
                var drill = new DrillDto(
                    d.Id, d.Pattern.Title, level.Index, level.Name, d.KeyName, d.Key.DohHeader(), d.TempoBpm,
                    standing.Definition.TimeSignature, DrillCatalogue.LegacyLeadInBeats, d.MaxTakeSeconds, d.Notes, today,
                    allowance, track, CarolPath.Title, standing.Definition.Carol, standing.Definition.Index, CarolPath.Count,
                    1, 1, 1, DrillAdjustment.Steady);
                return new CarolDrillDto(
                    PracticePathReader.DescribeStep(standing, carol), drill, standing.Definition.PickupBeats,
                    carol.Backing, carol.Syllables, carol.Syllables is null ? null : standing.Definition.Words);
            })
            .ToList();

        return new CarolsPathDto(PracticePathReader.DescribeSeason(standings, track, christmas.LastDay), drills);
    }
}
