using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Application.AppRelease.Dtos;
using NoteFusion.Application.Common.Settings;

namespace NoteFusion.Api.Controllers;

/// <summary>What the app stores carry, so a running client can tell whether it is out of date.</summary>
[ApiController]
[Route("api/app")]
public sealed class AppController : ControllerBase
{
    private readonly AppReleaseSettings _release;

    public AppController(AppReleaseSettings release) => _release = release;

    /// <summary>
    /// The newest and oldest-supported store builds, plus where to go to update.
    /// </summary>
    /// <remarks>
    /// Anonymous, and deliberately not routed through a MediatR query: it is a projection of
    /// configuration with no data access and no failure mode, so a handler would be indirection with
    /// nothing inside it. Anonymous also means the splash can ask before a session is restored, and
    /// there is nothing here a client does not already learn from the store listing.
    /// </remarks>
    [AllowAnonymous]
    [HttpGet("version")]
    [ProducesResponseType(typeof(AppVersionDto), StatusCodes.Status200OK)]
    public IActionResult Version() => Ok(new AppVersionDto(
        _release.LatestVersion,
        _release.LatestBuild,
        _release.MinimumBuild,
        _release.ReleaseNotes,
        _release.AndroidStoreUrl,
        _release.IosStoreUrl));
}
