using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Queries;
using NoteFusion.Core.Enums;

namespace NoteFusion.Api.Controllers;

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

    /// <summary>Submits captured audio for transcription; returns the job id to poll.</summary>
    [HttpPost]
    [RequestSizeLimit(MaxAudioBytes)]
    public async Task<IActionResult> Submit(
        [FromForm] IFormFile audio,
        [FromForm] TranscriptionMode mode,
        [FromForm] string? key,
        [FromForm] int? tempo,
        CancellationToken ct)
    {
        if (audio is null || audio.Length == 0)
            return HandleResult(Shared.Results.Result.Failure<string>(
                Application.Common.Errors.TranscriptionErrors.InvalidAudio));

        await using var stream = audio.OpenReadStream();
        var command = new SubmitTranscriptionCommand(stream, audio.FileName, mode, key, tempo);
        return HandleResult(await _sender.Send(command, ct));
    }

    /// <summary>Polls a transcription job for status, progress, and the result once done.</summary>
    [HttpGet("jobs/{jobId}")]
    public async Task<IActionResult> GetJob(string jobId, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetTranscriptionJobQuery(jobId), ct));
}
