using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Choirs.Commands;
using NoteFusion.Application.Choirs.Dtos;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Choirs.Queries;

/// <summary>The caller's choir, as director or singer, whether or not its plan is running.</summary>
public sealed record GetMyChoirQuery : IRequest<Result<ChoirDto>>;

public sealed class GetMyChoirQueryHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    : IRequestHandler<GetMyChoirQuery, Result<ChoirDto>>
{
    public async Task<Result<ChoirDto>> Handle(GetMyChoirQuery request, CancellationToken ct)
    {
        if (currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        var membership = await ChoirAccess.FindAsync(db, userId, clock.UtcNow, ct);
        if (membership is null)
            return ChoirErrors.NotInAChoir;

        return await ChoirAccess.ToDtoAsync(db, membership.Choir, membership.IsDirector, clock.UtcNow, ct);
    }
}

/// <summary>The director's list of singers, longest-standing first. Names only.</summary>
public sealed record GetChoirMembersQuery : IRequest<Result<IReadOnlyList<ChoirMemberDto>>>;

public sealed class GetChoirMembersQueryHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    : IRequestHandler<GetChoirMembersQuery, Result<IReadOnlyList<ChoirMemberDto>>>
{
    public async Task<Result<IReadOnlyList<ChoirMemberDto>>> Handle(GetChoirMembersQuery request, CancellationToken ct)
    {
        var directed = await ChoirDirector.FindAsync(db, currentUser, clock, ct);
        if (directed.IsFailure)
            return directed.Error;

        var choirId = directed.Value.Id;
        var rows = await (
                from m in db.ChoirMembers
                where m.ChoirId == choirId
                join u in db.Users on m.UserId equals u.Id
                select new { m.UserId, u.FullName, m.JoinedAtUtc })
            .AsNoTracking()
            .ToListAsync(ct);

        return rows
            .OrderBy(r => r.JoinedAtUtc)
            .Select(r => new ChoirMemberDto(r.UserId, r.FullName, r.JoinedAtUtc))
            .ToList();
    }
}

/// <summary>
/// The choir's shared library: every sheet its director and singers have shared with it, newest first, with
/// the opening notes a library row shows. Open only while the choir's plan runs.
/// </summary>
public sealed record GetChoirSheetsQuery : IRequest<Result<IReadOnlyList<ChoirSheetDto>>>;

public sealed class GetChoirSheetsQueryHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    : IRequestHandler<GetChoirSheetsQuery, Result<IReadOnlyList<ChoirSheetDto>>>
{
    public async Task<Result<IReadOnlyList<ChoirSheetDto>>> Handle(GetChoirSheetsQuery request, CancellationToken ct)
    {
        var library = await ChoirLibrary.OpenAsync(db, currentUser, clock, ct);
        if (library.IsFailure)
            return library.Error;

        var (membership, userId, people) = library.Value;
        var choirId = membership.Choir.Id;
        var ids = people.Keys.ToList();
        var sheets = await db.Transcriptions.AsNoTracking()
            .Where(t => t.ChoirId == choirId && ids.Contains(t.UserId))
            .OrderByDescending(t => t.CreatedAtUtc)
            .ToListAsync(ct);

        return sheets.Select(t => new ChoirSheetDto(
                t.Id,
                t.Title,
                t.Key.ToString(),
                ChoirAccess.FirstName(people[t.UserId]),
                Mine: t.UserId == userId,
                CanUnshare: t.UserId == userId || membership.IsDirector,
                t.CreatedAtUtc,
                SavedTranscriptionMapper.ToDto(t, includeNotes: false).Preview ?? []))
            .ToList();
    }
}

/// <summary>
/// One sheet of the choir's library, read-only, in the body a shared link opens with. The same answer for a
/// sheet that does not exist, is not shared with this choir, or belongs to someone who has left it.
/// </summary>
public sealed record GetChoirSheetQuery(Guid SheetId) : IRequest<Result<SharedSheetDto>>;

public sealed class GetChoirSheetQueryHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    : IRequestHandler<GetChoirSheetQuery, Result<SharedSheetDto>>
{
    public async Task<Result<SharedSheetDto>> Handle(GetChoirSheetQuery request, CancellationToken ct)
    {
        var library = await ChoirLibrary.OpenAsync(db, currentUser, clock, ct);
        if (library.IsFailure)
            return library.Error;

        var (membership, _, people) = library.Value;
        var choirId = membership.Choir.Id;
        var sheet = await db.Transcriptions.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == request.SheetId && t.ChoirId == choirId, ct);
        if (sheet is null || !people.TryGetValue(sheet.UserId, out var owner))
            return ChoirErrors.SheetNotFound;

        return SavedTranscriptionMapper.ToShared(sheet, ChoirAccess.FirstName(owner));
    }
}

/// <summary>
/// Who may read a choir's library: a director or singer of a choir whose plan is running. Hands back the
/// people in the choir now (id → full name), because only their sheets are in it — a sheet whose owner has
/// left is out, even if something failed to unshare it.
/// </summary>
internal static class ChoirLibrary
{
    public static async Task<Result<(ChoirMembership Membership, Guid UserId, Dictionary<Guid, string> People)>> OpenAsync(
        IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, CancellationToken ct)
    {
        if (currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        var membership = await ChoirAccess.FindAsync(db, userId, clock.UtcNow, ct);
        if (membership is null)
            return ChoirErrors.NotInAChoir;
        if (!membership.Choir.IsActiveAt(clock.UtcNow))
            return ChoirErrors.Inactive;

        var choir = membership.Choir;
        var memberIds = db.ChoirMembers.Where(m => m.ChoirId == choir.Id).Select(m => m.UserId);
        var people = await db.Users.AsNoTracking()
            .Where(u => u.Id == choir.OwnerId || memberIds.Contains(u.Id))
            .Select(u => new { u.Id, u.FullName })
            .ToDictionaryAsync(u => u.Id, u => u.FullName, ct);

        return (membership, userId, people);
    }
}
