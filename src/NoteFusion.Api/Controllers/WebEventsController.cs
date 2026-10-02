using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Web.Commands;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The website's first-party analytics: the browser posts small batches of page views, clicks
/// and app actions here, and the admin dashboard reads them back as web traffic. Anonymous so a
/// visitor who never signs up is still a visit; when the browser sends a valid access token the
/// events are attached to the account, which is what lets the dashboard show what a web sign-up
/// went on to do.
/// </summary>
[AllowAnonymous]
[Route("api/web")]
public sealed class WebEventsController : ApiControllerBase
{
    /// <summary>A batch is a few dozen short strings; anything larger is not the tracker.</summary>
    private const long MaxBodyBytes = 64 * 1024;

    private readonly ISender _sender;

    public WebEventsController(ISender sender) => _sender = sender;

    /// <summary>Records a batch of events. Always 204: the tracker has nobody to show an error to.</summary>
    [HttpPost("events")]
    [RequestSizeLimit(MaxBodyBytes)]
    public async Task<IActionResult> Record([FromBody] WebEventsRequest request, CancellationToken ct)
    {
        await _sender.Send(new RecordWebEventsCommand(request.VisitorId, request.SessionId, request.Events ?? []), ct);
        return NoContent();
    }

    public sealed record WebEventsRequest(string? VisitorId, string? SessionId, IReadOnlyList<WebEventInput>? Events);
}
