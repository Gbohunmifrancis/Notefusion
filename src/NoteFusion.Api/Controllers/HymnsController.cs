using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Hymns.Commands;
using NoteFusion.Application.Hymns.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// "Hum to find a hymn" (the website's <c>/hymns/identify</c>): anyone hums a few bars and is told which hymn it
/// is. Anonymous and free — it spends no preview and no transcription — and throttled per address and per
/// device (<see cref="HymnIdentifyLimiter"/>).
/// </summary>
[AllowAnonymous]
[Route("api/hymns")]
public sealed class HymnsController : ApiControllerBase
{
    /// <summary>Twenty seconds of a hum is well under a megabyte as a browser records it; the worker's own cap.</summary>
    internal const long MaxAudioBytes = 12 * 1024 * 1024;

    private readonly ISender _sender;

    public HymnsController(ISender sender) => _sender = sender;

    /// <summary>
    /// A hummed or sung clip (multipart, field <c>audio</c>; only its first 20 seconds are heard). 200 with the
    /// hymn found, or <c>match: null</c> and whether the clip was too short to tell.
    /// </summary>
    [HttpPost("identify")]
    [HymnIdentifyRateLimit]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxAudioBytes)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxAudioBytes)]
    public async Task<IActionResult> Identify([FromForm] IdentifyHymnRequest request, CancellationToken ct)
    {
        if (request.Audio is null || request.Audio.Length == 0)
            return HandleResult(Result.Failure<HymnIdentificationDto>(HymnErrors.NoAudio));
        await using var stream = request.Audio.OpenReadStream();
        return HandleResult(await _sender.Send(new IdentifyHymnCommand(stream, request.Audio.FileName), ct));
    }

    public sealed class IdentifyHymnRequest
    {
        public IFormFile? Audio { get; set; }
    }
}
