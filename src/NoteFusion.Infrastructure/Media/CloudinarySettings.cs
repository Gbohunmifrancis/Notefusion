namespace NoteFusion.Infrastructure.Media;

/// <summary>
/// Avatar hosting, bound from the <c>Cloudinary</c> section / env
/// (<c>Cloudinary__CloudName</c>, <c>Cloudinary__ApiSecret</c>, …).
/// </summary>
public sealed class CloudinarySettings
{
    /// <summary>
    /// False (the default) keeps uploads local to the log, so a dev run needs no Cloudinary account
    /// and cannot spend someone's quota. Production sets <c>Cloudinary__UseCloudinary=true</c>
    /// alongside the credentials.
    /// </summary>
    public bool UseCloudinary { get; set; }

    /// <summary>The cloud name from the Cloudinary dashboard. Not secret, but useless on its own.</summary>
    public string CloudName { get; set; } = string.Empty;

    public string ApiKey { get; set; } = string.Empty;

    /// <summary>
    /// Cloudinary API secret. Env-only — a key in appsettings.json is a key in git history. This is
    /// the credential that makes proxying the upload through the API worthwhile: it stays on the
    /// server, so nothing signable ships inside the app binary.
    /// </summary>
    public string ApiSecret { get; set; } = string.Empty;

    /// <summary>Destination folder. One folder for all avatars keeps the media library navigable.</summary>
    public string Folder { get; set; } = "notefusion/avatars";

    /// <summary>
    /// True only when the switch is on *and* every credential is present. A half-configured
    /// deployment falls back to the logging sink instead of failing every upload at runtime.
    /// </summary>
    public bool IsConfigured =>
        UseCloudinary
        && !string.IsNullOrWhiteSpace(CloudName)
        && !string.IsNullOrWhiteSpace(ApiKey)
        && !string.IsNullOrWhiteSpace(ApiSecret);
}
