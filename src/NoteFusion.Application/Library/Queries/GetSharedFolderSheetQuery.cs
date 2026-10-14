using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Queries;

/// <summary>
/// One sheet of a shared folder, opened through the folder's link. Anonymous: the folder token is the
/// credential, and it reaches only sheets its owner has filed in that folder right now.
/// </summary>
public sealed record GetSharedFolderSheetQuery(string Token, Guid SheetId) : IRequest<Result<SharedSheetDto>>;

public sealed class GetSharedFolderSheetQueryHandler(IApplicationDbContext db)
    : IRequestHandler<GetSharedFolderSheetQuery, Result<SharedSheetDto>>
{
    public async Task<Result<SharedSheetDto>> Handle(GetSharedFolderSheetQuery request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Token) || request.Token.Length > 64)
            return LibraryErrors.ShareNotFound;
        var share = await db.FolderShares.AsNoTracking().FirstOrDefaultAsync(f => f.Token == request.Token, ct);
        if (share is null)
            return LibraryErrors.ShareNotFound;

        // The same answer for a sheet that does not exist, is someone else's, or has left the folder:
        // a folder link must not confirm what else its owner keeps.
        var item = await db.Transcriptions.FirstOrDefaultAsync(
            t => t.Id == request.SheetId && t.UserId == share.UserId && t.Folder == share.Folder, ct);
        if (item is null)
            return LibraryErrors.ShareNotFound;

        // A sheet opened is a sheet seen, by whichever link it was opened.
        item.RecordShareView();
        await db.SaveChangesAsync(ct);

        var owner = await db.Users.AsNoTracking().Where(u => u.Id == item.UserId).Select(u => u.FullName).FirstOrDefaultAsync(ct);
        var sharedBy = (owner ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "A NoteFusion user";
        return SavedTranscriptionMapper.ToShared(item, sharedBy);
    }
}
