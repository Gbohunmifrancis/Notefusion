namespace NoteFusion.Application.Common.Interfaces;

/// <summary>Generates cryptographically random opaque tokens (refresh tokens).</summary>
public interface ISecureTokenGenerator
{
    string GenerateToken();
}
