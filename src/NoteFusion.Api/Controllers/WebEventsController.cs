using System.Text.Json;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Common.Interfaces;
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

    /// <summary>
    /// Records a batch of events. 204 whatever was in it: the tracker has nobody to show an error to. The one
    /// exception is a 429 for an address posting faster than any reader's tabs would, since every event is
    /// a row and this route is open to anyone.
    /// </summary>
    [HttpPost("events")]
    [EnableRateLimiting(AuthRateLimiting.WebEvents)]
    [RequestSizeLimit(MaxBodyBytes)]
    public async Task<IActionResult> Record(
        [FromBody] WebEventsRequest request, [FromServices] IDeviceFingerprint device, CancellationToken ct)
    {
        await _sender.Send(new RecordWebEventsCommand(request.VisitorId, request.SessionId, request.Events ?? [], device.Current), ct);
        return NoContent();
    }

    /// <summary>
    /// The same batch sent with <c>navigator.sendBeacon</c> as the page is left: the one request a browser keeps
    /// through a navigation or a closed tab. A beacon cannot set headers, so the body is JSON sent as
    /// <c>text/plain</c> (which needs no CORS preflight) and carries the device id itself; it carries no token,
    /// so these events are a visitor's (track.js sends a signed-in browser's last batch the usual way instead).
    /// 204 whatever was in it, malformed JSON included.
    /// </summary>
    [HttpPost("events/beacon")]
    [EnableRateLimiting(AuthRateLimiting.WebEvents)]
    [RequestSizeLimit(MaxBodyBytes)]
    public async Task<IActionResult> Beacon(CancellationToken ct)
    {
        BeaconRequest? request = null;
        try
        {
            request = await JsonSerializer.DeserializeAsync<BeaconRequest>(Request.Body, BeaconJson, ct);
        }
        catch (JsonException)
        {
            // Not the tracker: nothing to keep.
        }
        if (request is not null)
            await _sender.Send(new RecordWebEventsCommand(
                request.VisitorId, request.SessionId, request.Events ?? [], RequestDeviceFingerprint.Hash(request.DeviceId)), ct);
        return NoContent();
    }

    private static readonly JsonSerializerOptions BeaconJson = new(JsonSerializerDefaults.Web);

    public sealed record WebEventsRequest(string? VisitorId, string? SessionId, IReadOnlyList<WebEventInput>? Events);

    /// <summary>A beacon's body: the batch plus the device id the headers would have carried.</summary>
    public sealed record BeaconRequest(string? VisitorId, string? SessionId, string? DeviceId, IReadOnlyList<WebEventInput>? Events);
}
