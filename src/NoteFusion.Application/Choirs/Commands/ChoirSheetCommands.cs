using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Choirs.Commands;

/// <summary>
/// Puts one of the caller's own saved sheets in their choir's shared library, where every singer in the
/// choir can open it read-only. Idempotent. Needs a choir whose plan is running.
/// </summary>
public sealed record ShareSheetWithChoirCommand(Guid SheetId) : IRequest<Result>;

public sealed class ShareSheetWithChoirCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    : IRequestHandler<ShareSheetWithChoirCommand, Result>
{
    public async Task<Result> Handle(ShareSheetWithChoirCommand request, CancellationToken ct)
    {
        if (currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        var sheet = await db.Transcriptions.FirstOrDefaultAsync(t => t.Id == request.SheetId, ct);
        if (sheet is null)
            return LibraryErrors.NotFound;
        if (sheet.UserId != userId)
            return LibraryErrors.NotOwnedByUser;

        var membership = await ChoirAccess.FindAsync(db, userId, clock.UtcNow, ct);
        if (membership is null)
            return ChoirErrors.NotInAChoir;
        if (!membership.Choir.IsActiveAt(clock.UtcNow))
            return ChoirErrors.Inactive;

        if (sheet.ChoirId != membership.Choir.Id)
        {
            sheet.ShareWithChoir(membership.Choir.Id);
            await db.SaveChangesAsync(ct);
        }
        return Result.Success();
    }
}

/// <summary>
/// Takes a sheet out of the choir's library. The singer who shared it may, always; the director may take any
/// sheet out of their choir's library. The sheet itself is untouched.
/// </summary>
public sealed record UnshareSheetFromChoirCommand(Guid SheetId) : IRequest<Result>;

public sealed class UnshareSheetFromChoirCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    : IRequestHandler<UnshareSheetFromChoirCommand, Result>
{
    public async Task<Result> Handle(UnshareSheetFromChoirCommand request, CancellationToken ct)
    {
        if (currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        var sheet = await db.Transcriptions.FirstOrDefaultAsync(t => t.Id == request.SheetId, ct);
        if (sheet is null)
            return LibraryErrors.NotFound;

        if (sheet.UserId != userId)
        {
            // Someone else's sheet: only the director of the choir it is shared with may take it out, and to
            // anyone else it is simply not there.
            var membership = await ChoirAccess.FindAsync(db, userId, clock.UtcNow, ct);
            if (sheet.ChoirId is null || membership is null || membership.Choir.Id != sheet.ChoirId)
                return ChoirErrors.SheetNotFound;
            if (!membership.IsDirector)
                return ChoirErrors.DirectorOnly;
        }

        if (sheet.ChoirId is not null)
        {
            sheet.UnshareFromChoir();
            await db.SaveChangesAsync(ct);
        }
        return Result.Success();
    }
}
