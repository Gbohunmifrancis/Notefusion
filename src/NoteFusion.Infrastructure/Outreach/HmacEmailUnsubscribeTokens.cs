using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using NoteFusion.Application.Outreach;
using NoteFusion.Infrastructure.Security;

namespace NoteFusion.Infrastructure.Outreach;

/// <summary>
/// Unsubscribe tokens: base64url of the account id's 16 bytes followed by an HMAC-SHA256 over them, keyed by
/// a secret derived from the JWT signing key (<see cref="RsaKeyProvider.DeriveSecret"/>), so there is no new
/// secret to deploy and every instance signs alike. Rotating the signing key retires old links; the email
/// footer still tells people they can reply to be taken off.
/// </summary>
public sealed class HmacEmailUnsubscribeTokens : IEmailUnsubscribeTokens
{
    /// <summary>Versioned so a future scheme derives a different key from the same signing key.</summary>
    public const string Purpose = "email-unsubscribe/v1";

    private readonly byte[] _key;

    public HmacEmailUnsubscribeTokens(RsaKeyProvider keys)
        => _key = Encoding.UTF8.GetBytes(keys.DeriveSecret(Purpose));

    public string Create(Guid userId)
    {
        var id = userId.ToByteArray();
        return Base64UrlEncoder.Encode([.. id, .. HMACSHA256.HashData(_key, id)]);
    }

    public Guid? Read(string? token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 100)
            return null;

        byte[] bytes;
        try
        {
            bytes = Base64UrlEncoder.DecodeBytes(token.Trim());
        }
        catch (Exception ex) when (ex is FormatException or ArgumentException)
        {
            return null;
        }

        if (bytes.Length != 16 + 32)
            return null;

        var id = bytes[..16];
        return CryptographicOperations.FixedTimeEquals(bytes[16..], HMACSHA256.HashData(_key, id))
            ? new Guid(id)
            : null;
    }
}
