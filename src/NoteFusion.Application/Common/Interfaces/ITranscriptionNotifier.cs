using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Application.Common.Interfaces;

public interface ITranscriptionNotifier
{
    Task NotifyJobCompletedAsync(Guid userId, TranscriptionJobDto job, CancellationToken cancellationToken = default);

    /// <summary>
    /// Tells the clients watching the job live (its event stream, <see cref="IJobEvents"/>) that it has ended; how
    /// many were told. A client that was is looking at the job, so its owner is not also pushed about it.
    /// </summary>
    int JobEnded(string jobId) => 0;
}
