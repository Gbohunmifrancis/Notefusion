namespace NoteFusion.Infrastructure.Geo;

/// <summary>
/// How the caller's country is worked out, bound from the <c>Geo</c> section / env
/// (<c>Geo__LookupUrl</c>, <c>Geo__TrustedProxyHops</c>).
/// </summary>
public sealed class GeoSettings
{
    /// <summary>
    /// URL template for the lookup, with <c>{ip}</c> substituted. The endpoint must answer with the bare
    /// two-letter country code as plain text — deliberately the narrowest possible contract, so swapping
    /// provider is a config change and not a parser.
    /// <para>
    /// Empty switches country resolution off entirely: every user resolves to null and is offered every
    /// tier. That is the correct local default in spirit, but the shipped default is a working endpoint
    /// because an unset value in production would silently price the whole world as "unknown" — and a
    /// missing country is invisible, where a failed lookup at least shows up in the log.
    /// </para>
    /// <para>
    /// ipapi.co's free tier allows roughly 1,000 lookups a day. That is sized for this: the country is
    /// resolved once per account, not once per paywall view. If it is ever the binding constraint, replace
    /// this with a local MaxMind reader behind <c>IGeoIpLookup</c> — no caller changes.
    /// </para>
    /// </summary>
    public string LookupUrl { get; set; } = "https://ipapi.co/{ip}/country/";

    /// <summary>
    /// How many proxies between the client and this process append to <c>X-Forwarded-For</c>. One for
    /// Heroku, whose router adds the address it observed to the end of whatever the client sent. Zero
    /// means nothing trustworthy is in front and the header must be ignored outright.
    /// <para>
    /// Getting this too high is the dangerous direction: it moves the read further left, into the part of
    /// the chain the caller wrote, and hands them the price of their choosing. Too low reads a proxy's own
    /// address, which is not routable and resolves to null — wrong, but harmlessly.
    /// </para>
    /// </summary>
    public int TrustedProxyHops { get; set; } = 1;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(LookupUrl) && LookupUrl.Contains("{ip}");
}
