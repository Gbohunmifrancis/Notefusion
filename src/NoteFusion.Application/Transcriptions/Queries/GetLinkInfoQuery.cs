using MediatR;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Queries;

/// <summary>
/// What a pasted song link points at, with how much of it this account may transcribe in one go — Pro's
/// <see cref="SongCredits.ProMaxSeconds"/>, a free account's <see cref="SongCredits.FreePreviewSeconds"/> —
/// so the client can show the song and let the user pick a section before anything is spent. Asking costs
/// nothing and is not metered.
/// </summary>
public sealed record GetLinkInfoQuery(string Url) : IRequest<Result<LinkInfoDto>>;

public sealed class GetLinkInfoQueryHandler : IRequestHandler<GetLinkInfoQuery, Result<LinkInfoDto>>
{
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public GetLinkInfoQueryHandler(ITranscriptionApi api, IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result<LinkInfoDto>> Handle(GetLinkInfoQuery request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;
        if (!SongLinks.TryExtract(request.Url, out var url))
            return TranscriptionErrors.InvalidLink;

        var isPro = await ProStatus.IsProAsync(_db, _clock, userId, ct);
        var resolved = await _api.ResolveLinkAsync(url, ct);
        return resolved.IsFailure
            ? Result.Failure<LinkInfoDto>(resolved.Error)
            : LinkInfoDto.From(resolved.Value, isPro ? SongCredits.ProMaxSeconds : SongCredits.FreePreviewSeconds);
    }
}
