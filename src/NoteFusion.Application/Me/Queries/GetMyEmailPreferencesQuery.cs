using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Me.Queries;

/// <summary>The caller's email choices, for the app's Notifications screen.</summary>
public sealed record GetMyEmailPreferencesQuery : IRequest<Result<EmailPreferencesDto>>;

/// <param name="FounderNotes">
/// Whether the founder's occasional notes (the outreach emails) may reach this account: false once an
/// <see cref="Core.Entities.EmailOptOut"/> is on file, from the email's unsubscribe link or the app's switch.
/// Receipts, sign-in codes and other mail about the account are not covered and always go.
/// </param>
public sealed record EmailPreferencesDto(bool FounderNotes);

public sealed class GetMyEmailPreferencesQueryHandler : IRequestHandler<GetMyEmailPreferencesQuery, Result<EmailPreferencesDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public GetMyEmailPreferencesQueryHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<EmailPreferencesDto>> Handle(GetMyEmailPreferencesQuery request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId || !await _db.Users.AnyAsync(u => u.Id == userId, cancellationToken))
            return UserErrors.NotFound;

        var optedOut = await _db.EmailOptOuts.AnyAsync(o => o.UserId == userId, cancellationToken);
        return new EmailPreferencesDto(FounderNotes: !optedOut);
    }
}
