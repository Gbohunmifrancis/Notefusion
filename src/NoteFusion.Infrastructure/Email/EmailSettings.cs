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
    /// Origin the email logo is fetched from. Defaults to the API's own public URL because the API
    /// serves <c>wwwroot</c>, where the mark is published as part of the dashboard bundle. Mail
    /// clients fetch this over the public internet, so localhost is useless here — an unset value
    /// simply drops the image and the text wordmark carries the header.
    /// </summary>
    public string AssetBaseUrl { get; set; } = string.Empty;
}
