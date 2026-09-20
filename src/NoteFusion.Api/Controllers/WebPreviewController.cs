using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Common.Errors;
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

/// <summary>
/// Public, deliberately limited proof funnel. Mobile continues to use the authenticated transcription
/// controller; this endpoint never exposes the Python worker or unrestricted export payloads.
/// </summary>
[AllowAnonymous]
[Route("api/web-preview")]
public sealed class WebPreviewController : ApiControllerBase
{
    private const long MaxAudioBytes = 10 * 1024 * 1024;
    private readonly ISender _sender;

    public WebPreviewController(ISender sender) => _sender = sender;

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
