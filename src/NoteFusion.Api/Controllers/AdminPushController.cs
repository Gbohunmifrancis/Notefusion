using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Push.Commands;
using NoteFusion.Application.Push.Queries;
using NoteFusion.Core.Entities;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The admin console's own web push: this browser's subscription, kept apart from the web app's (audience "console"), so
/// the console hears payments, sign-up waves and transcription floods and the web app never does. The key is the same
/// VAPID key (<c>GET /api/push/web/key</c>).
/// </summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/push")]
public sealed class AdminPushController : ApiControllerBase
{
    private readonly ISender _sender;

    public AdminPushController(ISender sender) => _sender = sender;

    /// <summary>Saves this browser's subscription (the body is <c>PushSubscription.toJSON()</c>) for the console.</summary>
    [HttpPost("subscriptions")]
    public async Task<IActionResult> Subscribe(WebPushSubscriptionRequest body, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new SaveWebPushSubscriptionCommand(
            body.Endpoint, body.Keys, Request.Headers.UserAgent.ToString(), WebPushSubscription.ConsoleAudience), ct));

    /// <summary>Forgets this browser's subscription.</summary>
    [HttpDelete("subscriptions")]
    public async Task<IActionResult> Unsubscribe(WebPushUnsubscribeRequest body, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new DeleteWebPushSubscriptionCommand(body.Endpoint), ct));

    /// <summary>Whether this server still holds this browser's subscription (<paramref name="endpoint"/>) for the caller's console.</summary>
    [HttpGet("subscriptions/status")]
    public async Task<IActionResult> Status([FromQuery] string endpoint, [FromServices] ICurrentUser caller, CancellationToken ct)
    {
        if (caller.UserId is not { } id)
            return Unauthorized();
        return Ok(await _sender.Send(new GetWebPushSubscriptionStatusQuery(id, endpoint ?? "", WebPushSubscription.ConsoleAudience), ct));
    }

    /// <summary>
    /// A test notification to this admin's console browsers, answered with what became of it per browser (delivered,
    /// gone, refused, unanswered, or web push off), so the switch shows whether it works rather than assuming it does.
    /// </summary>
    [HttpPost("test")]
    public async Task<IActionResult> Test([FromServices] IWebPushSender push, [FromServices] ICurrentUser caller, CancellationToken ct)
    {
        if (caller.UserId is not { } id)
            return Unauthorized();
        var report = await push.SendAsync(id, new WebPushNotification(
            "Notifications are on", "Payments, new emails, support messages, sign-up waves and transcription floods will show here.",
            "nf-console-test", "/", "test"),
            ct, WebPushSubscription.ConsoleAudience);
        return Ok(report);
    }
}
