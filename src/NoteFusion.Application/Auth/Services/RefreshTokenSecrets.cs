using System.Security.Cryptography;
using System.Text;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Auth.Services;

/// <summary>
/// How a refresh token's secret is kept: SHA-256, not bcrypt. The secret is 256 random bits, so a slow hash adds
/// nothing against guessing it, and it cost about 250 ms of CPU on every refresh and logout, which anyone holding
/// one of their own token ids could call in a loop. Rows written before this keep their bcrypt hash and are checked
/// with it while they can still be used; rotation replaces them with SHA-256 rows within one token lifetime.
/// </summary>
public static class RefreshTokenSecrets
{
    private const string Prefix = "sha256:";

    public static string Hash(string secret)
        => Prefix + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret))).ToLowerInvariant();

    /// <summary>Whether <paramref name="secret"/> is the one <paramref name="stored"/> was issued with.</summary>
    public static bool Matches(string secret, RefreshToken stored, IPasswordHasher legacy, DateTime utcNow)
    {
        if (stored.TokenHash.StartsWith(Prefix, StringComparison.Ordinal))
        {
            return CryptographicOperations.FixedTimeEquals(
                Encoding.ASCII.GetBytes(Hash(secret)), Encoding.ASCII.GetBytes(stored.TokenHash));
        }

        // An old bcrypt row is checked only until it expires, so an expired one cannot be replayed to burn CPU for good.
        return stored.ExpiresAt > utcNow && legacy.Verify(secret, stored.TokenHash);
    }
}
