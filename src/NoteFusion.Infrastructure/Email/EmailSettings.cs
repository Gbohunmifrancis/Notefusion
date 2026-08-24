namespace NoteFusion.Infrastructure.Email;

/// <summary>
/// Email delivery and branding, bound from the <c>Email</c> section / env
/// (<c>Email__ApiKey</c>, <c>Email__FromAddress</c>, …).
/// </summary>
public sealed class EmailSettings
{
    /// <summary>
    /// False (the default) keeps mail in the log, so a dev run needs no API key and cannot post to a
    /// stranger's inbox. Production sets <c>Email__UseResend=true</c> alongside the key.
    /// </summary>
    public bool UseResend { get; set; }

    /// <summary>
    /// Resend API key. Env-only — a key in appsettings.json is a key in git history. Sending is
    /// skipped (and warned about) when this is empty, rather than failing every request.
    /// </summary>
    public string ApiKey { get; set; } = string.Empty;

    public string FromName { get; set; } = "NoteFusion";

    /// <summary>
    /// Resend's shared sandbox sender, which needs no DNS setup but only delivers to the address that
    /// owns the API key. Point this at a verified domain (<c>no-reply@notefusion.studio</c>) before real
    /// users are on it, or their mail will silently go nowhere.
    /// </summary>
    public string FromAddress { get; set; } = "onboarding@resend.dev";

    /// <summary>Where replies land. Null means replies go to <see cref="FromAddress"/>.</summary>
    public string? ReplyTo { get; set; }

    public string SupportEmail { get; set; } = "hello@notefusion.studio";

    /// <summary>Marketing site — the footer and the header logo link here.</summary>
    public string AppUrl { get; set; } = "https://notefusion.studio";

    /// <summary>
    /// Origin the email logo is fetched from — the marketing site, which publishes it at
    /// <c>/email/logo.png</c> (source: <c>web-admin/scripts/make-email-logo.mjs</c>). It used to be the
    /// API's own URL, back when the API served the dashboard bundle out of <c>wwwroot</c>; the dashboard
    /// is a separate Vercel app now and this image is the only asset the API ever needed from it. Mail
    /// clients fetch this over the public internet, so localhost is useless here.
    /// </summary>
    public string AssetBaseUrl { get; set; } = string.Empty;
}
