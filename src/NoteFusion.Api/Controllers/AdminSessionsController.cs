using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Admin.Sessions;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The console's Sessions page (board k-sessions): the phone's Sentry session recordings and every project's errors,
/// read through a read-only Sentry token (<c>SentryApi__Token</c>). Admins only, behind the console lock; nothing is kept.
/// </summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/sessions")]
public sealed class AdminSessionsController : ApiControllerBase
{
    private readonly ISender _sender;

    public AdminSessionsController(ISender sender) => _sender = sender;

    /// <summary>Recordings of the last 14 days, newest first, 25 a page; <c>errors=true</c> keeps those that hit one.</summary>
    [HttpGet("recordings")]
    public async Task<IActionResult> Recordings([FromQuery] bool errors, [FromQuery] string? cursor, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetSessionRecordingsQuery(errors, cursor), ct));

    /// <summary>One recording: its video pieces on its own clock, what happened, its errors and whose it is.</summary>
    [HttpGet("recordings/{id}")]
    public async Task<IActionResult> Recording(string id, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetSessionRecordingQuery(id), ct));

    /// <summary>One video piece (MP4), fetched by the player as it reaches it. <c>project</c> is the recording's own.</summary>
    [HttpGet("recordings/{id}/videos/{segment:int}")]
    public async Task<IActionResult> Video(string id, int segment, [FromQuery] string project, CancellationToken ct)
    {
        var video = await _sender.Send(new GetSessionVideoQuery(id, project, segment), ct);
        if (video.IsFailure)
            return HandleResult(video);
        Response.Headers.CacheControl = "private, max-age=3600";
        return File(video.Value, "video/mp4");
    }

    /// <summary>Unresolved errors of the last 7 days, most people first; <c>source</c> is Phone, API, Worker or Web.</summary>
    [HttpGet("errors")]
    public async Task<IActionResult> Errors([FromQuery] string? source, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetSessionErrorsQuery(source), ct));

    /// <summary>The recording of an error's latest event, or <c>recordingId: null</c> when it was not recorded.</summary>
    [HttpGet("errors/{id}/recording")]
    public async Task<IActionResult> ErrorRecording(string id, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetSessionErrorRecordingQuery(id), ct));
}
