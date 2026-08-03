using MediatR;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Queries;

/// <summary>Polls the ML service for a job's status/result (GET /v1/jobs/{jobId}).</summary>
public sealed record GetTranscriptionJobQuery(string JobId) : IRequest<Result<TranscriptionJobDto>>;

public sealed class GetTranscriptionJobQueryHandler : IRequestHandler<GetTranscriptionJobQuery, Result<TranscriptionJobDto>>
{
    private readonly ITranscriptionApi _api;

    public GetTranscriptionJobQueryHandler(ITranscriptionApi api) => _api = api;

    public Task<Result<TranscriptionJobDto>> Handle(GetTranscriptionJobQuery request, CancellationToken cancellationToken)
        => _api.GetJobAsync(request.JobId, cancellationToken);
}
