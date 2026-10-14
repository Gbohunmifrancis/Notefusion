using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Application.Auth.Services;

/// <summary>
/// Signs a user out everywhere by revoking every refresh token they still hold. Used when the password
/// changes (whoever had it no longer should) and when a spent token comes back (somebody copied it).
/// </summary>
/// <remarks>
/// A set-based update straight to the database, not tracked entities: it runs before the caller's
/// <c>SaveChanges</c>, so a token the caller is about to issue — still only in the change tracker — is
/// not caught by it, and no row has to be loaded to be switched off.
/// </remarks>
public static class RefreshTokenRevocation
{
    public static Task<int> RevokeAllAsync(
        IApplicationDbContext db, Guid userId, DateTime utcNow, CancellationToken ct)
        => db.RefreshTokens
            .Where(t => t.UserId == userId && !t.IsRevoked)
            .ExecuteUpdateAsync(s => s
                .SetProperty(t => t.IsRevoked, true)
                .SetProperty(t => t.RevokedAt, utcNow), ct);
}
