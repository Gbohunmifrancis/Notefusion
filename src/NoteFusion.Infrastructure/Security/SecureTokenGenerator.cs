using System.Security.Cryptography;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Security;

/// <summary>
/// Cryptographically-random opaque token generator (refresh-token secrets). 256 bits of entropy,
/// URL-safe base64 so the composed <c>{id}.{secret}</c> travels safely in headers and JSON.
/// </summary>
public sealed class SecureTokenGenerator : ISecureTokenGenerator
{
    private const int ByteLength = 32; // 256 bits

    public string GenerateToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(ByteLength);
        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }
}
