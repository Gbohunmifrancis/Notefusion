using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>An issued access token and its lifetime.</summary>
public sealed record AccessToken(string Value, int ExpiresInSeconds, DateTime ExpiresAtUtc);

/// <summary>Signs RS256 JWT access tokens from a user's identity and role.</summary>
public interface IJwtTokenService
{
    /// <param name="client">
    /// Which client the sign-in came from (<c>ClientKinds</c>), written as the <c>nf_client</c> claim: the admin policy
    /// asks a phone's token for its unlocked Admin pass. Null writes none.
    /// </param>
    AccessToken GenerateAccessToken(User user, string? client = null);
}
