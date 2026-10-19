using System.Text;
using System.Text.Json;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Billing.GooglePlay;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Google Play Billing for the Android app. The app buys through Google Play's own sheet and hands the purchase token
/// here; Google's real-time developer notifications (Cloud Pub/Sub push) report every later change. Both only name a
/// token: what it is worth is always read from Google (<see cref="GooglePlaySync"/>).
/// </summary>
[Authorize]
[Route("api/billing/google-play")]
public sealed class GooglePlayBillingController : ApiControllerBase
{
    private readonly ISender _sender;
    private readonly IGooglePlayPushVerifier _pushes;
    private readonly IGooglePlayClient _play;

    public GooglePlayBillingController(ISender sender, IGooglePlayPushVerifier pushes, IGooglePlayClient play)
    {
        _sender = sender;
        _pushes = pushes;
        _play = play;
    }

    /// <summary>
    /// Whether the server can take Google Play purchases (its service account is set). Until it can, the Android app
    /// keeps the website's checkout (Paystack, Bachs), so a phone never sells what the server cannot confirm.
    /// </summary>
    [HttpGet("status")]
    public IActionResult Status() => Ok(new GooglePlayStatus(_play.IsConfigured));

    /// <summary>
    /// A purchase the app just made or found on restore. Returns the membership afterwards; a purchase made on another
    /// account is refused with <c>BILLING_PLAY_OTHER_ACCOUNT</c>, and Google being unreachable with a "try again".
    /// </summary>
    [HttpPost("purchases")]
    public async Task<IActionResult> Register(PurchaseBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new RegisterGooglePlayPurchaseCommand(body.ProductId, body.PurchaseToken), ct));

    /// <summary>
    /// Google's real-time developer notification, pushed by Cloud Pub/Sub with an OIDC token. A 2xx tells Pub/Sub it
    /// is handled; 503 (Google unreachable) has it delivered again later.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("notifications")]
    [RequestSizeLimit(64 * 1024)]
    public async Task<IActionResult> Notification(CancellationToken ct)
    {
        if (!await _pushes.VerifyAsync(Request.Headers.Authorization.ToString(), ct))
            return Unauthorized();

        string? data;
        try
        {
            using var envelope = await JsonDocument.ParseAsync(Request.Body, cancellationToken: ct);
            data = envelope.RootElement.TryGetProperty("message", out var message)
                   && message.TryGetProperty("data", out var encoded) && encoded.ValueKind == JsonValueKind.String
                ? Encoding.UTF8.GetString(Convert.FromBase64String(encoded.GetString()!))
                : null;
        }
        catch (Exception ex) when (ex is JsonException or FormatException)
        {
            data = null;
        }

        // Nothing we can read will read better next time, so it is acknowledged rather than redelivered.
        if (data is null)
            return NoContent();

        var handled = await _sender.Send(new HandleGooglePlayNotificationCommand(data), ct);
        return handled.IsSuccess ? NoContent() : StatusCode(StatusCodes.Status503ServiceUnavailable);
    }

    /// <summary>The token Google Play gave the app for a purchase, and the product it was for.</summary>
    public sealed record PurchaseBody(string ProductId, string PurchaseToken);
}

/// <summary>Answer of <c>GET /api/billing/google-play/status</c>.</summary>
public sealed record GooglePlayStatus(bool Ready);
