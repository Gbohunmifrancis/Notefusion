namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Proves a Google Play notification came from Google: Cloud Pub/Sub signs each push with an OIDC token (Google's
/// keys, our endpoint as the audience, the push subscription's service account as the sender).
/// </summary>
public interface IGooglePlayPushVerifier
{
    /// <summary>True only for a valid push token in <paramref name="authorization"/> (<c>Bearer …</c>).</summary>
    Task<bool> VerifyAsync(string? authorization, CancellationToken ct);
}
