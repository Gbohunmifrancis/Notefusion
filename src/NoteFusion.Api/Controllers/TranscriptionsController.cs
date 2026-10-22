using MediatR;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using Microsoft.Extensions.Options;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Application.Transcriptions.Queries;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Form request payload for audio transcription upload.
/// </summary>
/// <summary>Multipart body of a grading request: the take, and the part as JSON.</summary>
public sealed class GradeTakeRequest
{
    public IFormFile? Audio { get; set; }
    public string? Target { get; set; }

    /// <summary>The saved sheet practised, when there is one; recorded with the practice if the singer may open it.</summary>
    public Guid? TranscriptionId { get; set; }

    /// <summary>The part sung: "soprano", "alto", "tenor" or "bass" (or S/A/T/B).</summary>
    public string? Part { get; set; }
}

public sealed class SubmitTranscriptionRequest
{
    /// <summary>Audio clip file to transcribe (e.g. m4a, wav, mp3).</summary>
    public required IFormFile Audio { get; init; }

    /// <summary>Transcription mode. Wire values: "melody" / "poly" / "choir" / "chords".</summary>
    public TranscriptionMode Mode { get; init; } = TranscriptionMode.Melody;

    /// <summary>Optional key override (e.g. 'C major', 'A minor').</summary>
    public string? Key { get; init; }

    /// <summary>True when the file is a whole song with instruments: the voice is isolated before transcription.</summary>
    public bool Separate { get; init; }

    /// <summary>False when the client renders its own playback and does not want the synthesised preview WAV.</summary>
    public bool AudioPreview { get; init; } = true;

    /// <summary>Optional tempo in BPM (20 to 400).</summary>
    public int? Tempo { get; init; }

    /// <summary>Optional beats in a bar: "2/4", "3/4", "4/4" or "6/8" (<c>Meters.Supported</c>). Omit to leave it to the worker.</summary>
    public string? TimeSignature { get; init; }

    /// <summary>The transpose setting on the player's keyboard, -11 to 11 semitones; 0 when it is off.</summary>
    public int KeyboardTranspose { get; init; }

    /// <summary>
    /// Melody only: a take that turns out to hold no voice is read as chords. Sent by Listen from anywhere, whose takes
    /// are music caught with no idea what it is (see <see cref="TranscribeOptions.NoVoiceAsChords"/>).
    /// </summary>
    public bool NoVoiceAsChords { get; init; }
}

/// <summary>JSON body for transcribing a song behind a streaming link.</summary>
public sealed class SubmitLinkRequest
{
    /// <summary>A YouTube video, Spotify track or Apple Music song link.</summary>
    public required string Url { get; init; }

    public TranscriptionMode Mode { get; init; } = TranscriptionMode.Melody;
    public string? Key { get; init; }
    public int? Tempo { get; init; }

    /// <summary>Optional beats in a bar: "2/4", "3/4", "4/4" or "6/8" (<c>Meters.Supported</c>). Omit to leave it to the worker.</summary>
    public string? TimeSignature { get; init; }

    /// <summary>False when the client renders its own playback and does not want the synthesised preview WAV.</summary>
    public bool AudioPreview { get; init; } = true;

    /// <summary>The transpose setting on the player's keyboard, -11 to 11 semitones; 0 when it is off.</summary>
    public int KeyboardTranspose { get; init; }

    /// <summary>Where in the song to start, in seconds. Omit both for the first part of the song.</summary>
    public double? StartSeconds { get; init; }

    /// <summary>Where in the song to stop, in seconds; the section may not exceed the account's allowance.</summary>
    public double? EndSeconds { get; init; }
}

