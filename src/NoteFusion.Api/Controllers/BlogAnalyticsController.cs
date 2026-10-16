using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Analytics.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The console's Blog analytics page (<c>web-admin/</c>): blog and hymn readers and what they went on to do.
/// Admin only for the whole controller, like every analytics route.
/// </summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/analytics/blog")]
public sealed class BlogAnalyticsController : ApiControllerBase
{
    private readonly ISender _sender;

    public BlogAnalyticsController(ISender sender) => _sender = sender;

    /// <summary>
    /// The blog → product funnel for a window: traffic, reads, clicks to the app, and first-touch sign-ups,
    /// transcriptions and payments within 30 days of a visitor's first blog page (see <see cref="GetBlogAnalyticsQuery"/>).
    /// </summary>
    /// <param name="from">Inclusive local start date. Omit for 30 days before <paramref name="to"/>.</param>
    /// <param name="to">Inclusive local end date. Omit for now.</param>
    /// <param name="ct">Cancellation token.</param>
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetBlogAnalyticsQuery(from, to), ct));
}
