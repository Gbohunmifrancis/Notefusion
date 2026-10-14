using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Analytics.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Read-only analytics for the admin dashboard (<c>web-admin/</c>).
/// </summary>
/// <remarks>
/// Every route here exposes aggregate data across all accounts, and the user list exposes personal
/// data, so the whole controller is gated on the Admin policy rather than per-action. A missing
/// attribute on a new action would otherwise publish the org's numbers to any signed-in user.
/// </remarks>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/analytics")]
public sealed class AnalyticsController : ApiControllerBase
{
    private readonly ISender _sender;

    public AnalyticsController(ISender sender) => _sender = sender;

    /// <summary>
    /// The dashboard overview: account and transcription counters, daily series, breakdowns, and
    /// weekly retention cohorts.
    /// </summary>
    /// <param name="from">Inclusive local start date. Omit for 30 days before <paramref name="to"/>.</param>
    /// <param name="to">Inclusive local end date. Omit for now.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <remarks>
    /// Days are bucketed in West Africa Time (UTC+1); the offset is echoed in the response as
    /// <c>reportingOffsetMinutes</c> so the client formats dates the way the server grouped them.
    /// Subscription counts are not here — they are a point-in-time snapshot rather than a windowed
    /// counter, and live on <c>GET api/admin/health</c>.
    /// </remarks>
    [HttpGet("overview")]
    public async Task<IActionResult> Overview(
        [FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetAnalyticsOverviewQuery(from, to), ct));

    /// <summary>A page of accounts for the admin table, newest first.</summary>
    /// <param name="page">1-based page number. Out-of-range values are clamped.</param>
    /// <param name="pageSize">Rows per page, capped at 100.</param>
    /// <param name="search">Case-insensitive substring of name or email.</param>
    /// <param name="isActive">True for accounts that can sign in, false for suspended ones, omitted for both.</param>
    /// <param name="isOnline">True for accounts active within the last 5 minutes, omitted for all.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <summary>The most active accounts and how engaged users were over a window.</summary>
    [HttpGet("engagement")]
    public async Task<IActionResult> Engagement(
        [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] int top = 20, CancellationToken ct = default)
        => HandleResult(await _sender.Send(new GetEngagementQuery(from, to, top), ct));

    /// <summary>Who is online now and which transcriptions just started, for the console's live notices.</summary>
    [HttpGet("live")]
    public async Task<IActionResult> Live(CancellationToken ct = default)
        => HandleResult(await _sender.Send(new GetLiveActivityQuery(), ct));

    [HttpGet("users")]
    public async Task<IActionResult> Users(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        [FromQuery] string? search = null,
        [FromQuery] bool? isActive = null,
        [FromQuery] bool? isOnline = null,
        [FromQuery] string? lastSeen = null,
        [FromQuery] string? sort = null,
        CancellationToken ct = default)
        => HandleResult(await _sender.Send(new GetAdminUsersQuery(page, pageSize, search, isActive, isOnline, lastSeen, sort), ct));
}
