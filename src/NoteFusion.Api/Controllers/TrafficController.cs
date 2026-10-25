using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Analytics.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The console's Traffic page (<c>web-admin/</c>): the website's and the web app's visits from the site's own
/// tracker. Admin only for the whole controller, like every analytics route.
/// </summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/analytics/traffic")]
public sealed class TrafficController : ApiControllerBase
{
    private readonly ISender _sender;

    public TrafficController(ISender sender) => _sender = sender;

    /// <summary>
    /// Visitors, visits, page views, bounce rate and visit length for a window, its series and every breakdown,
    /// over the visits that match the filters (see <see cref="GetTrafficQuery"/>): <c>page</c>, <c>entry</c>,
    /// <c>exit</c>, <c>source</c>, <c>utmSource</c>, <c>utmMedium</c>, <c>utmCampaign</c>, <c>ref</c>,
    /// <c>country</c>, <c>browser</c>, <c>os</c>, <c>device</c> as query parameters.
    /// </summary>
    /// <param name="from">Inclusive local start date. Omit for 30 days before <paramref name="to"/>.</param>
    /// <param name="to">Inclusive local end date. Omit for now.</param>
    /// <param name="ct">Cancellation token.</param>
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken ct)
    {
        var filters = Request.Query
            .Where(q => GetTrafficQueryHandler.FilterKeys.Contains(q.Key))
            .ToDictionary(q => q.Key, q => q.Value.ToString(), StringComparer.Ordinal);
        return HandleResult(await _sender.Send(new GetTrafficQuery(from, to, filters), ct));
    }

    /// <summary>Browsers with an event in the last five minutes, and the page each is on.</summary>
    [HttpGet("live")]
    public async Task<IActionResult> Live(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetTrafficLiveQuery(), ct));
}
