using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Api.Realtime;
using NoteFusion.Application.Analytics;
using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Common.Interfaces;

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

    /// <summary>
    /// The Insights page: customer behaviour for a window, cut by country, platform ("web"/"app") and plan
    /// ("pro"/"free"). Dates are inclusive reporting-local days, as on the overview.
    /// </summary>
    [HttpGet("insights")]
    public async Task<IActionResult> Insights(
        [FromQuery] DateTime? from = null,
        [FromQuery] DateTime? to = null,
        [FromQuery] string? country = null,
        [FromQuery] string? platform = null,
        [FromQuery] string? plan = null,
        CancellationToken ct = default)
        => HandleResult(await _sender.Send(new GetInsightsQuery(from, to, country, platform, plan), ct));

    /// <summary>
    /// The Practice page: practisers, takes, scores and XP; retention (first-practice cohorts, and whether practising
    /// brings people back); streaks; the path funnel by track; the daily drill allowance; reminders; badges. Takes and
    /// reminders are counted on the singer's own calendar day (see <see cref="GetPracticeAnalyticsQuery"/>).
    /// </summary>
    [HttpGet("practice")]
    public async Task<IActionResult> Practice([FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetPracticeAnalyticsQuery(from, to), ct));

    /// <summary>
    /// The Listen from anywhere page: who uses it and through which way in, what each take became, how takes end (the
    /// forgotten ones included), the reminders, the settings people keep on and the Pro locks free accounts tap. Read off
    /// the phone's own events (see <see cref="GetListenAnalyticsQuery"/>).
    /// </summary>
    [HttpGet("listen")]
    public async Task<IActionResult> Listen([FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetListenAnalyticsQuery(from, to), ct));

    /// <summary>
    /// The Hymns recognised page: which hymns people's takes matched, how often, by how many accounts, and how many
    /// kept the hymnbook version (see <see cref="GetRecognisedHymnsQuery"/>). <paramref name="internal"/> counts the
    /// team's own accounts too.
    /// </summary>
    [HttpGet("hymns")]
    public async Task<IActionResult> Hymns([FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery(Name = "internal")] bool includeInternal, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetRecognisedHymnsQuery(from, to, includeInternal), ct));

    /// <summary>
    /// The Unpaid checkouts page: every checkout opened and not paid in the window, one row each, with the account, what
    /// the provider's page saw, the answer to "What stopped you?" and whether they paid later
    /// (see <see cref="GetUnpaidCheckoutsQuery"/>).
    /// </summary>
    [HttpGet("unpaid-checkouts")]
    public async Task<IActionResult> UnpaidCheckouts([FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetUnpaidCheckoutsQuery(from, to), ct));

    /// <summary>
    /// The Growth page: renewals (memberships ending soon, the renewal rate of those that ended in the window),
    /// free-to-paid by price set, transcription failures by kind, and app versions on phones.
    /// </summary>
    [HttpGet("growth")]
    public async Task<IActionResult> Growth([FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetGrowthQuery(from, to), ct));

    /// <summary>Who is online now and which transcriptions just started, for the console's live notices.</summary>
    [HttpGet("live")]
    public async Task<IActionResult> Live(CancellationToken ct = default)
        => HandleResult(await _sender.Send(new GetLiveActivityQuery(), ct));

    /// <summary>
    /// Tells the console when what <c>live</c> shows has changed (<see cref="AdminLiveFeed"/>): <c>ready</c>, then
    /// <c>changed</c> each time someone comes online or signs up, a transcription starts or a payment goes through, so
    /// the console asks for <c>live</c> then instead of every fifteen seconds. The same stream as a job's.
    /// </summary>
    [HttpGet("live/events")]
    public async Task<IActionResult> LiveEvents(
        [FromServices] IJobEvents events, [FromServices] ICurrentUser caller, [FromServices] IOptions<JsonOptions> json,
        CancellationToken ct)
    {
        using var watch = events.Watch(AdminLiveFeed.Key, $"user:{caller.UserId}");
        if (watch is null)
            return StatusCode(StatusCodes.Status429TooManyRequests, new ApiError(
                "JOB_STREAMS_FULL", "Too many live views are open at once. Close one and try again."));
        await JobEventStream.WriteAsync(Response, AdminLiveFeed.Key, watch, json.Value.JsonSerializerOptions, ct);
        return new EmptyResult();
    }

    [HttpGet("users")]
    public async Task<IActionResult> Users(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        [FromQuery] string? search = null,
        [FromQuery] bool? isActive = null,
        [FromQuery] bool? isOnline = null,
        [FromQuery] string? lastSeen = null,
        [FromQuery] string? sort = null,
        [FromQuery] bool includeInternal = false,
        [FromQuery] string? plan = null,
        CancellationToken ct = default)
        => HandleResult(await _sender.Send(new GetAdminUsersQuery(page, pageSize, search, isActive, isOnline, lastSeen, sort, includeInternal, plan), ct));
}
