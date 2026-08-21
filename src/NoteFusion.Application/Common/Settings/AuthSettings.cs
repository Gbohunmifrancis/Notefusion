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
    /// <c>/reset-password</c> is a route of the admin-console SPA — the only build in this repo that has
    /// one — so the default is the console's live origin, which works with no configuration. Override with
    /// <c>Auth__ResetPasswordUrl</c> to point at <c>admin.notefusion.studio</c> once that name resolves.
    /// </remarks>
    public string ResetPasswordUrl { get; set; } = "https://web-admin-blue-two.vercel.app/reset-password";
}
