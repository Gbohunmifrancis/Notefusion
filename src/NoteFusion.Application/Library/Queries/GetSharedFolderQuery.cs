using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Queries;

/// <summary>
/// A shared folder, opened by anyone with its link: the folder's name, who shared it, and every sheet
/// filed in it now, newest last, each opened through the folder's own link
/// (<see cref="GetSharedFolderSheetQuery"/>). Reading the folder gives no sheet a link of its own: a sheet
/// the owner stopped sharing stays private everywhere but here, and leaves here when it leaves the folder
/// or the folder's link is stopped.
/// </summary>
public sealed record GetSharedFolderQuery(string Token) : IRequest<Result<SharedFolderDto>>;

public sealed class GetSharedFolderQueryHandler(IApplicationDbContext db)
    : IRequestHandler<GetSharedFolderQuery, Result<SharedFolderDto>>
{
    public async Task<Result<SharedFolderDto>> Handle(GetSharedFolderQuery request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Token) || request.Token.Length > 64)
            return LibraryErrors.ShareNotFound;
        var share = await db.FolderShares.FirstOrDefaultAsync(f => f.Token == request.Token, ct);
        if (share is null)
            return LibraryErrors.ShareNotFound;

        var sheets = await db.Transcriptions.AsNoTracking()
            .Where(t => t.UserId == share.UserId && t.Folder == share.Folder)
            .OrderBy(t => t.CreatedAtUtc)
            .Select(t => new { t.Id, t.Title, t.Key, t.ShareToken })
            .ToListAsync(ct);
        share.RecordView();
        await db.SaveChangesAsync(ct);

        var owner = await db.Users.AsNoTracking().Where(u => u.Id == share.UserId).Select(u => u.FullName).FirstOrDefaultAsync(ct);
        var sharedBy = (owner ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "A NoteFusion user";
        return new SharedFolderDto(
            share.Folder,
            sharedBy,
            sheets.Select(s => new SharedFolderItemDto(s.Title, s.Key.ToString(), s.Id, s.ShareToken)).ToList());
    }
}
