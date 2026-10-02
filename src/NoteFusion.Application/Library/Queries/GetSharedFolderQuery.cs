using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Queries;

/// <summary>
/// A shared folder, opened by anyone with its link: the folder's name, who shared it, and every sheet
/// filed in it now, newest last. A sheet filed after the link was made is shared on this read, since
/// sharing the folder is sharing what is in it.
/// </summary>
public sealed record GetSharedFolderQuery(string Token) : IRequest<Result<SharedFolderDto>>;

public sealed class GetSharedFolderQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    : IRequestHandler<GetSharedFolderQuery, Result<SharedFolderDto>>
{
    public async Task<Result<SharedFolderDto>> Handle(GetSharedFolderQuery request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Token) || request.Token.Length > 64)
            return LibraryErrors.ShareNotFound;
        var share = await db.FolderShares.FirstOrDefaultAsync(f => f.Token == request.Token, ct);
        if (share is null)
            return LibraryErrors.ShareNotFound;

        var sheets = await db.Transcriptions
            .Where(t => t.UserId == share.UserId && t.Folder == share.Folder)
            .OrderBy(t => t.CreatedAtUtc)
            .ToListAsync(ct);
        var now = clock.UtcNow;
        foreach (var sheet in sheets.Where(s => s.ShareToken is null))
            sheet.Share(ShareTokens.New(), now);
        share.RecordView();
        await db.SaveChangesAsync(ct);

        var owner = await db.Users.AsNoTracking().Where(u => u.Id == share.UserId).Select(u => u.FullName).FirstOrDefaultAsync(ct);
        var sharedBy = (owner ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "A NoteFusion user";
        return new SharedFolderDto(
            share.Folder,
            sharedBy,
            sheets.Select(s => new SharedFolderItemDto(s.Title, s.Key.ToString(), s.ShareToken!)).ToList());
    }
}
