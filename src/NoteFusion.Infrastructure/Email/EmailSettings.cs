using Microsoft.Extensions.Configuration;

namespace NoteFusion.Infrastructure.Email;

/// <summary>
/// Email delivery and branding, bound from the <c>Email</c> section / env
/// (<c>Email__ApiKey</c>, <c>Email__FromAddress</c>, …) by <see cref="Resolve"/>.
/// </summary>
public sealed class EmailSettings
{
    /// <summary>
    /// Whether mail is sent through Resend or kept in the log. <see cref="Resolve"/> turns it on when a
    /// key is present, so one secret is the whole setup; <c>Email__UseResend=false</c> keeps a keyed
    /// environment in the log on purpose.
    /// </summary>
    public bool UseResend { get; set; }

    /// <summary>
    /// Resend API key. Env-only — a key in appsettings.json is a key in git history. Sending is
    /// skipped (and warned about) when this is empty, rather than failing every request.
    /// </summary>
    public string ApiKey { get; set; } = string.Empty;

    public string FromName { get; set; } = "NoteFusion";

    /// <summary>
    /// The sender, on the product's verified domain. Resend's sandbox sender (<c>onboarding@resend.dev</c>)
    /// needs no DNS but only delivers to the address that owns the key, so it is a dev-only override.
    /// </summary>
    public string FromAddress { get; set; } = "no-reply@notefusion.studio";

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
    public string AssetBaseUrl { get; set; } = "https://notefusion.studio";

    /// <summary>
    /// Binds the <c>Email</c> section and then accepts the key under every name it has been deployed
    /// as: <c>Email__ApiKey</c>, <c>Resend__ApiKey</c> (what the deploy wrote for months while the
    /// app only read the first, so no mail ever left) and the plain <c>RESEND_API_KEY</c>. A key with
    /// no explicit <c>Email__UseResend</c> turns delivery on. <c>Resend__From</c> fills the sender when
    /// <c>Email__FromAddress</c> is unset.
    /// </summary>
    public static EmailSettings Resolve(IConfiguration configuration)
    {
        // Read by hand rather than bound: the deploy writes every variable whether or not its secret
        // exists, so an unset one arrives as "" — which the binder refuses for the bool and would
        // write over a string default.
        var section = configuration.GetSection("Email");
        var defaults = new EmailSettings();
        var email = new EmailSettings
        {
            ApiKey = FirstSet(section["ApiKey"], configuration["Resend:ApiKey"], configuration["RESEND_API_KEY"]),
            FromName = FirstSet(section["FromName"], defaults.FromName),
            FromAddress = FirstSet(section["FromAddress"], configuration["Resend:From"], defaults.FromAddress),
            ReplyTo = FirstSet(section["ReplyTo"]) is { Length: > 0 } replyTo ? replyTo : null,
            SupportEmail = FirstSet(section["SupportEmail"], defaults.SupportEmail),
            AppUrl = FirstSet(section["AppUrl"], defaults.AppUrl),
            AssetBaseUrl = FirstSet(section["AssetBaseUrl"], defaults.AssetBaseUrl),
        };
        email.UseResend = bool.TryParse(section["UseResend"], out var explicitUse)
            ? explicitUse
            : email.ApiKey.Length > 0;
        return email;
    }

    private static string FirstSet(params string?[] values)
        => values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v))?.Trim() ?? string.Empty;
}
