using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure.Geo;

namespace NoteFusion.Api.Common;

/// <summary>
/// Reads the caller's address off the request in flight. Lives here for the same reason
/// <see cref="RequestCountryResolver"/> does: <c>IHttpContextAccessor</c> is an Api concern, and the
/// Application layer only ever sees the interface.
/// </summary>
/// <remarks>
/// Delegates the actual decision to <see cref="ClientIpAddress.Resolve"/> — the same spoof-resistant
/// rule that decides which billing tier a caller is offered — so there is one place that says which
/// entry of the forwarded chain is trustworthy. That rule keeps only publicly routable addresses, so a
/// local or compose run records null and the trail honestly shows the address as unknown rather than
/// printing a container's private one.
/// </remarks>
public sealed class RequestClientIpAddress : IClientIpAddress
{
    private readonly IHttpContextAccessor _http;
    private readonly GeoSettings _settings;

    public RequestClientIpAddress(IHttpContextAccessor http, GeoSettings settings)
    {
        _http = http;
        _settings = settings;
    }

    public string? Current
    {
        get
        {
            var context = _http.HttpContext;
            if (context is null)
                return null; // no request in flight (a background job, a test)

            return ClientIpAddress.Resolve(
                context.Request.Headers["X-Forwarded-For"].ToString(),
                context.Connection.RemoteIpAddress?.ToString(),
                _settings.TrustedProxyHops);
        }
    }
}
