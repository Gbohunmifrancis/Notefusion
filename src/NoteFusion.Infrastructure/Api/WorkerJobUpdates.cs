using System.Text.Json;
using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Infrastructure.Api;

/// <summary>Reads the progress the worker posts beside its completion webhook (<c>app.jobs.progress</c>).</summary>
public static class WorkerJobUpdates
{
    /// <summary>Longest body a progress post may have: a job's state and its song's title, never a result.</summary>
    public const int MaxBytes = 16 * 1024;

    /// <summary>
    /// The worker's <c>JobResponse</c> for a job still running, in this API's terms as its GET would answer; null when
    /// the body is not one. Any result in it is dropped: the outcome is read from the worker by the API itself.
    /// </summary>
    public static TranscriptionJobDto? Read(string jobId, string body)
    {
        try
        {
            var wire = JsonSerializer.Deserialize(body, ApiJsonContext.Default.JobResponse);
            if (wire is null || string.IsNullOrEmpty(wire.Status))
                return null;
            var job = TranscriptionApiClient.MapJob(jobId, wire with { Result = null });
            return job.IsSuccess ? job.Value : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
