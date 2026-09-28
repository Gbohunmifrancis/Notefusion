using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Application.Common.Interfaces;

public interface ITranscriptionNotifier
{
    Task NotifyJobCompletedAsync(Guid userId, TranscriptionJobDto job, CancellationToken cancellationToken = default);
}
