using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Push.Commands;
using NoteFusion.Application.Push.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Web push for the web app: the key browsers subscribe with, and the signed-in account's own browser
/// subscriptions. A finished or failed transcription is pushed to them (NotifyTranscriptionReadyCommand).
/// </summary>
[Authorize]
[Route("api/push/web")]
public sealed class WebPushController : ApiControllerBase
{
    private readonly ISender _sender;

    public WebPushController(ISender sender) => _sender = sender;

    /// <summary>The VAPID public key (base64url); 404 <c>WEBPUSH_OFF</c> when web push is off.</summary>
    [AllowAnonymous]
    [HttpGet("key")]
    public async Task<IActionResult> Key(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetWebPushKeyQuery(), ct));

    /// <summary>Saves this browser's subscription (the body is <c>PushSubscription.toJSON()</c>) for the caller.</summary>
    [HttpPost("subscriptions")]
    public async Task<IActionResult> Subscribe(WebPushSubscriptionRequest body, CancellationToken ct)
        => HandleNoContent(await _sender.Send(
            new SaveWebPushSubscriptionCommand(body.Endpoint, body.Keys, Request.Headers.UserAgent.ToString()), ct));

    /// <summary>Forgets this browser's subscription for the caller. The endpoint is a URL, so it travels in the body.</summary>
    [HttpDelete("subscriptions")]
    public async Task<IActionResult> Unsubscribe(WebPushUnsubscribeRequest body, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new DeleteWebPushSubscriptionCommand(body.Endpoint), ct));
}

/// <summary>A browser's <c>PushSubscription.toJSON()</c>: <c>{endpoint, expirationTime, keys: {p256dh, auth}}</c>.</summary>
public sealed record WebPushSubscriptionRequest(string Endpoint, WebPushSubscriptionKeysDto? Keys, long? ExpirationTime = null);

public sealed record WebPushUnsubscribeRequest(string Endpoint);
