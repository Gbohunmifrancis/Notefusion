using MediatR;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Preview.Commands;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Preview.Queries;

/// <summary>
/// What a pasted song link points at, for a visitor with no account, with the preview's
/// <see cref="PreviewLimits.Seconds"/> as the allowance. Throttled like a preview so a browser cannot
/// turn the worker into a free link checker, but not counted as one: nothing is recorded until a
/// preview is actually submitted.
/// </summary>
public sealed record GetPreviewLinkInfoQuery(string Url) : IRequest<Result<LinkInfoDto>>;

public sealed class GetPreviewLinkInfoQueryHandler : IRequestHandler<GetPreviewLinkInfoQuery, Result<LinkInfoDto>>
{
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IDeviceFingerprint _device;
    private readonly IClientIpAddress _ip;

    public GetPreviewLinkInfoQueryHandler(ITranscriptionApi api, IApplicationDbContext db, IDateTimeProvider clock, IDeviceFingerprint device, IClientIpAddress ip)
    {
        _api = api;
        _db = db;
        _clock = clock;
        _device = device;
        _ip = ip;
    }

    public async Task<Result<LinkInfoDto>> Handle(GetPreviewLinkInfoQuery request, CancellationToken ct)
    {
        if (!SongLinks.TryExtract(request.Url, out var url))
            return TranscriptionErrors.InvalidLink;
        if (await PreviewThrottle.CheckAsync(_db, _device.Current, _ip.Current, _clock.UtcNow, ct) is { } refused)
            return refused;

        var resolved = await _api.ResolveLinkAsync(url, ct);
        return resolved.IsFailure
            ? Result.Failure<LinkInfoDto>(resolved.Error)
            : LinkInfoDto.From(resolved.Value, PreviewLimits.Seconds);
    }
}
