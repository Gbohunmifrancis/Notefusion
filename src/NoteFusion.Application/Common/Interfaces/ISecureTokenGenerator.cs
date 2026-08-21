namespace NoteFusion.Application.Common.Interfaces;

/// <summary>Generates cryptographically random opaque tokens (refresh tokens).</summary>
public interface ISecureTokenGenerator
{
    string GenerateToken();

    /// <summary>
    /// A random decimal code of exactly <paramref name="digits"/> digits, leading zeros included — for
    /// email verification, where the user has to read it off a screen and type it into a phone.
    /// </summary>
    /// <remarks>
    /// Short by necessity, so the entropy is nothing like <see cref="GenerateToken"/>'s: six digits is
    /// a million possibilities. What makes that safe is the attempt cap and resend cooldown on the
    /// account, not the code — which is why those live on the entity and cannot be skipped.
    /// </remarks>
    string GenerateNumericCode(int digits = 6);
}
