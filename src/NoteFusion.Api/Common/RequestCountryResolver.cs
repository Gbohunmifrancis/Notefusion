using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure.Geo;

namespace NoteFusion.Api.Common;

/// <summary>
/// Answers "where is the caller" for the request in flight, by reading the forwarded chain off
/// <c>HttpContext</c> and handing the address it trusts to <see cref="IGeoIpLookup"/>. Lives here for the
/// same reason <see cref="CurrentUser"/> does: <c>IHttpContextAccessor</c> is an Api concern, and the
/// Application layer only ever sees the interface.
/// </summary>
public sealed class RequestCountryResolver : ICountryResolver
{
    private readonly IHttpContextAccessor _http;
    private readonly IGeoIpLookup _lookup;
    private readonly GeoSettings _settings;

    public RequestCountryResolver(IHttpContextAccessor http, IGeoIpLookup lookup, GeoSettings settings)
    {
        _http = http;
        _lookup = lookup;
        _settings = settings;
    }

    public Task<string?> ResolveAsync(CancellationToken ct = default)
    {
        var context = _http.HttpContext;
        if (context is null)
            return Task.FromResult<string?>(null); // no request in flight (a background job, a test)

        var ip = ClientIpAddress.Resolve(
            context.Request.Headers["X-Forwarded-For"].ToString(),
            context.Connection.RemoteIpAddress?.ToString(),
            _settings.TrustedProxyHops);

        return ip is null ? Task.FromResult<string?>(null) : _lookup.CountryForAsync(ip, ct);
    }
}
