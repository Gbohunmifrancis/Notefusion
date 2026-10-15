using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;

namespace NoteFusion.Api.Auth;

/// <summary>What the database currently says about an account, as far as letting a request in goes.</summary>
/// <param name="Exists">False when the account has been deleted since its token was issued.</param>
/// <param name="IsActive">False when the account has been suspended.</param>
/// <param name="Role">The role the account holds now, whatever its token says.</param>
public sealed record UserAccess(bool Exists, bool IsActive, UserRole Role)
{
    public static readonly UserAccess Missing = new(false, false, UserRole.User);

    /// <summary>True when an access token for this account may still be honoured at all.</summary>
    public bool CanSignIn => Exists && IsActive;

    /// <summary>True when the account may still use the admin console.</summary>
    public bool IsAdmin => CanSignIn && Role == UserRole.Admin;
}

/// <summary>
/// A short-lived, per-instance memory of each account's active flag and role, so the checks that keep a
/// suspended or demoted account from using an access token it already holds cost one indexed read per
/// account per <see cref="Lifetime"/>, not one per request.
/// </summary>
/// <remarks>
/// An access token is valid for up to an hour and carries the role it was issued with. Suspension and
/// demotion revoke the refresh tokens, which stops new access tokens, but without a look at the database
/// the one in hand would keep working until it expired. This bounds that window to <see cref="Lifetime"/>.
/// </remarks>
public sealed class UserAccessCache
{
    /// <summary>How long an answer is reused. Also the longest a suspension or demotion takes to bite.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(30);

    private readonly IMemoryCache _cache;

    public UserAccessCache(IMemoryCache cache) => _cache = cache;

    public async Task<UserAccess> GetAsync(Guid userId, IApplicationDbContext db, CancellationToken ct)
    {
        var key = Key(userId);
        if (_cache.TryGetValue(key, out UserAccess? cached) && cached is not null)
            return cached;

        var access = await db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new UserAccess(true, u.IsActive, u.Role))
            .FirstOrDefaultAsync(ct) ?? UserAccess.Missing;

        _cache.Set(key, access, Lifetime);
        return access;
    }

    private static string Key(Guid userId) => $"user-access:{userId}";
}
