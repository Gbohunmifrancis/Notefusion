using MediatR;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

using NoteFusion.Api.Common;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Application.Transcriptions.Queries;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Form request payload for audio transcription upload.
/// </summary>
public sealed class SubmitTranscriptionRequest
{
    /// <summary>Audio clip file to transcribe (e.g. m4a, wav, mp3).</summary>
    public required IFormFile Audio { get; init; }

    /// <summary>Transcription mode: Melody (monophonic) or Poly (polyphonic). Wire values: "melody" / "poly".</summary>
    public TranscriptionMode Mode { get; init; } = TranscriptionMode.Melody;

    /// <summary>Optional key override (e.g. 'C major', 'A minor').</summary>
    public string? Key { get; init; }

    /// <summary>Optional tempo in BPM (20 to 400).</summary>
    public int? Tempo { get; init; }

    /// <summary>Optional time signature override (e.g. '4/4', '3/4', '6/8').</summary>
    public string? TimeSignature { get; init; }
}

/// <summary>JSON body for transcribing a song behind a streaming link.</summary>
public sealed class SubmitLinkRequest
{
    /// <summary>A YouTube video, Spotify track or Apple Music song link.</summary>
    public required string Url { get; init; }

    public TranscriptionMode Mode { get; init; } = TranscriptionMode.Melody;
    public string? Key { get; init; }
    public int? Tempo { get; init; }
    public string? TimeSignature { get; init; }
}

/// <summary>
/// The transcription gateway. The client uploads captured audio here and polls the returned job — the
/// C# backend is the only entry point to the Python ML service (architecture decision).
/// </summary>
[Authorize]
public sealed class TranscriptionsController : ApiControllerBase
{
    private const long MaxAudioBytes = 25 * 1024 * 1024; // 25 MB — a few minutes of compressed audio

    private readonly ISender _sender;

    public TranscriptionsController(ISender sender) => _sender = sender;

    /// <summary>Submits captured audio for transcription; returns the job envelope to poll.</summary>
    [HttpPost]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxAudioBytes)]
    public async Task<IActionResult> Submit(
        [FromForm] SubmitTranscriptionRequest request,
        CancellationToken ct)
    {
        if (request.Audio is null || request.Audio.Length == 0)
            return HandleResult(Result.Failure<TranscriptionJobDto>(
                Application.Common.Errors.TranscriptionErrors.InvalidAudio));

        await using var stream = request.Audio.OpenReadStream();
        var command = new SubmitTranscriptionCommand(stream, request.Audio.FileName, request.Mode, request.Key, request.Tempo, request.TimeSignature);
        var result = await _sender.Send(command, ct);

        if (result.IsFailure)
            return HandleResult(Result.Failure<TranscriptionJobDto>(result.Error));

        var jobDto = new TranscriptionJobDto(
            result.Value,
            TranscriptionStatus.Pending,
            0.0,
            null);

        return HandleResult(Result.Success(jobDto));
    }

    /// <summary>
    /// Transcribes the lead vocal of a song behind a YouTube, Spotify or Apple Music link. Pro accounts get
    /// the first six minutes of up to twenty songs a month in the fast lane; a free account gets one
    /// one-minute preview to see what it does. Returns the job envelope to poll, like an upload.
    /// </summary>
    [HttpPost("link")]
    public async Task<IActionResult> SubmitLink([FromBody] SubmitLinkRequest request, CancellationToken ct)
    {
        var result = await _sender.Send(
            new SubmitLinkTranscriptionCommand(request.Url, request.Mode, request.Key, request.Tempo, request.TimeSignature), ct);

        if (result.IsFailure)
            return HandleResult(Result.Failure<TranscriptionJobDto>(result.Error));

        return HandleResult(Result.Success(new TranscriptionJobDto(result.Value, TranscriptionStatus.Pending, 0.0, null, null, "fetching")));
    }

    /// <summary>Polls a transcription job for status, progress, and the result once done.</summary>
    [HttpGet("jobs/{jobId}")]
    public async Task<IActionResult> GetJob(string jobId, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetTranscriptionJobQuery(jobId), ct));
}
