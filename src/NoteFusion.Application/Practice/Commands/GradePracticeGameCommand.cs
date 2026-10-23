using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Games;
using NoteFusion.Application.Practice.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Practice.Commands;

/// <summary>
/// A quick game's answers, marked and recorded (<c>POST /api/practice/games/grade</c>): the deal rebuilt from its id, each
/// answer marked against the server's own round, and — when enough rounds were answered and the day's
/// <see cref="PracticeRules.GamesPerDay"/> games are not used — a <see cref="PracticeSession"/> of kind
/// <see cref="PracticeKind.Game"/> on the singer's day, earning <see cref="PracticeRules.GameXp"/>. A deal is marked once
/// (409 <c>PRACTICE_GAME_MARKED</c>); a game that does not count is marked and recorded nowhere. <c>Seconds</c> is how
/// long it was played, kept on the row.
/// </summary>
public sealed record GradePracticeGameCommand(string? DealId, IReadOnlyList<string?>? Answers, double? Seconds)
    : IRequest<Result<PracticeGameGradeDto>>;

public sealed class GradePracticeGameCommandHandler : IRequestHandler<GradePracticeGameCommand, Result<PracticeGameGradeDto>>
{
    /// <summary>The longest a game's seconds are believed: a race's minute with room, or ten slow rounds.</summary>
    private const double MaxSeconds = 600;

    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IClientTimeZone _timeZone;
    private readonly IQuotaGate _gate;
    private readonly PracticeRecorder _recorder;

    public GradePracticeGameCommandHandler(
        IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, IClientTimeZone timeZone, IQuotaGate gate,
        PracticeRecorder recorder)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _timeZone = timeZone;
        _gate = gate;
        _recorder = recorder;
    }

    public async Task<Result<PracticeGameGradeDto>> Handle(GradePracticeGameCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        if (PracticeGames.Deal(request.DealId) is not { } deal)
            return PracticeErrors.GameDealUnknown;
        if (request.Answers is null || PracticeGames.Mark(deal, request.Answers) is not { } mark)
            return PracticeErrors.GameAnswers;

        var today = PracticeTime.LocalDate(_clock.UtcNow, PracticeTime.Resolve(_timeZone.Current));

        // Counted and recorded under the account's practice lock, as a take is: two sends of one deal cannot both count.
        await using var lease = await _gate.AcquireAsync(PracticeRecorder.GateKey(userId), cancellationToken);

        if (await _db.PracticeSessions.AnyAsync(s => s.UserId == userId && s.Kind == PracticeKind.Game && s.DrillId == deal.DealId, cancellationToken))
            return PracticeErrors.GameMarked;

        string? notCounted = !mark.EnoughAnswered ? "few"
            : await GetPracticeGameQueryHandler.GamesTodayAsync(_db, userId, today, cancellationToken) >= PracticeRules.GamesPerDay ? "daily"
            : null;
        PracticeRewardDto? reward = null;
        if (notCounted is null)
        {
            var seconds = request.Seconds is { } s && double.IsFinite(s) ? Math.Clamp(s, 0, MaxSeconds) : 0;
            var session = PracticeSession.Record(
                userId, PracticeKind.Game, mark.Score, mark.Right, 0, mark.Answered - mark.Right, deal.Rounds.Count - mark.Answered,
                seconds, _clock.UtcNow, today, drillId: deal.DealId);
            reward = await _recorder.RecordAsync(session, cancellationToken);
        }

        return new PracticeGameGradeDto(
            deal.Game, deal.DealId, mark.Score, mark.Right, mark.Answered, deal.Rounds.Count, mark.Marks, reward is not null, notCounted, reward);
    }
}
