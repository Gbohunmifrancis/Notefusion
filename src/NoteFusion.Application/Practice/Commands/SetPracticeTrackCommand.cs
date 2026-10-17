using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Queries;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Practice.Commands;

/// <summary>
/// PUT /api/practice/track: how the caller likes to practise, "playful" or "focused" (any case). Chosen on the first
/// visit to Practice and changeable any time; answers with the progress, which carries it. A style, never an age.
/// </summary>
/// <remarks>
/// Only the drills offered and how takes are shown change: XP, levels, streaks and badges are read off the same rows
/// by the same rules, so a switch loses nothing. Today's drill becomes the new track's drill of the day at once
/// (<see cref="DrillCatalogue.ForDay"/>); a take of the old one is still marked, and the day's allowance is shared.
/// </remarks>
public sealed record SetPracticeTrackCommand(string? Track) : IRequest<Result<PracticeProgressDto>>;

public sealed class SetPracticeTrackCommandHandler : IRequestHandler<SetPracticeTrackCommand, Result<PracticeProgressDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IClientTimeZone _timeZone;

    public SetPracticeTrackCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, IClientTimeZone timeZone)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _timeZone = timeZone;
    }

    public async Task<Result<PracticeProgressDto>> Handle(SetPracticeTrackCommand request, CancellationToken cancellationToken)
    {
        if (Parse(request.Track) is not { } track)
            return PracticeErrors.TrackUnknown;
        if (_currentUser.UserId is not { } userId
            || await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken) is not { } user)
            return UserErrors.NotFound;

        if (user.PracticeTrack != track)
        {
            // The first choice also starts the practice reminders' schedule (on by default from here).
            user.ChoosePracticeTrack(track, _clock.UtcNow);
            await _db.SaveChangesAsync(cancellationToken);
        }

        return await GetPracticeProgressQueryHandler.ReadAsync(_db, _clock, _timeZone, userId, cancellationToken);
    }

    /// <summary>The wire names only: "playful" / "focused", any case — never a number.</summary>
    public static PracticeTrack? Parse(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        "playful" => PracticeTrack.Playful,
        "focused" => PracticeTrack.Focused,
        _ => null
    };
}
