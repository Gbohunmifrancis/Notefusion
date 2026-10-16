using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Preview.Commands;
using NoteFusion.Application.Preview.Queries;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The website's try-it-free preview: a thirty-second transcription with no account. Anonymous by
/// design — the point is that a visitor sees a result before being asked for anything — and
/// throttled per browser and per address in the handlers. The claim route is the one that needs a
/// user: it is how a sign-up gets attributed to the preview that earned it.
/// </summary>
[AllowAnonymous]
[Route("api/preview")]
public sealed class PreviewController : ApiControllerBase
{
    private const long MaxAudioBytes = 25 * 1024 * 1024;
    private readonly ISender _sender;

    public PreviewController(ISender sender) => _sender = sender;

    /// <summary>A recording or file; only its first thirty seconds are transcribed.</summary>
    [HttpPost]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxAudioBytes)]
    public async Task<IActionResult> Submit([FromForm] PreviewUploadRequest request, CancellationToken ct)
    {
        if (request.Audio is null || request.Audio.Length == 0)
            return HandleResult(Result.Failure<TranscriptionJobDto>(Application.Common.Errors.TranscriptionErrors.InvalidAudio));
        await using var stream = request.Audio.OpenReadStream();
        var result = await _sender.Send(
            new SubmitPreviewCommand(stream, request.Audio.FileName, request.Separate, request.AudioPreview, request.Mode, request.KeyboardTranspose, request.Audio.ContentType, request.Audio.Length, request.TimeSignature), ct);
        return result.IsFailure
            ? HandleResult(Result.Failure<TranscriptionJobDto>(result.Error))
            : HandleResult(Result.Success(new TranscriptionJobDto(result.Value, TranscriptionStatus.Pending, 0.0, null)));
    }

    /// <summary>A song behind a link; the first thirty seconds of the lead vocal.</summary>
    [HttpPost("link")]
    public async Task<IActionResult> SubmitLink([FromBody] PreviewLinkRequest request, CancellationToken ct)
    {
        var result = await _sender.Send(
            new SubmitPreviewLinkCommand(request.Url ?? string.Empty, request.AudioPreview, request.KeyboardTranspose, request.StartSeconds, request.EndSeconds, request.TimeSignature), ct);
        return result.IsFailure
            ? HandleResult(Result.Failure<TranscriptionJobDto>(result.Error))
            : HandleResult(Result.Success(new TranscriptionJobDto(result.Value, TranscriptionStatus.Pending, 0.0, null, null, "fetching")));
    }

    /// <summary>
    /// What a song link points at and the thirty seconds a preview may have of it, so the visitor can pick
    /// which thirty. Throttled with the previews but not counted as one.
    /// </summary>
    [HttpPost("link/info")]
    public async Task<IActionResult> LinkInfo([FromBody] PreviewLinkInfoRequest request, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetPreviewLinkInfoQuery(request.Url ?? string.Empty), ct));

    /// <summary>Polls a preview; the job id is the credential.</summary>
    [HttpGet("jobs/{jobId}")]
    public async Task<IActionResult> GetJob(string jobId, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetPreviewJobQuery(jobId), ct));

    /// <summary>A signed-in account attributes its sign-up to this preview.</summary>
    [Authorize]
    [HttpPost("jobs/{jobId}/claim")]
    public async Task<IActionResult> Claim(string jobId, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new ClaimPreviewCommand(jobId), ct));

    public sealed class PreviewUploadRequest
    {
        public IFormFile? Audio { get; set; }

        /// <summary>True when the file is a whole song with instruments: the voice is isolated before transcription.</summary>
        public bool Separate { get; set; }

        /// <summary>False when the client renders its own playback and does not want the synthesised preview WAV.</summary>
        public bool AudioPreview { get; set; } = true;

        /// <summary>Transcription mode. Wire values: "melody" / "poly" / "choir" / "chords".</summary>
        public TranscriptionMode Mode { get; set; } = TranscriptionMode.Melody;

        /// <summary>The transpose setting on the player's keyboard, -11 to 11 semitones; 0 when it is off.</summary>
        public int KeyboardTranspose { get; set; }

        /// <summary>Optional beats in a bar: "2/4", "3/4", "4/4" or "6/8". Omit to leave it to the worker.</summary>
        public string? TimeSignature { get; set; }
    }

    /// <param name="KeyboardTranspose">The transpose setting on the player's keyboard, -11 to 11 semitones; 0 when it is off.</param>
    /// <param name="StartSeconds">Where in the song to start, in seconds. Omit both for the first thirty seconds.</param>
    /// <param name="EndSeconds">Where in the song to stop, in seconds; the section may not exceed thirty seconds.</param>
    /// <param name="TimeSignature">Optional beats in a bar: "2/4", "3/4", "4/4" or "6/8". Omit to leave it to the worker.</param>
    public sealed record PreviewLinkRequest(
        string? Url, bool AudioPreview = true, int KeyboardTranspose = 0, double? StartSeconds = null, double? EndSeconds = null,
        string? TimeSignature = null);

    public sealed record PreviewLinkInfoRequest(string? Url);
}
