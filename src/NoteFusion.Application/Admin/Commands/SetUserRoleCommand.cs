using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Services;
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
/// the target role, not the verb. The role is a JWT claim, so a demotion also revokes the account's refresh
/// tokens (no session can mint a fresh token that still says Admin), and the Admin policy re-reads the role
/// from the database on every admin request, so the access token already issued stops opening the console
/// within that check's short cache.
/// <para>Idempotent — setting the role an account already has succeeds and writes nothing.</para>
/// </remarks>
public sealed record SetUserRoleCommand(Guid UserId, UserRole Role, string? Note = null) : IRequest<Result>;

public sealed class SetUserRoleCommandHandler : IRequestHandler<SetUserRoleCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;

    public SetUserRoleCommandHandler(
        IApplicationDbContext db, ICurrentUser currentUser, IAuditLogger audit, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
        _clock = clock;
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

        // Every session the account holds was issued as an admin, and a refresh would hand it a new access
        // token with the role it no longer has. Signing it out everywhere is the simple, certain answer.
        if (request.Role != UserRole.Admin)
            await RefreshTokenRevocation.RevokeAllAsync(_db, user.Id, _clock.UtcNow, ct);

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
