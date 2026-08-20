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
    /// geojs.io rather than the more obvious ipapi.co, because ipapi.co answered a dyno's very first
    /// lookup with HTTP 429. Its free tier is metered per calling address, and a platform dyno shares one
    /// egress address with every other tenant on the host, so the day's quota is spent by strangers before
    /// this process starts. A provider that tolerates being called from shared cloud egress is worth more
    /// here than a larger quota, since there is no key to attribute one to.
    /// </para>
    /// <para>
    /// Volume is sign-ups per day, not paywall views — the country is resolved once per account and never
    /// on the checkout path. If lookups ever do become the binding constraint, replace this with a local
    /// MaxMind reader behind <c>IGeoIpLookup</c> — no caller changes.
    /// </para>
    /// </summary>
    public string LookupUrl { get; set; } = "https://get.geojs.io/v1/ip/country/{ip}";

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
