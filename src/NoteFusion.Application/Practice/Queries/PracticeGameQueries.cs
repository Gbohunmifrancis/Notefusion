using System.Security.Cryptography;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Games;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Practice.Queries;

/// <summary>
/// GET /api/practice/games/{game}: a fresh deal of a quick game on the caller's track; with <paramref name="Level"/>, an
/// arcade stage at that level (held to 1–<see cref="PracticeGames.MaxLevel"/>).
/// </summary>
public sealed record GetPracticeGameQuery(string? Game, int? Level = null) : IRequest<Result<PracticeGameDto>>;

public sealed class GetPracticeGameQueryHandler : IRequestHandler<GetPracticeGameQuery, Result<PracticeGameDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IClientTimeZone _timeZone;

    public GetPracticeGameQueryHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, IClientTimeZone timeZone)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _timeZone = timeZone;
    }

    public async Task<Result<PracticeGameDto>> Handle(GetPracticeGameQuery request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        var game = request.Game?.Trim().ToLowerInvariant() ?? string.Empty;
        if (!PracticeGames.Exists(game))
            return PracticeErrors.GameUnknown;

        var today = PracticeTime.LocalDate(_clock.UtcNow, PracticeTime.Resolve(_timeZone.Current));
        var track = await GetNextDrillQueryHandler.PracticeTrackOf(_db, userId, cancellationToken);
        int? level = request.Level is { } asked ? Math.Clamp(asked, 1, PracticeGames.MaxLevel) : null;
        var deal = PracticeGames.Deal(PracticeGames.NewDealId(game, track, BitConverter.ToUInt32(RandomNumberGenerator.GetBytes(4)), level))!;
        return new PracticeGameDto(
            game,
            deal.DealId,
            track,
            deal.IsRace ? PracticeGames.StaffSeconds : null,
            await GamesTodayAsync(_db, userId, today, cancellationToken),
            PracticeRules.GamesPerDay,
            deal.Rounds,
            deal.Level,
            deal.SecondsPerRound);
    }

    /// <summary>Games that earned XP on the singer's <paramref name="today"/>.</summary>
    internal static Task<int> GamesTodayAsync(IApplicationDbContext db, Guid userId, DateOnly today, CancellationToken ct)
        => db.PracticeSessions.CountAsync(s => s.UserId == userId && s.Kind == PracticeKind.Game && s.LocalDate == today, ct);
}
