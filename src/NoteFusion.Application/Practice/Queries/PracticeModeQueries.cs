using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Modes;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Practice.Queries;

/// <summary>GET /api/practice/warm-up: the guided routine (never marked).</summary>
public sealed record GetWarmUpQuery : IRequest<Result<WarmUpDto>>;

/// <summary>GET /api/practice/modes/{mode}: a mode's exercises on the caller's track, placed for them today.</summary>
public sealed record GetPracticeModeQuery(string? Mode) : IRequest<Result<PracticeModeDto>>;

/// <summary>GET /api/practice/range: the caller's range as last measured (each end null until measured).</summary>
public sealed record GetVoiceRangeQuery : IRequest<Result<VoiceRangeDto>>;

public sealed class GetWarmUpQueryHandler : IRequestHandler<GetWarmUpQuery, Result<WarmUpDto>>
{
    private readonly PracticeModeSettings _modes;

    public GetWarmUpQueryHandler(PracticeModeSettings modes) => _modes = modes;

    public Task<Result<WarmUpDto>> Handle(GetWarmUpQuery request, CancellationToken cancellationToken)
        => Task.FromResult(_modes.WarmUp ? Result.Success(WarmUpRoutine.Build()) : Result.Failure<WarmUpDto>(PracticeErrors.ModeOff));
}

public sealed class GetPracticeModeQueryHandler : IRequestHandler<GetPracticeModeQuery, Result<PracticeModeDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IClientTimeZone _timeZone;
    private readonly PracticeModeSettings _modes;

    public GetPracticeModeQueryHandler(
        IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, IClientTimeZone timeZone, PracticeModeSettings modes)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _timeZone = timeZone;
        _modes = modes;
    }

    public async Task<Result<PracticeModeDto>> Handle(GetPracticeModeQuery request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        var mode = request.Mode?.Trim().ToLowerInvariant() ?? string.Empty;
        if (PracticeModes.KindOf(mode) is not { } kind)
            return PracticeErrors.ModeUnknown;
        if (!_modes.IsOn(mode))
            return PracticeErrors.ModeOff;

        var zone = PracticeTime.Resolve(_timeZone.Current);
        var today = PracticeTime.LocalDate(_clock.UtcNow, zone);
        var track = await GetNextDrillQueryHandler.PracticeTrackOf(_db, userId, cancellationToken);
        var best = await BestScoresAsync(_db, userId, kind, cancellationToken);
        var exercises = ModeCatalogue.ForTrack(mode, track, userId, today).Select(e => ToDto(e, best)).ToList();
        return new PracticeModeDto(mode, today, track, await AllowanceAsync(_db, _clock, userId, today, zone, cancellationToken), exercises);
    }

    /// <summary>
    /// The day's marked-drill allowance as a mode's take spends it: every take but parts counted against the
    /// account's daily limit (10 free, 20 Pro), resetting at the singer's midnight.
    /// </summary>
    internal static async Task<DrillAllowanceDto> AllowanceAsync(
        IApplicationDbContext db, IDateTimeProvider clock, Guid userId, DateOnly today, TimeZoneInfo zone, CancellationToken ct)
        => new(
            await db.PracticeSessions.CountAsync(
                s => s.UserId == userId && PracticeRules.DrillAllowanceKinds.Contains(s.Kind) && s.LocalDate == today, ct),
            PracticeRules.DrillGradesPerDay(await ProStatus.IsProAsync(db, clock, userId, ct)),
            PracticeTime.NextMidnightUtc(today, zone));

    /// <summary>The account's best mark at each exercise code of a kind (and, for runs, each speed), read off its rows.</summary>
    internal static async Task<Dictionary<(string Code, int? Speed), int>> BestScoresAsync(
        IApplicationDbContext db, Guid userId, PracticeKind kind, CancellationToken ct)
    {
        var rows = await db.PracticeSessions
            .AsNoTracking()
            .Where(s => s.UserId == userId && s.Kind == kind && s.DrillId != null)
            .Select(s => new { s.DrillId, s.Score })
            .ToListAsync(ct);
        return rows
            .Select(r => (Id: ModeCatalogue.CodeOf(r.DrillId), r.Score))
            .Where(r => r.Id is not null)
            .GroupBy(r => (r.Id!.Value.Code, r.Id.Value.Speed))
            .ToDictionary(g => g.Key, g => g.Max(r => r.Score));
    }

    /// <summary>An exercise as the clients draw it, with the caller's best marks (a run's at every speed).</summary>
    internal static PracticeExerciseDto ToDto(PracticeExercise e, IReadOnlyDictionary<(string Code, int? Speed), int> best)
    {
        int? Best(PracticeExercise x) => best.TryGetValue((x.Code, x.SpeedPercent), out var score) ? score : null;
        var speeds = e.Mode == PracticeModes.Runs
            ? ModeCatalogue.AtEverySpeed(e)
                .Select(s => new RunSpeedDto(s.SpeedPercent!.Value, s.Id, s.TempoBpm, Math.Round(s.ShortestNoteSeconds, 3), s.GraderName, Best(s)))
                .ToList()
            : null;
        return new PracticeExerciseDto(
            e.Id, e.Mode, e.Code, e.Title, e.Prompt, e.Group, e.KeyName, e.Key?.DohHeader(), e.TempoBpm, ModeCatalogue.TimeSignature,
            e.Notes, e.Backing, e.Claps, e.MaxTakeSeconds, e.GraderName, Best(e), e.SpeedPercent, speeds);
    }
}

public sealed class GetVoiceRangeQueryHandler : IRequestHandler<GetVoiceRangeQuery, Result<VoiceRangeDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public GetVoiceRangeQueryHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<VoiceRangeDto>> Handle(GetVoiceRangeQuery request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        var range = await _db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.VoiceRangeLowMidi, u.VoiceRangeHighMidi })
            .FirstOrDefaultAsync(cancellationToken);
        return range is null ? UserErrors.NotFound : VoiceRanges.Describe(range.VoiceRangeLowMidi, range.VoiceRangeHighMidi);
    }
}
