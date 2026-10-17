using System.Buffers.Text;
using System.Security.Cryptography;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure.Security;

namespace NoteFusion.Infrastructure.Push;

/// <summary>Web push settings (<c>WebPush__*</c>); all optional.</summary>
public sealed class WebPushSettings
{
    /// <summary>False turns web push off: no key is handed out and nothing is sent.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>The VAPID public key, base64url (65-byte uncompressed P-256 point). Set with <see cref="PrivateKey"/> or not at all.</summary>
    public string? PublicKey { get; set; }

    /// <summary>The VAPID private key, base64url (32-byte P-256 scalar).</summary>
    public string? PrivateKey { get; set; }

    /// <summary>Who push services can contact about our sends (RFC 8292 "sub").</summary>
    public string Subject { get; set; } = "mailto:hello@notefusion.studio";
}

/// <summary>
/// The VAPID key pair (RFC 8292) every web push is signed with, and that browsers subscribe to. A browser's
/// subscription is bound to the public key, so the pair must outlive deploys and restarts: a new pair
/// orphans every subscription (the push services refuse the sends, the rows fail out, and each browser
/// subscribes again the next time the web app sees the key has changed).
/// </summary>
/// <remarks>
/// Configured (<c>WebPush__PublicKey</c> + <c>WebPush__PrivateKey</c>) when the deploy sets them; otherwise
/// derived from the JWT signing key, as <see cref="DeletionSecretFallback"/> derives the deletion secret:
/// an HMAC of a purpose label keyed by the signing key's private bytes, taken as the P-256 scalar. That key
/// is a mounted secret in production, so the pair is as stable as sign-in is, needs no setup and is stored
/// nowhere. Rotating the JWT key rotates this pair too (and is survivable, as above). A dev run without a
/// configured JWT key gets a fresh pair per process, as it gets fresh tokens.
/// </remarks>
public sealed class VapidKeys : IWebPushKeys
{
    /// <summary>Versioned so a future change of scheme derives a different pair from the same key.</summary>
    public const string Purpose = "web-push-vapid/v1";

    private VapidKeys(string? publicKey, string? privateKey, string subject, string source)
    {
        PublicKey = publicKey;
        PrivateKey = privateKey;
        Subject = subject;
        Source = source;
    }

    public string? PublicKey { get; }
    public string? PrivateKey { get; }
    public string Subject { get; }

    /// <summary>"configured", "derived" or "off": what the startup log says.</summary>
    public string Source { get; }

    public bool IsOn => PublicKey is not null && PrivateKey is not null;

    public static VapidKeys Off(string subject = "") => new(null, null, subject, "off");

    public static VapidKeys Resolve(WebPushSettings settings, RsaKeyProvider signingKey, ILogger? logger = null)
    {
        var subject = string.IsNullOrWhiteSpace(settings.Subject) ? new WebPushSettings().Subject : settings.Subject.Trim();
        if (!settings.Enabled)
        {
            logger?.LogInformation("Web push is off (WebPush__Enabled=false).");
            return Off(subject);
        }

        var hasPublic = !string.IsNullOrWhiteSpace(settings.PublicKey);
        var hasPrivate = !string.IsNullOrWhiteSpace(settings.PrivateKey);
        if (hasPublic || hasPrivate)
        {
            // Half a pair, or a pair that does not match, would hand browsers a key we cannot sign for.
            if (hasPublic && hasPrivate && TryPublicKeyOf(Decode(settings.PrivateKey!), out var derivedPublic)
                && derivedPublic == settings.PublicKey!.Trim().TrimEnd('='))
            {
                logger?.LogInformation("Web push is on with the configured VAPID key pair.");
                return new VapidKeys(derivedPublic, settings.PrivateKey!.Trim().TrimEnd('='), subject, "configured");
            }

            logger?.LogError(
                "WebPush__PublicKey and WebPush__PrivateKey must be set together, as a matching base64url P-256 pair; web push is off.");
            return Off(subject);
        }

        for (var attempt = 0; attempt < 8; attempt++)
        {
            var scalar = Convert.FromHexString(signingKey.DeriveSecret(attempt == 0 ? Purpose : $"{Purpose}#{attempt}"));
            try
            {
                // A 256-bit HMAC is a valid P-256 scalar unless it is >= the group order (odds of about 2^-32).
                if (InRange(scalar) && TryPublicKeyOf(scalar, out var publicKey))
                {
                    logger?.LogInformation("Web push is on with a VAPID key pair derived from the JWT signing key.");
                    return new VapidKeys(publicKey, Base64Url.EncodeToString(scalar), subject, "derived");
                }
            }
            finally
            {
                CryptographicOperations.ZeroMemory(scalar);
            }
        }

        logger?.LogError("Could not derive a VAPID key pair; web push is off.");
        return Off(subject);
    }

    /// <summary>The uncompressed public point (base64url) for a P-256 private scalar.</summary>
    internal static bool TryPublicKeyOf(byte[]? scalar, out string publicKey)
    {
        publicKey = string.Empty;
        if (scalar is not { Length: 32 }) return false;
        try
        {
            using var ecdsa = ECDsa.Create();
            ecdsa.ImportParameters(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, D = scalar });
            var q = ecdsa.ExportParameters(false).Q;
            if (q.X is not { Length: 32 } || q.Y is not { Length: 32 }) return false;
            var point = new byte[65];
            point[0] = 0x04;
            q.X.CopyTo(point, 1);
            q.Y.CopyTo(point, 33);
            publicKey = Base64Url.EncodeToString(point);
            return true;
        }
        catch (CryptographicException)
        {
            return false;
        }
    }

    private static byte[]? Decode(string value)
    {
        try { return Base64Url.DecodeFromChars(value.Trim().TrimEnd('=')); }
        catch (FormatException) { return null; }
    }

    // The order n of the P-256 group, big-endian.
    private static readonly byte[] Order = Convert.FromHexString(
        "FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");

    private static bool InRange(byte[] scalar)
        => scalar.AsSpan().SequenceCompareTo(Order) < 0 && scalar.AsSpan().ContainsAnyExcept((byte)0);
}
