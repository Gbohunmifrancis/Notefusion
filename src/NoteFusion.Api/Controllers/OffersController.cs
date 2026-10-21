using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Offers.Commands;
using NoteFusion.Application.Offers.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The seasonal offer as the website and the web app read it: what is live for the caller and at what price, and the
/// email button's click. Anonymous allowed; a signed-in caller is priced by their own account.
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

    /// <summary>Body of <c>POST /api/offers/click</c>.</summary>
    public sealed record OfferClickBody(string? Token);
}
