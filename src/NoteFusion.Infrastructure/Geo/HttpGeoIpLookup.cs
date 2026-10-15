using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure.Http;

namespace NoteFusion.Infrastructure.Geo;

/// <summary>
/// Resolves a country by asking an HTTP endpoint that answers with the bare ISO 3166-1 alpha-2 code as
/// plain text (geojs.io's <c>/v1/ip/country/{ip}</c> by default).
/// </summary>
/// <remarks>
/// Plain text rather than JSON on purpose: there is no field name to configure, no schema to drift, and a
/// provider swap is one env var. It also disposes of the failure mode that matters most here — ipapi.co
/// answers a rate-limited request with HTTP 200 and a JSON error body, which a JSON parser would have to
/// be told to distrust, and which "exactly two letters" rejects for free.
/// </remarks>
internal sealed class HttpGeoIpLookup : IGeoIpLookup
{
    private readonly HttpClient _http;
    private readonly GeoSettings _settings;
    private readonly ILogger<HttpGeoIpLookup> _logger;

    public HttpGeoIpLookup(HttpClient http, GeoSettings settings, ILogger<HttpGeoIpLookup> logger)
    {
        _http = http;
        _settings = settings;
        _logger = logger;
    }

    public async Task<string?> CountryForAsync(string ipAddress, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(ipAddress))
            return null;

        var url = _settings.LookupUrl.Replace("{ip}", Uri.EscapeDataString(ipAddress), StringComparison.Ordinal);

        try
        {
            using var response = await _http.GetAsync(url, ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Geo lookup for {Ip} returned {Status}; country left unknown.",
                    ipAddress, (int)response.StatusCode);
                return null;
            }

            var body = (await response.Content.ReadAsStringAsync(ct)).Trim();

            // Anything that is not exactly a two-letter code is treated as "no answer", which covers the
            // rate-limit JSON, an HTML error page, and "Undefined" alike. Guessing from a longer body is
            // how a country nobody is in ends up on a user's row.
            if (body.Length != 2 || !body.All(char.IsAsciiLetter))
            {
                _logger.LogWarning("Geo lookup for {Ip} answered {Length} chars, not a country code.",
                    ipAddress, body.Length);
                return null;
            }

            return body.ToUpperInvariant();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // The caller gave up (client disconnected). Their cancellation, not our failure — let it out
            // rather than reporting "unknown country" for a request that no longer exists.
            throw;
        }
        catch (Exception ex) when (ex is HttpRequestException || OutboundFailure.IsUnanswered(ex, ct))
        {
            // A timeout, a DNS failure or an open breaker (the service has been failing; it is not asked at
            // all for a while) must never fail a sign-up. Unknown country means every tier is offered, which
            // errs toward the customer.
            _logger.LogWarning(ex, "Geo lookup for {Ip} failed; country left unknown.", ipAddress);
            return null;
        }
    }
}

/// <summary>
/// The lookup used when <see cref="GeoSettings.LookupUrl"/> is unset: nobody has a country, so everybody
/// sees every tier. Exists so a local run needs no geolocation service and — more to the point — so a
/// misconfigured deployment shows too many prices rather than the wrong one.
/// </summary>
internal sealed class DisabledGeoIpLookup : IGeoIpLookup
{
    public Task<string?> CountryForAsync(string ipAddress, CancellationToken ct = default)
        => Task.FromResult<string?>(null);
}
