using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Api.Hubs;

public interface ITranscriptionClient
{
    Task JobCompleted(TranscriptionJobDto job);
}

[Authorize]
public sealed class TranscriptionHub : Hub<ITranscriptionClient>
{
    // Clients just connect to receive updates, no incoming RPC methods needed yet.
}
