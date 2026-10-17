using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Practice.Queries;

/// <summary>Today's drill for the caller: the same all day, at the level they started the day on.</summary>
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

        // The level the day started on, so levelling up mid-evening does not swap the drill under the singer.
        var level = PracticeMath.LevelFor(PracticeMath.TotalXp(facts.Where(f => f.LocalDate < today)));
        var drill = DrillCatalogue.ForDay(userId, today, level.Index);
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
            allowance);
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

        var today = PracticeTime.LocalDate(_clock.UtcNow, PracticeTime.Resolve(_timeZone.Current));
        var facts = await PracticeRecorder.FactsAsync(_db, userId, cancellationToken);
        var earned = await _db.Achievements
            .AsNoTracking()
            .Where(a => a.UserId == userId)
            .ToDictionaryAsync(a => a.Code, a => a.AwardedAtUtc, cancellationToken);
        var drills = new DrillAllowanceDto(
            facts.Count(f => f.Kind == PracticeKind.Drill && f.LocalDate == today),
            PracticeRules.DrillGradesPerDay(await ProStatus.IsProAsync(_db, _clock, userId, cancellationToken)));

        return PracticeMath.Progress(facts, earned, today, drills);
    }
}
