namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Where the caller of the current request appears to be, as an ISO 3166-1 alpha-2 code, or null when it
/// cannot be determined. Two facts have to line up to answer that — which address the request really came
/// from, and what that address means — and they fail for unrelated reasons, so they are separate seams:
/// this one owns "who is calling", <see cref="IGeoIpLookup"/> owns "what does an address mean".
/// </summary>
/// <remarks>
/// Never throws and never blocks for long. The country decides which billing tier a user is offered, and
/// an outage in a geolocation service is not a reason to fail a sign-up — null (show every tier) is the
/// safe answer, and the only one that degrades in the customer's favour.
/// </remarks>
public interface ICountryResolver
{
    Task<string?> ResolveAsync(CancellationToken ct = default);
}

/// <summary>
/// Turns an IP address into an ISO 3166-1 alpha-2 country code, or null when it cannot say. Deliberately
/// narrow so the mechanism behind it — a hosted lookup, a local MaxMind database, a CDN-supplied header —
/// can change without touching a caller.
/// </summary>
public interface IGeoIpLookup
{
    Task<string?> CountryForAsync(string ipAddress, CancellationToken ct = default);
}
