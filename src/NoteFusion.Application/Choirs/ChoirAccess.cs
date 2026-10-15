using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Choirs.Dtos;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Choirs;

/// <summary>Which choir an account is in, and in what role.</summary>
public sealed record ChoirMembership(Choir Choir, bool IsDirector);

/// <summary>
/// The choir lookups every choir handler and the Pro check share. An account is in at most one choir: as
/// its director (<see cref="Choir.OwnerId"/>) or as a singer (one <see cref="ChoirMember"/> row, held unique
/// by the database).
/// </summary>
public static class ChoirAccess
{
    public const string DirectorRole = "director";
    public const string MemberRole = "member";

    /// <summary>The <see cref="IQuotaGate"/> key for one choir: its seats and its song pool are counted under it.</summary>
    public static string GateKey(Guid choirId) => $"choir:{choirId}";

    /// <summary>
    /// The choir whose plan is running that <paramref name="userId"/> directs or sings in, or null. Two
    /// indexed lookups (owner, then membership), no cache, like the subscription read beside it in
    /// <see cref="ProStatus"/>.
    /// </summary>
    public static async Task<Guid?> ActiveChoirIdAsync(
        IApplicationDbContext db, Guid userId, DateTime utcNow, CancellationToken ct = default)
    {
        var owned = await db.Choirs
            .Where(c => c.OwnerId == userId && c.CurrentPeriodEndUtc > utcNow)
            .Select(c => (Guid?)c.Id)
            .FirstOrDefaultAsync(ct);
        if (owned is not null)
            return owned;

        return await (
                from m in db.ChoirMembers
                where m.UserId == userId
                join c in db.Choirs on m.ChoirId equals c.Id
                where c.CurrentPeriodEndUtc > utcNow
                select (Guid?)c.Id)
            .FirstOrDefaultAsync(ct);
    }

    /// <summary>
    /// The choir <paramref name="userId"/> belongs to, whether or not its plan is running: a director keeps
    /// their choir (to rename it, see its singers, renew it) after it lapses. A director of a lapsed choir who
    /// has since joined another is that other choir's singer.
    /// </summary>
    public static async Task<ChoirMembership?> FindAsync(
        IApplicationDbContext db, Guid userId, DateTime utcNow, CancellationToken ct = default)
    {
        var owned = await db.Choirs.FirstOrDefaultAsync(c => c.OwnerId == userId, ct);
        if (owned is not null && owned.IsActiveAt(utcNow))
            return new ChoirMembership(owned, IsDirector: true);

        var joined = await (
                from m in db.ChoirMembers
                where m.UserId == userId
                join c in db.Choirs on m.ChoirId equals c.Id
                select c)
            .FirstOrDefaultAsync(ct);
        if (joined is not null)
            return new ChoirMembership(joined, IsDirector: false);

        return owned is null ? null : new ChoirMembership(owned, IsDirector: true);
    }

    /// <summary>
    /// Takes a singer out of their choir: the seat is freed and every sheet they had shared with the choir
    /// leaves its library (it stays in their own). Staged; the caller saves.
    /// </summary>
    public static async Task DetachAsync(IApplicationDbContext db, ChoirMember member, CancellationToken ct)
    {
        var shared = await db.Transcriptions
            .Where(t => t.UserId == member.UserId && t.ChoirId == member.ChoirId)
            .ToListAsync(ct);
        foreach (var sheet in shared)
            sheet.UnshareFromChoir();

        db.ChoirMembers.Remove(member);
    }

    /// <summary>
    /// A fresh invite code: <see cref="Choir.InviteCodeLength"/> characters from an alphabet with no look-alikes
    /// (no 0/O, 1/I/L), so a code read aloud at rehearsal is typed right. About 40 bits; the join route is
    /// rate-limited like a sign-in, so guessing one is not a way in.
    /// </summary>
    public static string NewInviteCode()
    {
        const string alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        Span<char> code = stackalloc char[Choir.InviteCodeLength];
        for (var i = 0; i < code.Length; i++)
            code[i] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
        return new string(code);
    }

    /// <summary>A typed or pasted code, upper-cased with spaces and dashes taken out; null when it cannot be one.</summary>
    public static string? NormaliseCode(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
            return null;

        var code = new string([.. input.Where(char.IsLetterOrDigit)]).ToUpperInvariant();
        return code.Length == Choir.InviteCodeLength ? code : null;
    }

    /// <summary>The choir as <paramref name="viewerIsDirector"/>'s side sees it; the invite code is the director's alone.</summary>
    public static async Task<ChoirDto> ToDtoAsync(
        IApplicationDbContext db, Choir choir, bool viewerIsDirector, DateTime utcNow, CancellationToken ct)
    {
        var plan = await db.Plans.AsNoTracking()
            .Where(p => p.Id == choir.PlanId)
            .Select(p => new { p.Code, p.Name })
            .FirstOrDefaultAsync(ct);
        var director = await db.Users.AsNoTracking()
            .Where(u => u.Id == choir.OwnerId)
            .Select(u => u.FullName)
            .FirstOrDefaultAsync(ct);
        var seatsUsed = await db.ChoirMembers.CountAsync(m => m.ChoirId == choir.Id, ct);
        var songsHeld = await SongCredits.CountChoirHeldThisMonthAsync(db, choir.Id, utcNow, ct);
        var active = choir.IsActiveAt(utcNow);

        return new ChoirDto(
            choir.Id,
            choir.Name,
            viewerIsDirector ? DirectorRole : MemberRole,
            active,
            choir.CurrentPeriodEndUtc,
            plan?.Code,
            plan?.Name,
            FirstName(director),
            viewerIsDirector ? choir.InviteCode : null,
            seatsUsed,
            choir.Seats,
            active ? Math.Max(0, SongCredits.ChoirMonthlyPool - songsHeld) : 0,
            SongCredits.ChoirMonthlyPool);
    }

    /// <summary>First name only, as the shared-sheet pages name who shared a sheet.</summary>
    public static string FirstName(string? fullName)
        => (fullName ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()
           ?? "A NoteFusion user";
}
