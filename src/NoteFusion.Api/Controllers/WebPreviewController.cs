using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Application.WebPreview;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Api.Controllers;

public sealed class SubmitWebPreviewRequest
{
    public required IFormFile Audio { get; init; }
    public TranscriptionMode Mode { get; init; } = TranscriptionMode.Melody;
    public string? Key { get; init; }
    public int? Tempo { get; init; }
    public string? TimeSignature { get; init; }
}

/// <summary>Optional naming for a claimed preview; the handler falls back to a generic title.</summary>
public sealed record ClaimWebPreviewRequest(string? Title);

/// <summary>
/// Public, deliberately limited proof funnel. Mobile continues to use the authenticated transcription
/// controller; this endpoint never exposes the Python worker or unrestricted export payloads.
/// </summary>
/// <remarks>
/// Anonymity is declared per action rather than on the controller, because claiming is the one route here
/// that requires an account — and a class-level <c>[AllowAnonymous]</c> silently wins over an action-level
/// <c>[Authorize]</c>, which would leave that route unchallenged.
/// </remarks>
[Route("api/web-preview")]
public sealed class WebPreviewController : ApiControllerBase
{
    private const long MaxAudioBytes = 10 * 1024 * 1024;
    private readonly ISender _sender;

    public WebPreviewController(ISender sender) => _sender = sender;

    [AllowAnonymous]
    [HttpPost("jobs")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxAudioBytes)]
    public async Task<IActionResult> Submit([FromForm] SubmitWebPreviewRequest request, CancellationToken ct)
    {
        if (request.Audio is null || request.Audio.Length == 0)
            return HandleResult(Result.Failure<WebPreviewJobDto>(
                Application.Common.Errors.TranscriptionErrors.InvalidAudio));

        await using var stream = request.Audio.OpenReadStream();
        var command = new SubmitWebPreviewCommand(
            stream,
            request.Audio.FileName,
            request.Mode,
            request.Key,
            request.Tempo,
            request.TimeSignature);
        return HandleResult(await _sender.Send(command, ct));
    }

    [AllowAnonymous]
    [HttpGet("jobs/{jobId}")]
    public async Task<IActionResult> GetJob(
        string jobId,
        [FromHeader(Name = "X-Preview-Token")] string? previewToken,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(previewToken))
            return HandleResult(Result.Failure<WebPreviewJobDto>(WebPreviewErrors.InvalidToken));

        return HandleResult(await _sender.Send(
            new GetWebPreviewJobQuery(jobId, previewToken), ct));
    }

    /// <summary>
    /// Keeps a finished preview in the signed-in caller's library. This is the hinge of the web funnel:
    /// the visitor signs up on the landing page and the result they were just shown follows them to
    /// mobile, where it is simply already there at first sign-in.
    /// </summary>
    [Authorize]
    [HttpPost("jobs/{jobId}/claim")]
    public async Task<IActionResult> Claim(
        string jobId,
        [FromHeader(Name = "X-Preview-Token")] string? previewToken,
        [FromBody] ClaimWebPreviewRequest? request,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(previewToken))
            return HandleResult(Result.Failure<SavedTranscriptionDto>(WebPreviewErrors.InvalidToken));

        return HandleResult(await _sender.Send(
            new ClaimWebPreviewCommand(jobId, previewToken, request?.Title), ct));
    }
}

[AllowAnonymous]
[Route("api/telemetry/events")]
public sealed class ProductEventsController : ApiControllerBase
{
    private readonly ISender _sender;

    public ProductEventsController(ISender sender) => _sender = sender;

    [HttpPost]
    public async Task<IActionResult> Record(
        [FromBody] RecordProductEventRequest request,
        CancellationToken ct)
        => HandleResult(await _sender.Send(
            new RecordProductEventCommand(
                request.Event,
                request.AnonymousId,
                request.JobId,
                request.Surface,
                request.Metadata), ct));
}
