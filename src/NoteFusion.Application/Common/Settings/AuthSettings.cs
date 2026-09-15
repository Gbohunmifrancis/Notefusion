namespace NoteFusion.Application.Common.Settings;

/// <summary>Auth token lifetimes, bound from configuration (JWT_* / Auth section).</summary>
public sealed class AuthSettings
{
    public int AccessTokenMinutes { get; set; } = 60;
    public int RefreshTokenDays { get; set; } = 7;

    /// <summary>
    /// Where an emailed password-reset link points. The one-time token is appended as a query string, so
    /// this must be a page we control — it is set here rather than taken from the request precisely so a
    /// caller cannot choose where a real reset token gets delivered.
    /// </summary>
    /// <remarks>
    /// The marketing site, because the person following this link is an app user and the link arrives in
    /// their inbox. It used to point at the admin console's Vercel alias — a random-suffix hostname running
    /// a staff tool — which asked a customer to type a new password into a domain that has no visible
    /// relationship to the product. That is indistinguishable from a phishing mail, and teaching users to
    /// trust it is worse than the inconvenience it saved. <c>web-site/reset-password/</c> is the page this
    /// resolves to. Override with <c>Auth__ResetPasswordUrl</c>.
    /// </remarks>
    public string ResetPasswordUrl { get; set; } = "https://notefusion.studio/reset-password";

    /// <summary>Where an emailed account deletion confirmation link points.</summary>
    public string DeleteAccountUrl { get; set; } = "https://notefusion.studio/delete-account";

    /// <summary>Server-side cryptographic pepper mixed into account deletion tokens to prevent offline forgery.</summary>
    public string DeletionSecret { get; set; } = "nf-deletion-pepper-v1-static-salt";
}