/// <summary>JSON body for asking what a song link points at.</summary>
public sealed record LinkInfoRequest(string? Url);

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

    /// <summary>
    /// Submits captured audio for transcription; returns the job envelope to poll. An <c>Idempotency-Key</c> (the
    /// phone sends its take's own id) makes a repeat from the same account return the job the first one started.
    /// </summary>
    [HttpPost]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxAudioBytes)]
    public async Task<IActionResult> Submit(
        [FromForm] SubmitTranscriptionRequest request,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        CancellationToken ct)
    {
        if (request.Audio is null || request.Audio.Length == 0)
            return HandleResult(Result.Failure<TranscriptionJobDto>(
                Application.Common.Errors.TranscriptionErrors.InvalidAudio));

        await using var stream = request.Audio.OpenReadStream();
        var command = new SubmitTranscriptionCommand(stream, request.Audio.FileName, request.Mode, request.Key, request.Tempo, request.TimeSignature, request.Separate, request.AudioPreview, request.KeyboardTranspose, request.Audio.ContentType, request.Audio.Length, idempotencyKey,
            NoVoiceAsChords: request.NoVoiceAsChords);
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
            new SubmitLinkTranscriptionCommand(
                request.Url, request.Mode, request.Key, request.Tempo, request.TimeSignature, request.AudioPreview, request.KeyboardTranspose,
                request.StartSeconds, request.EndSeconds), ct);

        if (result.IsFailure)
            return HandleResult(Result.Failure<TranscriptionJobDto>(result.Error));

        return HandleResult(Result.Success(new TranscriptionJobDto(result.Value, TranscriptionStatus.Pending, 0.0, null, null, "fetching")));
    }

    /// <summary>
    /// What a song link points at — title, artist, artwork, length — and how much of it this account may
    /// transcribe in one go, so the client can offer a section of the song. Costs nothing.
    /// </summary>
    [HttpPost("link/info")]
    [EnableRateLimiting(AuthRateLimiting.LinkInfo)]
    public async Task<IActionResult> LinkInfo([FromBody] LinkInfoRequest request, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetLinkInfoQuery(request.Url ?? string.Empty), ct));

    /// <summary>Polls a transcription job for status, progress, and the result once done.</summary>
    /// <summary>
    /// Sing-along grading (Pro): a recorded take and the part it was sung to, as multipart with the
    /// part as JSON in the <c>target</c> field (and, optionally, <c>transcriptionId</c> and <c>part</c>).
    /// Returns every note's verdict with its cents offset, and the practice it earned as <c>reward</c>.
    /// </summary>
    [HttpPost("grade")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxAudioBytes)]
    public async Task<IActionResult> Grade([FromForm] GradeTakeRequest request, CancellationToken ct)
    {
        if (request.Audio is null || request.Audio.Length == 0)
            return HandleResult(Result.Failure<GradeResultDto>(Application.Common.Errors.TranscriptionErrors.InvalidAudio));
        GradeTargetDto? target;
        try
        {
            target = System.Text.Json.JsonSerializer.Deserialize<GradeTargetDto>(
                request.Target ?? "", new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        }
        catch (System.Text.Json.JsonException)
        {
            target = null;
        }
        if (target is null || target.Notes is null || target.Notes.Count == 0)
            return HandleResult(Result.Failure<GradeResultDto>(Application.Common.Errors.TranscriptionErrors.InvalidAudio));

        await using var stream = request.Audio.OpenReadStream();
        return HandleResult(await _sender.Send(
            new GradeTakeCommand(stream, request.Audio.FileName, target, request.TranscriptionId, request.Part), ct));
    }

    /// <summary>
    /// Transposes a result the client still holds (not yet saved). Stateless; the saved-sheet
    /// equivalent is <c>POST /api/library/{id}/transpose</c>.
    /// </summary>
    [HttpPost("transpose")]
    public async Task<IActionResult> Transpose([FromBody] TransposeSheetCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>
    /// Four-part harmony (Pro), on request: alto, tenor and bass written under the melody the client
    /// holds. A transcription never carries parts unasked; this is where they come from.
    /// </summary>
    [HttpPost("harmonise")]
    public async Task<IActionResult> Harmonise([FromBody] HarmoniseSheetCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>
    /// Polls a transcription job for status, progress, and the result once done. <c>?backing=false</c> leaves the
    /// backing's bytes out of the result (<c>hasBacking</c> still says whether there is one, fetched from
    /// <c>jobs/{jobId}/backing</c>); without it the result carries them, as it always has.
    /// </summary>
    [HttpGet("jobs/{jobId}")]
    public async Task<IActionResult> GetJob(string jobId, [FromQuery] bool backing = true, CancellationToken ct = default)
        => HandleResult(await _sender.Send(new GetTranscriptionJobQuery(jobId, backing), ct));

    /// <summary>
    /// The finished job's backing, the song's instrumental, as <c>audio/mpeg</c>: for the job's owner, while it is
    /// held (kept with an upload's sheet; a link's only while the job is fresh). 404 <c>BACKING_NOT_FOUND</c> otherwise.
    /// </summary>
    [HttpGet("jobs/{jobId}/backing")]
    public async Task<IActionResult> GetJobBacking(string jobId, CancellationToken ct)
        => Backing(await _sender.Send(new GetJobBackingQuery(jobId), ct));

    /// <summary>
    /// The job's live events (<c>text/event-stream</c>), held while a client watches it instead of polling
    /// <c>jobs/{jobId}</c>: <c>ready</c>, then <c>job</c> as it moves, then <c>ended</c> (see <c>JobEventStream</c>).
    /// <c>?away=true</c> from a hidden tab: it is told, but its owner is still pushed.
    /// </summary>
    [HttpGet("jobs/{jobId}/events")]
    public Task<IActionResult> JobEvents(
        string jobId, [FromQuery] bool away, [FromServices] IJobEvents events, [FromServices] IOptions<JsonOptions> json,
        CancellationToken ct)
        => StreamJobAsync(_sender, events, json.Value.JsonSerializerOptions, new GetJobWatchQuery(jobId), away, ct);
}
