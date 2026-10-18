using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Application.Admin.Queries;
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
}
