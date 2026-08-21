using System.Security.Cryptography;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Guards;

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

    public string GenerateNumericCode(int digits = 6)
    {
        Guard.InRange(digits, 4, 10);

        // Digit by digit through the CSPRNG. GetInt32 is rejection-sampled, so each digit is uniform —
        // a modulo of one big random number would quietly bias the low digits, and "quietly" is the
        // problem with a code short enough to guess.
        var code = new char[digits];
        for (var i = 0; i < digits; i++)
        {
            code[i] = (char)('0' + RandomNumberGenerator.GetInt32(10));
        }

        return new string(code);
    }
}
