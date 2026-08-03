using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Queries;

/// <summary>Lists the current user's saved transcriptions, newest first.</summary>
public sealed record GetLibraryQuery : IRequest<Result<IReadOnlyList<SavedTranscriptionDto>>>;

public sealed class GetLibraryQueryHandler : IRequestHandler<GetLibraryQuery, Result<IReadOnlyList<SavedTranscriptionDto>>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public GetLibraryQueryHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<IReadOnlyList<SavedTranscriptionDto>>> Handle(GetLibraryQuery request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var items = await _db.Transcriptions
            .AsNoTracking()
            .Where(t => t.UserId == userId)
            .OrderByDescending(t => t.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        return items.Select(t => SavedTranscriptionMapper.ToDto(t, includeNotes: false)).ToList();
    }
}
