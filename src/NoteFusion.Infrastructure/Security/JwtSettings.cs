namespace NoteFusion.Infrastructure.Security;

/// <summary>
/// JWT signing configuration. In development an ephemeral RSA key is generated at startup
/// (no PEM required); in production, <see cref="PrivateKeyPem"/> supplies a stable RS256 key
/// so tokens survive restarts and can be validated across instances.
/// </summary>
public sealed class JwtSettings
{
    public string Issuer { get; set; } = "notefusion";
    public string Audience { get; set; } = "notefusion.app";

    /// <summary>PKCS#8 RSA private key PEM. When empty, an ephemeral dev key is generated.</summary>
    public string? PrivateKeyPem { get; set; }
}
