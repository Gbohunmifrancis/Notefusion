using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// Bars an account from signing in, and revokes every refresh token it holds so no device can quietly
/// mint a fresh session.
/// </summary>
/// <remarks>
/// <b>What this does not do.</b> Access tokens are self-contained JWTs with no revocation list, so one
/// already in the user's hands keeps working until it expires — up to <c>AuthSettings.AccessTokenMinutes</c>
/// (60 by default). Suspension therefore stops the next sign-in and the next refresh immediately, and the
/// current request-in-flight within the hour. Making it instant would mean checking the database on every
/// authenticated request, which is a different design decision than this one; the dashboard states the
/// window instead of implying a cut-off it cannot deliver.
/// <para>
/// Idempotent: suspending an already-suspended account succeeds and writes nothing, including no trail
/// entry — a repeated click is not a second event.
/// </para>
/// </remarks>
public sealed record SuspendUserCommand(Guid UserId, string? Note = null) : IRequest<Result>;

public sealed class SuspendUserCommandHandler : IRequestHandler<SuspendUserCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;

    public SuspendUserCommandHandler(
        IApplicationDbContext db, ICurrentUser currentUser, IAuditLogger audit, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
        _clock = clock;
    }

    public async Task<Result> Handle(SuspendUserCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } actorId)
            return AdminErrors.NotAuthenticated;

        // Checked before the account is even loaded: suspending yourself ends the session doing it.
        if (actorId == request.UserId)
            return AdminErrors.CannotActOnSelf;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user is null)
            return UserErrors.NotFound;

        if (user.Role == UserRole.Admin && !await AnotherActiveAdminExists(request.UserId, ct))
            return AdminErrors.LastAdmin;

        if (!user.Suspend())
            return Result.Success();

        // The flag stops the next sign-in; this stops the sessions that are already open from renewing
        // themselves. Without it a signed-in device keeps refreshing for the life of its refresh token,
        // which is seven days by default, and the suspension would be theatre.
        var tokens = await _db.RefreshTokens
            .Where(t => t.UserId == user.Id && !t.IsRevoked)
            .ToListAsync(ct);

        foreach (var token in tokens)
        {
            token.Revoke(_clock.UtcNow);
        }

        _audit.Record(
            AdminAuditAction.SuspendUser,
            user,
            $"Suspended the account and revoked {tokens.Count} active session(s).",
            request.Note);

        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }

    /// <summary>
    /// True when some other account can still sign in and administer. Guards against the console locking
    /// everyone out of itself, which only a database session could undo.
    /// </summary>
    private Task<bool> AnotherActiveAdminExists(Guid excludingUserId, CancellationToken ct)
        => _db.Users.AnyAsync(
            u => u.Id != excludingUserId && u.Role == UserRole.Admin && u.IsActive, ct);
}
