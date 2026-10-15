using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Choirs;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Application.Common;

/// <summary>
/// Whether an account is on Pro right now. One query in one place: the submit gate, the job poll and the
/// completion sweep all used to carry their own copy of this predicate, and three copies of "is this user
/// paying" is how one of them eventually stops agreeing with the paywall.
/// </summary>
/// <remarks>
/// Pro comes two ways: the account's own subscription, or a seat in a choir whose plan is running (the
/// director or a singer, see <see cref="ChoirAccess"/>). Every Pro check — tools, exports, harmony, grading,
/// the fast lane — reads this, so a singer is Pro everywhere the moment they join and stops being Pro
/// everywhere the moment the choir's period ends or they leave.
/// </remarks>
public static class ProStatus
{
    public static async Task<bool> IsProAsync(
        IApplicationDbContext db, IDateTimeProvider clock, Guid userId, CancellationToken ct = default)
    {
        // Own membership first: it is the common case, and it saves the choir lookup.
        if (await HasOwnProAsync(db, clock.UtcNow, userId, ct))
            return true;

        return await ChoirAccess.ActiveChoirIdAsync(db, userId, clock.UtcNow, ct) is not null;
    }

    /// <summary>Both sources of Pro, for the callers that must know which pool a song is charged to.</summary>
    public static async Task<ProAccess> ReadAsync(
        IApplicationDbContext db, IDateTimeProvider clock, Guid userId, CancellationToken ct = default)
        => new(
            await HasOwnProAsync(db, clock.UtcNow, userId, ct),
            await ChoirAccess.ActiveChoirIdAsync(db, userId, clock.UtcNow, ct));

    private static async Task<bool> HasOwnProAsync(IApplicationDbContext db, DateTime utcNow, Guid userId, CancellationToken ct)
    {
        var sub = await db.Subscriptions
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);

        return sub is not null && sub.IsActiveAt(utcNow);
    }
}

/// <summary>Where an account's Pro comes from: its own subscription, an active choir, both, or neither.</summary>
public sealed record ProAccess(bool OwnPro, Guid? ChoirId)
{
    public bool IsPro => OwnPro || ChoirId is not null;

    /// <summary>Songs a month across every pool this account may draw on: its own, then its choir's.</summary>
    public int SongAllowance =>
        (OwnPro ? SongCredits.ProMonthlyAllowance : 0) + (ChoirId is null ? 0 : SongCredits.ChoirMonthlyPool);

    /// <summary>
    /// The <see cref="Interfaces.IQuotaGate"/> keys a metered submit holds: the account's and, with a choir,
    /// the choir's, because the choir's song pool is counted across every singer in it.
    /// </summary>
    public IEnumerable<string?> GateKeys(Guid userId)
        => [QuotaGateExtensions.UserKey(userId), ChoirId is { } choirId ? ChoirAccess.GateKey(choirId) : null];
}
