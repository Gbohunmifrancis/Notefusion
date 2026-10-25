using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Push.Commands;
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

    /// <summary>A test notification to this admin's console browsers, so the switch can show it works.</summary>
    [HttpPost("test")]
    public async Task<IActionResult> Test([FromServices] IWebPushSender push, [FromServices] ICurrentUser caller, CancellationToken ct)
    {
        if (caller.UserId is not { } id)
            return Unauthorized();
        await push.SendAsync(id, new WebPushNotification(
            "Notifications are on", "Payments, sign-up waves and transcription floods will show here.", "nf-console-test", "/", "test"),
            ct, WebPushSubscription.ConsoleAudience);
        return NoContent();
    }
}
