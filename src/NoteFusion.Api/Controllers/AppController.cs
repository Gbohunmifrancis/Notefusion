using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Admin.Queries;
using NoteFusion.Application.AppEvents.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.AppRelease.Dtos;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Flags.Dtos;
using NoteFusion.Application.Flags.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// What the app stores carry, so a running client can tell whether it is out of date, and the season every surface
/// dresses for.
/// </summary>
[ApiController]
[Route("api/app")]
public sealed class AppController : ControllerBase
{
    private readonly AppReleaseSettings _release;
    private readonly ISender _sender;

    public AppController(AppReleaseSettings release, ISender sender)
    {
        _release = release;
        _sender = sender;
    }

    /// <summary>
    /// The newest and oldest-supported store builds, plus where to go to update.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("version")]
    [ProducesResponseType(typeof(AppVersionDto), StatusCodes.Status200OK)]
    public async Task<IActionResult> Version(CancellationToken ct)
    {
        var announcementResult = await _sender.Send(new GetSystemAnnouncementQuery(), ct);
        var announcement = announcementResult.IsSuccess && announcementResult.Value is not null
            ? new ActiveAnnouncementDto(announcementResult.Value.Message, announcementResult.Value.Severity)
            : null;

        return Ok(new AppVersionDto(
            _release.LatestVersion,
            _release.LatestBuild,
            _release.MinimumBuild,
            _release.ReleaseNotes,
            _release.AndroidStoreUrl,
            _release.IosStoreUrl,
            announcement));
    }

    /// <summary>
    /// <c>{"christmas": true|false}</c>: whether the website, the web app and the phone app dress for Christmas now. The
    /// admin console's Feature flags switch decides it, and it switches itself off after its last day. A signed-in admin
    /// also sees it while "Preview for admins only" is on. Cached for a minute: publicly when anonymous, privately when
    /// a token was sent (an admin's answer may be the preview).
    /// </summary>
    [AllowAnonymous]
    [HttpGet("season")]
    [ProducesResponseType(typeof(SeasonDto), StatusCodes.Status200OK)]
    public async Task<IActionResult> Season(CancellationToken ct)
    {
        var season = (await _sender.Send(new GetSeasonQuery(), ct)).Value;
        var signedIn = Request.Headers.Authorization.Count > 0;
        Response.Headers.CacheControl = signedIn ? "private, max-age=60" : "public, max-age=60";
        Response.Headers.Vary = "Authorization";
        return Ok(season);
    }

    /// <summary>A batch is fifty short strings at most; anything larger is not the app.</summary>
    private const long MaxEventsBodyBytes = 64 * 1024;

    /// <summary>
    /// The phone's own events for the admin console (Listen from anywhere today): at most 50 a call, each a name, flat
    /// <c>key=value</c> details and when it happened. Signed in only, tied to the account by its token. Malformed events
    /// are dropped and the rest kept; the answer says how many.
    /// </summary>
    [Authorize]
    [HttpPost("events")]
    [EnableRateLimiting(AuthRateLimiting.WebEvents)]
    [RequestSizeLimit(MaxEventsBodyBytes)]
    [ProducesResponseType(typeof(AppEventsResult), StatusCodes.Status200OK)]
    public async Task<IActionResult> Events(
        [FromBody] AppEventsRequest request, [FromServices] IDeviceFingerprint device, CancellationToken ct)
    {
        var result = await _sender.Send(new RecordAppEventsCommand(request.Build, request.Events ?? [], device.Current), ct);
        return result.IsSuccess
            ? Ok(result.Value)
            : StatusCode(ApiControllerBase.StatusFor(result.Error.Type), new ApiError(result.Error.Code, result.Error.Message));
    }

    /// <summary>Body of <c>POST /api/app/events</c>: the installed build and the events.</summary>
    public sealed record AppEventsRequest(int Build, IReadOnlyList<AppEventInput>? Events);
}
