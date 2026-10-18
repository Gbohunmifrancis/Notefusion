using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Me.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Me.Commands;

/// <summary>
/// The app's "Notes from the founder" switch: off records the same <see cref="EmailOptOut"/> the email's
/// unsubscribe link does (every outreach send checks it); on removes it. Idempotent either way, and answers
/// with the choice as it now stands.
/// </summary>
public sealed record SetMyEmailPreferencesCommand(bool FounderNotes) : IRequest<Result<EmailPreferencesDto>>;

public sealed class SetMyEmailPreferencesCommandHandler
    : IRequestHandler<SetMyEmailPreferencesCommand, Result<EmailPreferencesDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public SetMyEmailPreferencesCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result<EmailPreferencesDto>> Handle(SetMyEmailPreferencesCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId || !await _db.Users.AnyAsync(u => u.Id == userId, cancellationToken))
            return UserErrors.NotFound;

        var existing = await _db.EmailOptOuts.FirstOrDefaultAsync(o => o.UserId == userId, cancellationToken);
        if (request.FounderNotes && existing is not null)
        {
            _db.EmailOptOuts.Remove(existing);
            await _db.SaveChangesAsync(cancellationToken);
        }
        else if (!request.FounderNotes && existing is null)
        {
            var optOut = EmailOptOut.Create(userId, _clock.UtcNow);
            _db.EmailOptOuts.Add(optOut);
            try
            {
                await _db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException)
            {
                // The unsubscribe link (or a second tap) recorded it at the same moment: the account is opted out.
                _db.EmailOptOuts.Remove(optOut);
            }
        }

        return new EmailPreferencesDto(request.FounderNotes);
    }
}
