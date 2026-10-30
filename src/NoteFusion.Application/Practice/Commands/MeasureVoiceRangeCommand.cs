using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Modes;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Practice.Commands;

/// <summary>
/// The range finder (<c>POST /api/practice/range</c>, the warm-up's last step): one take of the singer holding their
/// lowest (<see cref="End"/> "low") or highest ("high") comfortable note. The worker finds the notes held in it (at least
/// a second, steady, voiced) and the lowest or highest of them is kept on the account as that end of the range.
/// Measured, never scored: no practice is recorded, nothing is earned, and the day's allowance is not spent. Answers
/// with the range as it now stands (and the note heard in this take).
/// </summary>
public sealed record MeasureVoiceRangeCommand(Stream Audio, string FileName, string? End) : IRequest<Result<VoiceRangeDto>>;

public sealed class MeasureVoiceRangeCommandHandler : IRequestHandler<MeasureVoiceRangeCommand, Result<VoiceRangeDto>>
{
    private readonly IPracticeAudioApi _api;
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly PracticeModeSettings _modes;

    public MeasureVoiceRangeCommandHandler(IPracticeAudioApi api, IApplicationDbContext db, ICurrentUser currentUser, PracticeModeSettings modes)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _modes = modes;
    }

    public async Task<Result<VoiceRangeDto>> Handle(MeasureVoiceRangeCommand request, CancellationToken cancellationToken)
    {
        if (ParseEnd(request.End) is not { } low)
            return PracticeErrors.RangeEnd;
        if (!_modes.WarmUp)
            return PracticeErrors.ModeOff;
        if (_currentUser.UserId is not { } userId
            || await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken) is not { } user)
            return UserErrors.NotFound;

        var reading = await _api.ReadRangeAsync(request.Audio, request.FileName, cancellationToken);
        if (reading.IsFailure)
            return reading.Error;
        if ((low ? reading.Value.Lowest : reading.Value.Highest) is not { } held)
            return PracticeErrors.RangeNotHeard;

        user.MeasureVoiceRange(low, held.Midi);
        await _db.SaveChangesAsync(cancellationToken);
        return VoiceRanges.Describe(
            user.VoiceRangeLowMidi, user.VoiceRangeHighMidi,
            new HeldNoteDto(held.Midi, VoiceRanges.Name(held.Midi), held.Seconds, held.Cents),
            user.PracticeInRange, user.LearnPartFromRange);
    }

    /// <summary>"low" → true, "high" → false (any case); anything else is no end named.</summary>
    public static bool? ParseEnd(string? end) => end?.Trim().ToLowerInvariant() switch
    {
        "low" or "lowest" => true,
        "high" or "highest" => false,
        _ => null
    };
}
