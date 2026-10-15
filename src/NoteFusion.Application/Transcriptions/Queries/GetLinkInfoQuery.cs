using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Queries;

/// <summary>
/// What a pasted song link points at, with how much of it this account may transcribe in one go — Pro's
/// <see cref="SongCredits.ProMaxSeconds"/> (also a free account's with a bought transcription left), a free
/// account's <see cref="SongCredits.FreePreviewSeconds"/> otherwise —
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
    private readonly IDeviceFingerprint _device;

    public GetLinkInfoQueryHandler(
        ITranscriptionApi api, IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock,
        IDeviceFingerprint device)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _device = device;
    }

    public async Task<Result<LinkInfoDto>> Handle(GetLinkInfoQuery request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;
        if (!SongLinks.TryExtract(request.Url, out var url))
            return TranscriptionErrors.InvalidLink;

        // The whole song for Pro and for a free account with a bought transcription left (which the submit
        // will spend on it); the preview's minute otherwise.
        var wholeSong = await ProStatus.IsProAsync(_db, _clock, userId, ct);
        if (!wholeSong)
        {
            var country = await _db.Users.Where(u => u.Id == userId).Select(u => u.Country).FirstOrDefaultAsync(ct);
            wholeSong = (await TrialUsage.ReadAsync(_db, userId, _device.Current, country, _clock.UtcNow, ct)).BoughtRemaining > 0;
        }

        var resolved = await _api.ResolveLinkAsync(url, ct);
        return resolved.IsFailure
            ? Result.Failure<LinkInfoDto>(resolved.Error)
            : LinkInfoDto.From(resolved.Value, wholeSong ? SongCredits.ProMaxSeconds : SongCredits.FreePreviewSeconds);
    }
}
