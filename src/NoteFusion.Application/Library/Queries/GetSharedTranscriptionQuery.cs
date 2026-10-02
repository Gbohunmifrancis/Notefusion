using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Queries;

/// <summary>A shared sheet by its public token. Anonymous: the link is the credential.</summary>
public sealed record GetSharedTranscriptionQuery(string Token) : IRequest<Result<SharedSheetDto>>;

public sealed class GetSharedTranscriptionQueryHandler : IRequestHandler<GetSharedTranscriptionQuery, Result<SharedSheetDto>>
{
    private readonly IApplicationDbContext _db;

    public GetSharedTranscriptionQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<SharedSheetDto>> Handle(GetSharedTranscriptionQuery request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Token) || request.Token.Length > 64)
            return LibraryErrors.ShareNotFound;

        var item = await _db.Transcriptions
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.ShareToken == request.Token, cancellationToken);
        if (item is null)
            return LibraryErrors.ShareNotFound;

        var owner = await _db.Users.AsNoTracking()
            .Where(u => u.Id == item.UserId)
            .Select(u => u.FullName)
            .FirstOrDefaultAsync(cancellationToken);
        // First name only: a link in a choir group should say who shared it, not publish a full name.
        string sharedBy = (owner ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "A NoteFusion user";

        return SavedTranscriptionMapper.ToShared(item, sharedBy);
    }
}
