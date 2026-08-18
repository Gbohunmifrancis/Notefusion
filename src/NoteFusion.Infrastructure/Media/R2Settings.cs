namespace NoteFusion.Infrastructure.Media;

/// <summary>
/// Avatar hosting on Cloudflare R2, bound from the <c>R2</c> section / env
/// (<c>R2__AccountId</c>, <c>R2__SecretAccessKey</c>, …).
/// </summary>
public sealed class R2Settings
{
    /// <summary>
    /// False (the default) keeps uploads local to the log, so a dev run needs no R2 bucket and
    /// cannot write to someone's production one. Production sets <c>R2__UseR2=true</c> alongside
    /// the credentials.
    /// </summary>
    public bool UseR2 { get; set; }

    /// <summary>
    /// The Cloudflare account id, which is also the S3 endpoint host. Not secret, but useless alone.
    /// </summary>
    public string AccountId { get; set; } = string.Empty;

    /// <summary>The R2 API token's access key id. Scope it <c>Object Read &amp; Write</c>, nothing wider.</summary>
    public string AccessKeyId { get; set; } = string.Empty;

    /// <summary>
    /// The R2 API token's secret. Env-only — a key in appsettings.json is a key in git history. This
    /// is the credential that makes proxying the upload through the API worthwhile: it stays on the
    /// server, so nothing signable ships inside the app binary.
    /// </summary>
    public string SecretAccessKey { get; set; } = string.Empty;

    public string BucketName { get; set; } = string.Empty;

    /// <summary>
    /// Origin the bucket is served from, no trailing slash — a Cloudflare custom domain such as
    /// <c>https://media.notefusion.app</c>. R2 buckets are private by default, and Cloudflare
    /// documents the alternative <c>r2.dev</c> URL as rate-limited and development-only, so a custom
    /// domain is the only supported way to hand these URLs to an app.
    /// </summary>
    public string PublicBaseUrl { get; set; } = string.Empty;

    /// <summary>Key prefix. One prefix for all avatars keeps the bucket navigable.</summary>
    public string KeyPrefix { get; set; } = "avatars";

    /// <summary>The S3-compatible endpoint. R2 derives it from the account id.</summary>
    public string ServiceUrl => $"https://{AccountId}.r2.cloudflarestorage.com";

    /// <summary>
    /// True only when the switch is on *and* every value is present. A half-configured deployment
    /// falls back to the logging sink instead of failing every upload at runtime.
    /// </summary>
    /// <remarks>
    /// <see cref="PublicBaseUrl"/> is required rather than optional: without it we would store the
    /// object and persist a URL nobody can fetch, which is worse than the honest logging fallback.
    /// </remarks>
    public bool IsConfigured =>
        UseR2
        && !string.IsNullOrWhiteSpace(AccountId)
        && !string.IsNullOrWhiteSpace(AccessKeyId)
        && !string.IsNullOrWhiteSpace(SecretAccessKey)
        && !string.IsNullOrWhiteSpace(BucketName)
        && !string.IsNullOrWhiteSpace(PublicBaseUrl);
}
