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

    /// <summary>GET /v1/jobs/{jobId} — status, progress, and the result once done.</summary>
    Task<Result<TranscriptionJobDto>> GetJobAsync(
        string jobId,
        CancellationToken cancellationToken = default);
}
