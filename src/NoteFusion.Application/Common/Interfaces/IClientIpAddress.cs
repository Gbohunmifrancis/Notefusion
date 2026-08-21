namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// The address the request in flight appears to come from, or null when there is nothing trustworthy to
/// read — no request (a background job, a test), or no publicly routable address behind the forwarded
/// chain, which is what a local or containerised run looks like.
/// </summary>
/// <remarks>
/// Separate from <see cref="ICountryResolver"/> even though both start from the same header: that one
/// answers "which country, for pricing" and calls out to a geolocation service, this one answers "which
/// address, for the record" and calls nothing. An audit trail must not depend on a third party being up.
/// </remarks>
public interface IClientIpAddress
{
    string? Current { get; }
}
