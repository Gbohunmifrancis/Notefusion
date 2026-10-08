using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Activity.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The dashboard's activity pages: every transcription asked for (saved or not), one person's or
/// browser's journey through the site, and the checkout funnel. Admin only.
/// </summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/activity")]
public sealed class ActivityController : ApiControllerBase
{
    private readonly ISender _sender;

    public ActivityController(ISender sender) => _sender = sender;

    [HttpGet("transcriptions")]
    public async Task<IActionResult> Transcriptions(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        [FromQuery] string? search = null,
        [FromQuery] string? origin = null,
        [FromQuery] string? kind = null,
        [FromQuery] string? status = null,
        [FromQuery] string? client = null,
        [FromQuery] bool? saved = null,
        [FromQuery] Guid? userId = null,
        [FromQuery] string? device = null,
        [FromQuery] DateTime? from = null,
        [FromQuery] DateTime? to = null,
        CancellationToken ct = default)
        => HandleResult(await _sender.Send(
            new GetTranscriptionLogQuery(page, pageSize, search, origin, kind, status, client, saved, userId, device, from, to), ct));

    [HttpGet("journey")]
    public async Task<IActionResult> Journey(
        [FromQuery] Guid? userId = null,
        [FromQuery] string? device = null,
        [FromQuery] string? visitor = null,
        [FromQuery] int days = 30,
        CancellationToken ct = default)
        => HandleResult(await _sender.Send(new GetJourneyQuery(userId, device, visitor, days), ct));

    [HttpGet("checkout")]
    public async Task<IActionResult> Checkout([FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetCheckoutFunnelQuery(from, to), ct));
}
