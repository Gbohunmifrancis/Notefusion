using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Offers;
using NoteFusion.Application.Offers.Commands;
using NoteFusion.Application.Offers.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The seasonal offer as the website and the web app read it: what is live for the caller and at what price, and the
/// email's open and its button's click. Anonymous allowed; a signed-in caller is priced by their own account.
/// </summary>
[AllowAnonymous]
[Route("api/offers")]
public sealed class OffersController : ApiControllerBase
{
    private readonly ISender _sender;

    public OffersController(ISender sender) => _sender = sender;

    /// <summary>
    /// The offer live for the caller (their plans' usual and offer prices, and their own end), or null; and, when
    /// <paramref name="key"/> names an offer that is over for them, <c>ended</c>. Never cached: the price and the end
    /// are the caller's own.
    /// </summary>
    [HttpGet("current")]
    public async Task<IActionResult> Current([FromQuery] string? key, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        return HandleResult(await _sender.Send(new GetCurrentOfferQuery(key), ct));
    }

    /// <summary>The email's button opened the web app (its <c>m=</c> token): counted once. Always 204.</summary>
    [HttpPost("click")]
    [EnableRateLimiting(AuthRateLimiting.WebEvents)]
    public async Task<IActionResult> Click(OfferClickBody body, CancellationToken ct)
    {
        await _sender.Send(new RecordOfferClickCommand(body?.Token), ct);
        return NoContent();
    }

    /// <summary>
    /// The email's 1×1 image (its own token): counts the email as opened, once, and answers the same transparent GIF
    /// whatever the token. Not rate limited: Gmail and Apple fetch images from shared addresses, and one lookup by a
    /// unique token is all it costs.
    /// </summary>
    [HttpGet("o/{token}")]
    public async Task<IActionResult> Open(string token, CancellationToken ct)
    {
        await _sender.Send(new RecordOfferOpenCommand(token), ct);
        Response.Headers.CacheControl = "no-store, no-cache, must-revalidate, private";
        return File(TransparentGif, "image/gif");
    }

    /// <summary>
    /// The last call's live countdown (<see cref="OfferCountdown"/>): an animated GIF of the time left until the offer
    /// ends for the person its token names (the UK's without one), drawn fresh at every load, so it reads right whenever
    /// the email is opened; a clock at nothing once it is over or for a key that names no offer. Never cached; limited
    /// per address as the web events are (mail apps fetch images from shared addresses, a few per open).
    /// </summary>
    [HttpGet("countdown")]
    [EnableRateLimiting(AuthRateLimiting.WebEvents)]
    public async Task<IActionResult> Countdown([FromQuery(Name = "o")] string? key, [FromQuery(Name = "m")] string? token, CancellationToken ct)
    {
        var result = await _sender.Send(new GetOfferCountdownQuery(key, token), ct);
        var left = result.IsSuccess ? result.Value.Left : TimeSpan.Zero;
        var template = result.IsSuccess ? result.Value.Template : null;
        Response.Headers.CacheControl = "no-store, no-cache, must-revalidate, private";
        Response.Headers.Pragma = "no-cache";
        Response.Headers.Expires = "0";
        return File(OfferCountdown.Render(left, OfferCountdown.For(template)), "image/gif");
    }

    /// <summary>A 1×1 transparent GIF.</summary>
    private static readonly byte[] TransparentGif = Convert.FromBase64String("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");

    /// <summary>Body of <c>POST /api/offers/click</c>.</summary>
    public sealed record OfferClickBody(string? Token);
}
