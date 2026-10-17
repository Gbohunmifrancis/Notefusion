using MediatR;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Hymns.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Hymns.Commands;

/// <summary>
/// "Hum to find a hymn": the website's free hook. Anyone hums a few bars and is told which hymn it is,
/// with a link to its solfa page. Anonymous, and it costs nothing: no preview, no transcription allowance,
/// no row of any kind (the page's own tracker records found / not found). The clip goes to the worker,
/// which deletes it, and the hymn comes back. Throttled per address and per device at the controller.
/// </summary>
public sealed record IdentifyHymnCommand(Stream Audio, string FileName) : IRequest<Result<HymnIdentificationDto>>;

public sealed class IdentifyHymnCommandHandler : IRequestHandler<IdentifyHymnCommand, Result<HymnIdentificationDto>>
{
    private readonly ITranscriptionApi _api;

    public IdentifyHymnCommandHandler(ITranscriptionApi api) => _api = api;

    public async Task<Result<HymnIdentificationDto>> Handle(IdentifyHymnCommand request, CancellationToken cancellationToken)
    {
        if (request.Audio == Stream.Null || (request.Audio.CanSeek && request.Audio.Length == 0))
            return HymnErrors.NoAudio;

        var result = await _api.IdentifyHymnAsync(request.Audio, request.FileName, cancellationToken);
        if (result.IsSuccess)
            return result;

        // The client speaks the hymn finder's own errors; anything else it might return (a future code, a
        // transcription sentence) is not for this page, which promises only plain words about the finder.
        return result.Error.Code.StartsWith("HYMN_", StringComparison.Ordinal) ? result.Error : HymnErrors.Unavailable;
    }
}
