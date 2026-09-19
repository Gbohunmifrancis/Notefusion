using System.IO;
using System.Security.Cryptography;
using Microsoft.IdentityModel.Tokens;

namespace NoteFusion.Infrastructure.Security;

/// <summary>
/// Owns the RSA key used to sign and validate access tokens. Registered as a singleton so the same
/// key is shared by the token service (signing) and JWT bearer options (validation). If no PEM is
/// configured, a fresh 2048-bit key is generated for the process — fine for dev, where tokens are
/// short-lived and restarts are cheap.
/// </summary>
public sealed class RsaKeyProvider : IDisposable
{
    private readonly RSA _rsa;

    public RsaKeyProvider(JwtSettings settings)
    {
        _rsa = RSA.Create(2048);
        if (!string.IsNullOrWhiteSpace(settings.PrivateKeyPem))
        {
            var pem = settings.PrivateKeyPem.EndsWith(".pem") && File.Exists(settings.PrivateKeyPem)
                ? File.ReadAllText(settings.PrivateKeyPem)
                : settings.PrivateKeyPem;
                
            _rsa.ImportFromPem(pem);
        }

        SecurityKey = new RsaSecurityKey(_rsa) { KeyId = "notefusion-rsa" };
        SigningCredentials = new SigningCredentials(SecurityKey, SecurityAlgorithms.RsaSha256);
    }

    public RsaSecurityKey SecurityKey { get; }
    public SigningCredentials SigningCredentials { get; }

    public void Dispose() => _rsa.Dispose();
}
