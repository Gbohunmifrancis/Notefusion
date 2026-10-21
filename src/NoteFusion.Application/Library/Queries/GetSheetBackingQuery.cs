using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Queries;

/// <summary>
/// The backing kept with a saved sheet (an MP3 of the song's instrumental), for its owner alone: a choir member or
/// someone holding a shared link reads the sheet elsewhere and never gets the audio. <see cref="LibraryErrors.BackingNotFound"/>
/// for a sheet that keeps none, has gone, or is someone else's — the same answer for each.
/// </summary>
public sealed record GetSheetBackingQuery(Guid Id) : IRequest<Result<byte[]>>;

public sealed class GetSheetBackingQueryHandler(IApplicationDbContext db, ICurrentUser currentUser, IBackingStorage backing)
    : IRequestHandler<GetSheetBackingQuery, Result<byte[]>>
{
    public async Task<Result<byte[]>> Handle(GetSheetBackingQuery request, CancellationToken ct)
    {
        if (currentUser.UserId is not { } userId)
            return LibraryErrors.BackingNotFound;

        var key = await db.Transcriptions.AsNoTracking()
            .Where(t => t.Id == request.Id && t.UserId == userId)
            .Select(t => t.BackingKey)
            .FirstOrDefaultAsync(ct);

        return key is null ? LibraryErrors.BackingNotFound : await backing.ReadAsync(key, ct);
    }
}
