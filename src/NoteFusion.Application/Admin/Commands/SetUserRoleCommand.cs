using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// Promotes an account to administrator or demotes it back to a regular user.
/// </summary>
/// <remarks>
/// One command for both directions, because the guards are the same in both and the interesting state is
/// the target role, not the verb. The new role takes effect on the target's next access token: the role
/// is a JWT claim, so a demoted admin keeps console access until their current token expires — the same
/// window suspension has, for the same reason.
/// <para>Idempotent — setting the role an account already has succeeds and writes nothing.</para>
/// </remarks>
public sealed record SetUserRoleCommand(Guid UserId, UserRole Role, string? Note = null) : IRequest<Result>;

public sealed class SetUserRoleCommandHandler : IRequestHandler<SetUserRoleCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;

    public SetUserRoleCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IAuditLogger audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    public async Task<Result> Handle(SetUserRoleCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } actorId)
            return AdminErrors.NotAuthenticated;

        // Both directions are refused on yourself. Demoting yourself is the lockout; promoting yourself is
        // impossible anyway (you are already an admin to be here), so a single rule covers it.
        if (actorId == request.UserId)
            return AdminErrors.CannotActOnSelf;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user is null)
            return UserErrors.NotFound;

        if (request.Role == UserRole.User && user.Role == UserRole.Admin && !await AnotherActiveAdminExists(user.Id, ct))
            return AdminErrors.LastAdmin;

        var changed = request.Role == UserRole.Admin ? user.PromoteToAdmin() : user.DemoteFromAdmin();
        if (!changed)
            return Result.Success();

        _audit.Record(
            AdminAuditAction.ChangeRole,
            user,
            request.Role == UserRole.Admin
                ? "Granted administrator access."
                : "Removed administrator access.",
            request.Note);

        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }

    private Task<bool> AnotherActiveAdminExists(Guid excludingUserId, CancellationToken ct)
        => _db.Users.AnyAsync(
            u => u.Id != excludingUserId && u.Role == UserRole.Admin && u.IsActive, ct);
}
