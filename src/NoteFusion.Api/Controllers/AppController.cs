using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Application.Admin.Queries;
using NoteFusion.Application.AppRelease.Dtos;
using NoteFusion.Application.Common.Settings;

namespace NoteFusion.Api.Controllers;

/// <summary>What the app stores carry, so a running client can tell whether it is out of date.</summary>
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
}
