using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Choirs.Dtos;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Choirs.Commands;

/// <summary>
/// A signed-in account joins a choir with its invite code and is Pro from that moment. Refused when the
/// code matches no choir, the choir's plan has ended, every seat is taken, or the account is already in a
/// choir (as a singer, or as the director of one whose plan is running). Joining the choir one is already
/// in answers with the choir, so a second tap on the same invite link is harmless.
/// </summary>
public sealed record JoinChoirCommand(string? Code) : IRequest<Result<ChoirDto>>;

public sealed class JoinChoirCommandHandler(
    IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, IQuotaGate gate)
    : IRequestHandler<JoinChoirCommand, Result<ChoirDto>>
{
    public async Task<Result<ChoirDto>> Handle(JoinChoirCommand request, CancellationToken ct)
    {
        if (currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        if (ChoirAccess.NormaliseCode(request.Code) is not { } code)
            return ChoirErrors.InviteNotFound;

        var choir = await db.Choirs.FirstOrDefaultAsync(c => c.InviteCode == code, ct);
        if (choir is null)
            return ChoirErrors.InviteNotFound;

        var now = clock.UtcNow;
        if (choir.OwnerId == userId)
            return ChoirErrors.OwnChoir;

        // The seat count and this account's one-choir rule are both checked and written under these leases,
        // so two singers taking the last seat at once, or one account joining two choirs at once, cannot both
        // land. The unique index on ChoirMember.UserId holds the second rule in the database as well.
        await using var lease = await gate.AcquireAllAsync(
            [QuotaGateExtensions.UserKey(userId), ChoirAccess.GateKey(choir.Id)], ct);

        var existing = await db.ChoirMembers.FirstOrDefaultAsync(m => m.UserId == userId, ct);
        if (existing is not null)
        {
            return existing.ChoirId == choir.Id
                ? await ChoirAccess.ToDtoAsync(db, choir, viewerIsDirector: false, now, ct)
                : ChoirErrors.AlreadyInAChoir;
        }

        if (!choir.IsActiveAt(now))
            return ChoirErrors.Inactive;

        if (await db.Choirs.AnyAsync(c => c.OwnerId == userId && c.CurrentPeriodEndUtc > now, ct))
            return ChoirErrors.LeadsAChoir;

        var seatsUsed = await db.ChoirMembers.CountAsync(m => m.ChoirId == choir.Id, ct);
        if (seatsUsed >= choir.Seats)
            return ChoirErrors.Full(choir.Seats);

        db.ChoirMembers.Add(ChoirMember.Create(choir.Id, userId, now));
        await db.SaveChangesAsync(ct);

        return await ChoirAccess.ToDtoAsync(db, choir, viewerIsDirector: false, now, ct);
    }
}

/// <summary>
/// A singer leaves their choir. Their seat is freed, they stop being Pro through it, and the sheets they
/// shared leave the choir's library (they stay in the singer's own). The director cannot leave.
/// </summary>
public sealed record LeaveChoirCommand : IRequest<Result>;

public sealed class LeaveChoirCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    : IRequestHandler<LeaveChoirCommand, Result>
{
    public async Task<Result> Handle(LeaveChoirCommand request, CancellationToken ct)
    {
        if (currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        var membership = await ChoirAccess.FindAsync(db, userId, clock.UtcNow, ct);
        if (membership is null)
            return ChoirErrors.NotInAChoir;
        if (membership.IsDirector)
            return ChoirErrors.DirectorCannotLeave;

        var row = await db.ChoirMembers.FirstAsync(m => m.UserId == userId, ct);
        await ChoirAccess.DetachAsync(db, row, ct);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }
}

/// <summary>The director takes a singer out of the choir; the same effects as the singer leaving.</summary>
public sealed record RemoveChoirMemberCommand(Guid UserId) : IRequest<Result>;

public sealed class RemoveChoirMemberCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    : IRequestHandler<RemoveChoirMemberCommand, Result>
{
    public async Task<Result> Handle(RemoveChoirMemberCommand request, CancellationToken ct)
    {
        var directed = await ChoirDirector.FindAsync(db, currentUser, clock, ct);
        if (directed.IsFailure)
            return directed.Error;

        var row = await db.ChoirMembers.FirstOrDefaultAsync(
            m => m.ChoirId == directed.Value.Id && m.UserId == request.UserId, ct);
        if (row is null)
            return ChoirErrors.MemberNotFound;

        await ChoirAccess.DetachAsync(db, row, ct);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }
}

/// <summary>The director renames the choir.</summary>
public sealed record RenameChoirCommand(string? Name) : IRequest<Result<ChoirDto>>;

public sealed class RenameChoirCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    : IRequestHandler<RenameChoirCommand, Result<ChoirDto>>
{
    public async Task<Result<ChoirDto>> Handle(RenameChoirCommand request, CancellationToken ct)
    {
        var name = request.Name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > Choir.NameMaxLength)
            return ChoirErrors.InvalidName;

        var directed = await ChoirDirector.FindAsync(db, currentUser, clock, ct);
        if (directed.IsFailure)
            return directed.Error;

        var choir = directed.Value;
        choir.Rename(name, clock.UtcNow);
        await db.SaveChangesAsync(ct);
        return await ChoirAccess.ToDtoAsync(db, choir, viewerIsDirector: true, clock.UtcNow, ct);
    }
}

/// <summary>
/// The director makes a new invite code; the old one stops working at once (a link that went further than
/// the choir). Singers already in stay in.
/// </summary>
public sealed record RegenerateChoirInviteCommand : IRequest<Result<ChoirDto>>;

public sealed class RegenerateChoirInviteCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    : IRequestHandler<RegenerateChoirInviteCommand, Result<ChoirDto>>
{
    public async Task<Result<ChoirDto>> Handle(RegenerateChoirInviteCommand request, CancellationToken ct)
    {
        var directed = await ChoirDirector.FindAsync(db, currentUser, clock, ct);
        if (directed.IsFailure)
            return directed.Error;

        var choir = directed.Value;
        choir.ReplaceInviteCode(ChoirAccess.NewInviteCode(), clock.UtcNow);
        await db.SaveChangesAsync(ct);
        return await ChoirAccess.ToDtoAsync(db, choir, viewerIsDirector: true, clock.UtcNow, ct);
    }
}

/// <summary>The one check every director-only handler makes: the caller directs a choir, active or not.</summary>
internal static class ChoirDirector
{
    public static async Task<Result<Choir>> FindAsync(
        IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, CancellationToken ct)
    {
        if (currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        var membership = await ChoirAccess.FindAsync(db, userId, clock.UtcNow, ct);
        if (membership is null)
            return ChoirErrors.NotInAChoir;
        if (!membership.IsDirector)
            return ChoirErrors.DirectorOnly;

        return membership.Choir;
    }
}
