using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A single-use refresh token. Only the bcrypt hash of the token is stored; the plain token is
/// returned to the client once. Each use is rotated: the old token is revoked and linked to its replacement.
/// </summary>
public class RefreshToken : BaseEntity
{
    private RefreshToken() { } // EF Core

    public Guid UserId { get; private set; }
    public string TokenHash { get; private set; } = string.Empty;
    public DateTime IssuedAt { get; private set; }
    public DateTime ExpiresAt { get; private set; }
    public bool IsRevoked { get; private set; }
    public DateTime? RevokedAt { get; private set; }
    public Guid? ReplacedByTokenId { get; private set; }

    /// <summary>
    /// Which client the sign-in came from, <see cref="ClientKinds"/>: kept through every rotation, so a token taken off
    /// the phone stays a phone token whatever the thief's request claims to be. Null on rows from before it was kept.
    /// </summary>
    public string? Client { get; private set; }

    public static RefreshToken Issue(
        Guid userId, string tokenHash, DateTime issuedAt, DateTime expiresAt, string? client = null)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            TokenHash = Guard.NotNullOrWhiteSpace(tokenHash),
            IssuedAt = issuedAt,
            ExpiresAt = expiresAt,
            IsRevoked = false,
            Client = client
        };

    public bool IsActive(DateTime utcNow) => !IsRevoked && ExpiresAt > utcNow;

    public void Revoke(DateTime utcNow, Guid? replacedByTokenId = null)
    {
        if (IsRevoked) return;
        IsRevoked = true;
        RevokedAt = utcNow;
        ReplacedByTokenId = replacedByTokenId;
    }
}

/// <summary>The clients a sign-in can come from (<see cref="RefreshToken.Client"/>, the access token's <c>nf_client</c>).</summary>
public static class ClientKinds
{
    /// <summary>The access token's claim that carries it.</summary>
    public const string Claim = "nf_client";

    /// <summary>The mobile app.</summary>
    public const string App = "app";

    /// <summary>A browser: the website, the web app, the admin console.</summary>
    public const string Web = "web";
}
