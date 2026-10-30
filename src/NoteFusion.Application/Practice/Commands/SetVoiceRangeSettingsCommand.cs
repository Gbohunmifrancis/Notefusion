using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Modes;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Practice.Commands;

/// <summary>
/// <c>PUT /api/practice/range/settings</c>: the range card's two switches. <see cref="PracticeInRange"/> places the
/// path's drills and the modes' exercises in keys the measured range holds (<see cref="VoiceFit"/>; on by default);
/// <see cref="LearnPartFromRange"/> has the clients start "Learn my part" on the part the range suggests (off by
/// default). A null leaves that switch as it is. Answers with the range, which carries both.
/// </summary>
public sealed record SetVoiceRangeSettingsCommand(bool? PracticeInRange, bool? LearnPartFromRange) : IRequest<Result<VoiceRangeDto>>;

public sealed class SetVoiceRangeSettingsCommandHandler : IRequestHandler<SetVoiceRangeSettingsCommand, Result<VoiceRangeDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public SetVoiceRangeSettingsCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<VoiceRangeDto>> Handle(SetVoiceRangeSettingsCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId
            || await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken) is not { } user)
            return UserErrors.NotFound;

        user.SetRangeSettings(request.PracticeInRange, request.LearnPartFromRange);
        await _db.SaveChangesAsync(cancellationToken);
        return VoiceRanges.Describe(user.VoiceRangeLowMidi, user.VoiceRangeHighMidi, null, user.PracticeInRange, user.LearnPartFromRange);
    }
}
