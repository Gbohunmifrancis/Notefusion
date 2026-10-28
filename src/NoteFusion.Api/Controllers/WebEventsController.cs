using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
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
[NoActivity]
public sealed class WebEventsController : ApiControllerBase
{
    /// <summary>A batch is a few dozen short strings; anything larger is not the tracker.</summary>
    private const long MaxBodyBytes = 64 * 1024;

    /// <summary>An access token is a few hundred characters; anything far longer is not one.</summary>
    private const int MaxTokenLength = 4096;

    private readonly ISender _sender;
    private readonly IOptionsMonitor<JwtBearerOptions>? _jwt;

    public WebEventsController(ISender sender, IOptionsMonitor<JwtBearerOptions>? jwt = null)
    {
        _sender = sender;
        _jwt = jwt;
    }

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
        await _sender.Send(new RecordWebEventsCommand(request.VisitorId, request.SessionId, request.Events ?? [], device.Current,
            UserAgent: Request.Headers.UserAgent.ToString()), ct);
        return NoContent();
    }

    /// <summary>
    /// The same batch sent with <c>navigator.sendBeacon</c> as the page is left: the one request a browser keeps
    /// through a navigation or a closed tab. A beacon cannot set headers, so the body is JSON sent as
    /// <c>text/plain</c> (which needs no CORS preflight) and carries the device id itself, and, for a signed-in browser,
    /// its access token: validated here exactly as the header would be, so a signed-in visitor's last clicks before they
    /// leave are theirs (a keepalive fetch with a header needs a preflight, which a closing tab rarely finishes). An
    /// invalid or expired token is ignored and the events are the visitor's. 204 whatever was in it, malformed JSON included.
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
                request.VisitorId, request.SessionId, request.Events ?? [], RequestDeviceFingerprint.Hash(request.DeviceId),
                await UserFromTokenAsync(request.Token), Request.Headers.UserAgent.ToString()), ct);
        return NoContent();
    }

    /// <summary>
    /// A tab in sight is still open: <c>track.js</c>'s heartbeat, every minute while the page is visible, sent with
    /// <c>navigator.sendBeacon</c> as <c>text/plain</c> JSON (no preflight). Held in memory for the Traffic page's live count
    /// (<see cref="IWebPresence"/>), never stored. 204 whatever was in it.
    /// </summary>
    [HttpPost("presence")]
    [EnableRateLimiting(AuthRateLimiting.WebEvents)]
    [RequestSizeLimit(MaxPresenceBytes)]
    public async Task<IActionResult> Presence(CancellationToken ct)
    {
        try
        {
            var beat = await JsonSerializer.DeserializeAsync<PresenceRequest>(Request.Body, BeaconJson, ct);
            if (beat is not null)
                await _sender.Send(new RecordPresenceCommand(beat.VisitorId, beat.Path, Request.Headers.UserAgent.ToString()), ct);
        }
        catch (JsonException)
        {
            // Not the tracker: nothing to keep.
        }
        return NoContent();
    }

    /// <summary>A heartbeat is a browser id and a path.</summary>
    private const long MaxPresenceBytes = 1024;

    /// <summary>The account a beacon's token names, validated as the bearer header would be; null for none or an invalid one.</summary>
    private async Task<Guid?> UserFromTokenAsync(string? token)
    {
        if (_jwt is null || string.IsNullOrWhiteSpace(token) || token.Length > MaxTokenLength)
            return null;
        try
        {
            var parameters = _jwt.Get(JwtBearerDefaults.AuthenticationScheme).TokenValidationParameters;
            var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, parameters);
            if (!result.IsValid)
                return null;
            var sub = result.ClaimsIdentity.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
            return Guid.TryParse(sub, out var id) ? id : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static readonly JsonSerializerOptions BeaconJson = new(JsonSerializerDefaults.Web);

    public sealed record WebEventsRequest(string? VisitorId, string? SessionId, IReadOnlyList<WebEventInput>? Events);

    public sealed record PresenceRequest(string? VisitorId, string? Path);

    /// <summary>A beacon's body: the batch plus the device id the headers would have carried.</summary>
    public sealed record BeaconRequest(
        string? VisitorId, string? SessionId, string? DeviceId, IReadOnlyList<WebEventInput>? Events, string? Token = null);
}
