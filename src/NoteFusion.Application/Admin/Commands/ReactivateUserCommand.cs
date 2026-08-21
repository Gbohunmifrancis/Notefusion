using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// Lets a suspended account sign in again.
/// </summary>
/// <remarks>
/// The refresh tokens revoked at suspension stay revoked, so every device signs in once more. That is the
/// point rather than an omission: a token that was live during a suspension is one whose copy we cannot
/// account for.
/// <para>Idempotent — reactivating an active account succeeds and writes nothing, trail entry included.</para>
/// </remarks>
public sealed record ReactivateUserCommand(Guid UserId, string? Note = null) : IRequest<Result>;

public sealed class ReactivateUserCommandHandler : IRequestHandler<ReactivateUserCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;

    public ReactivateUserCommandHandler(
        IApplicationDbContext db, ICurrentUser currentUser, IAuditLogger audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    public async Task<Result> Handle(ReactivateUserCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is null)
            return AdminErrors.NotAuthenticated;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user is null)
            return UserErrors.NotFound;

        // No self-guard and no last-admin guard here, unlike suspension: restoring access cannot lock
        // anyone out, so there is nothing to protect against.
        if (!user.Reactivate())
            return Result.Success();

        _audit.Record(AdminAuditAction.ReactivateUser, user, "Reactivated the account.", request.Note);

        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}
