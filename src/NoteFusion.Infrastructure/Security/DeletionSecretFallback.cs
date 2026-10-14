using NoteFusion.Application.Common.Settings;

namespace NoteFusion.Infrastructure.Security;

/// <summary>
/// Fills in <see cref="AuthSettings.DeletionSecret"/> when the deploy did not set one of its own.
/// </summary>
/// <remarks>
/// The old default was a constant in this repository, so every deletion link it signed could be forged by
/// anyone who read the source. Refusing to start without a configured secret would take production down
/// on the next deploy, so instead the secret is derived from the JWT signing key — server-only, and
/// configured everywhere this runs. Links signed before the switch stop validating; they last 24 hours.
/// </remarks>
public static class DeletionSecretFallback
{
    /// <summary>Versioned so a future change of scheme can derive a different value from the same key.</summary>
    public const string Purpose = "account-deletion/v2";

    /// <summary>Derives the secret into <paramref name="auth"/> if it has none of its own; true when it did.</summary>
    public static bool Apply(AuthSettings auth, RsaKeyProvider keys)
    {
        if (auth.HasOwnDeletionSecret)
            return false;

        auth.DeletionSecret = keys.DeriveSecret(Purpose);
        return true;
    }
}
