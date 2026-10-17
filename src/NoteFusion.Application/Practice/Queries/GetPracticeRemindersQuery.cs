using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Reminders;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Practice.Queries;

/// <summary>GET /api/practice/reminders: the caller's practice reminder switch, hour and sound.</summary>
public sealed record GetPracticeRemindersQuery : IRequest<Result<PracticeRemindersDto>>;

public sealed class GetPracticeRemindersQueryHandler : IRequestHandler<GetPracticeRemindersQuery, Result<PracticeRemindersDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public GetPracticeRemindersQueryHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<PracticeRemindersDto>> Handle(GetPracticeRemindersQuery request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        var dto = await ReadAsync(_db, userId, cancellationToken);
        return dto is null ? UserErrors.NotFound : dto;
    }

    /// <summary>The account's reminders as the clients show them; also the PUT's answer. Null when there is no such account.</summary>
    internal static async Task<PracticeRemindersDto?> ReadAsync(IApplicationDbContext db, Guid userId, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.PracticeRemindersOn, u.PracticeReminderHour, u.PracticeReminderSound, HasTrack = u.PracticeTrack != null })
            .FirstOrDefaultAsync(ct);
        if (user is null)
            return null;

        // Only asked when the switch was never touched: the default reads whether they have practised.
        var on = user.PracticeRemindersOn
                 ?? PracticeReminderRules.IsOn(null, await db.PracticeSessions.AnyAsync(s => s.UserId == userId, ct), user.HasTrack);
        return new PracticeRemindersDto(on, PracticeReminderRules.HourOf(user.PracticeReminderHour), user.PracticeReminderSound ?? true);
    }
}
