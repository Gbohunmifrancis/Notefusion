using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Queries;
using NoteFusion.Application.Practice.Reminders;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Practice.Commands;

/// <summary>
/// PUT /api/practice/reminders: changes what is given and leaves the rest — <c>enabled</c> (the Settings switch),
/// <c>hour</c> (the local hour, 8–21; 422 <c>PRACTICE_REMINDER_HOUR</c> otherwise) and <c>sound</c> (the phone app's
/// notification sound switch). Switching reminders on restarts their schedule. Answers with the reminders as they now stand.
/// </summary>
public sealed record SetPracticeRemindersCommand(bool? Enabled, int? Hour, bool? Sound) : IRequest<Result<PracticeRemindersDto>>;

public sealed class SetPracticeRemindersCommandHandler : IRequestHandler<SetPracticeRemindersCommand, Result<PracticeRemindersDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public SetPracticeRemindersCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result<PracticeRemindersDto>> Handle(SetPracticeRemindersCommand request, CancellationToken cancellationToken)
    {
        if (request.Hour is { } hour && !PracticeReminderRules.IsValidHour(hour))
            return PracticeErrors.ReminderHour;
        if (_currentUser.UserId is not { } userId
            || await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken) is not { } user)
            return UserErrors.NotFound;

        user.SetPracticeReminders(request.Enabled, request.Hour, request.Sound, _clock.UtcNow);
        await _db.SaveChangesAsync(cancellationToken);

        return (await GetPracticeRemindersQueryHandler.ReadAsync(_db, userId, cancellationToken))!;
    }
}
