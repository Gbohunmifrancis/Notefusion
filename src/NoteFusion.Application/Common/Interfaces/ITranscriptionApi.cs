using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Client for the Python transcription API (TRD §6): submit compressed audio,
/// then poll the job until done.
/// </summary>
public interface ITranscriptionApi
{
    /// <summary>POST /v1/transcribe — returns the job id from the 202 response.</summary>
    Task<Result<string>> SubmitAsync(
        Stream audio,
        string fileName,
        TranscribeOptions options,
        CancellationToken cancellationToken = default);

    /// <summary>POST /v1/transcribe/score — returns the job id from the 202 response for symbolic score files.</summary>
    Task<Result<string>> SubmitScoreAsync(
        Stream score,
        string fileName,
        TranscribeOptions options,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// POST /v1/transcribe/link — a song behind a YouTube, Spotify or Apple Music link; returns the job id
    /// from the 202 response. <c>options.MaxSeconds</c> caps how much of the song is transcribed.
    /// </summary>
    Task<Result<string>> SubmitLinkAsync(
        string url,
        TranscribeOptions options,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// POST /v1/links/resolve — what a song link points at (title, artist, artwork, length) without
    /// fetching the song. Synchronous; the worker answers in a few seconds at most. A link the worker
    /// cannot read comes back as <see cref="Errors.TranscriptionErrors.InvalidLink"/>.
    /// </summary>
    Task<Result<SourceDto>> ResolveLinkAsync(
        string url,
        CancellationToken cancellationToken = default);

    /// <summary>POST /v1/grade — judges a sung take against a part. Synchronous; the worker answers in seconds.</summary>
    Task<Result<GradeResultDto>> GradeAsync(
        Stream audio,
        string fileName,
        GradeTargetDto target,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// POST /v1/harmonise — writes alto, tenor and bass under a melody the client already holds.
    /// Synchronous; symbolic work only, so the worker answers in milliseconds.
    /// </summary>
    Task<Result<HarmonyDto>> HarmoniseAsync(
        string key,
        int tempoBpm,
        string timeSignature,
        IReadOnlyList<NoteEventDto> notes,
        CancellationToken cancellationToken = default);

    /// <summary>GET /v1/jobs/{jobId} — status, progress, and the result once done.</summary>
    Task<Result<TranscriptionJobDto>> GetJobAsync(
        string jobId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// GET /healthz — whether the worker is answering, and how quickly. For the admin health page: this
    /// is the only tier a client never talks to, so an operator has no other way to tell "the ML service
    /// is down" from "transcriptions are failing".
    /// </summary>
    Task<Result<int>> PingAsync(CancellationToken cancellationToken = default);
}
