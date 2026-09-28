using Microsoft.AspNetCore.SignalR;
using NoteFusion.Api.Hubs;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Api.Services;

public sealed class SignalRTranscriptionNotifier : ITranscriptionNotifier
{
    private readonly IHubContext<TranscriptionHub, ITranscriptionClient> _hubContext;

    public SignalRTranscriptionNotifier(IHubContext<TranscriptionHub, ITranscriptionClient> hubContext)
    {
        _hubContext = hubContext;
    }

    public async Task NotifyJobCompletedAsync(Guid userId, TranscriptionJobDto job, CancellationToken cancellationToken = default)
    {
        await _hubContext.Clients.User(userId.ToString()).JobCompleted(job);
    }
}
