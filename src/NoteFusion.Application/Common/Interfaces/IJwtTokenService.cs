using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>An issued access token and its lifetime.</summary>
public sealed record AccessToken(string Value, int ExpiresInSeconds, DateTime ExpiresAtUtc);

/// <summary>Signs RS256 JWT access tokens from a user's identity and role.</summary>
public interface IJwtTokenService
{
    AccessToken GenerateAccessToken(User user);
}
