using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Transcriptions;

/// <summary>Reads a stable failure code (<see cref="TranscriptionJob.FailureCode"/>) off what the worker said.</summary>
public static class JobFailures
{
    /// <summary>
    /// The start of the worker's own sentence for a journaled job it could not finish across its restarts, or
    /// whose audio is gone (<c>_LOST_ERROR</c> in <c>server/app/jobs/queue.py</c>). The worker sends no code of its
    /// own, so this sentence is how the API tells; a change to it there must change here.
    /// </summary>
    public const string WorkerLostPrefix = "The transcription service had to restart while working on this";

    /// <summary><see cref="TranscriptionJob.LostCode"/> for the worker's lost-job sentence; null for any other reason.</summary>
    public static string? CodeFor(string? workerError)
        => workerError is not null && workerError.TrimStart().StartsWith(WorkerLostPrefix, StringComparison.Ordinal)
            ? TranscriptionJob.LostCode
            : null;
}
