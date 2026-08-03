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

    public static RefreshToken Issue(Guid userId, string tokenHash, DateTime issuedAt, DateTime expiresAt)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            TokenHash = Guard.NotNullOrWhiteSpace(tokenHash),
            IssuedAt = issuedAt,
            ExpiresAt = expiresAt,
            IsRevoked = false
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
