using NoteFusion.Api.Middleware;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Api.Common;

/// <summary>
/// Reads the correlation id off the request in flight. Same seam as <see cref="RequestClientIpAddress"/>:
/// <c>IHttpContextAccessor</c> is an Api concern, and the layers below only ever see the interface.
/// </summary>
/// <remarks>
/// Registered as a <b>singleton</b>, unlike its siblings. It has to be: the outbound
/// <c>CorrelationIdHandler</c> is held in an <c>HttpClient</c> handler chain that outlives any one request,
/// so a scoped dependency injected there would be captured on first use and answer with a stale request's
/// id — or none — for the two minutes that chain is reused. A singleton reading
/// <c>IHttpContextAccessor</c>, which is itself a singleton over an <c>AsyncLocal</c>, is correct at every
/// lifetime.
/// </remarks>
public sealed class RequestCorrelationId : ICorrelationId
{
    private readonly IHttpContextAccessor _http;

    public RequestCorrelationId(IHttpContextAccessor http) => _http = http;

    public string? Current
        => _http.HttpContext?.Items.TryGetValue(CorrelationIdMiddleware.ItemKey, out var value) == true
            ? value as string
            : null;
}
