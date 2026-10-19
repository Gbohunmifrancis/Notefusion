using Microsoft.AspNetCore.SignalR;
using NoteFusion.Api.Hubs;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Api.Services;

/// <summary>
/// The live channels to a job's owner: the SignalR hub (app builds before the job streams) and each job's event stream.
/// </summary>
public sealed class SignalRTranscriptionNotifier : ITranscriptionNotifier
{
    private readonly IHubContext<TranscriptionHub, ITranscriptionClient> _hubContext;
    private readonly IJobEvents _events;

    public SignalRTranscriptionNotifier(IHubContext<TranscriptionHub, ITranscriptionClient> hubContext, IJobEvents events)
    {
        _hubContext = hubContext;
        _events = events;
    }

    public int JobEnded(string jobId) => _events.Publish(jobId, new JobEvent(JobEvent.Ended));

    public async Task NotifyJobCompletedAsync(Guid userId, TranscriptionJobDto job, CancellationToken cancellationToken = default)
    {
        await _hubContext.Clients.User(userId.ToString()).JobCompleted(job);
    }
}
