using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Application.Common;

/// <summary>
/// Whether an account is on Pro right now. One query in one place: the submit gate, the job poll and the
/// completion sweep all used to carry their own copy of this predicate, and three copies of "is this user
/// paying" is how one of them eventually stops agreeing with the paywall.
/// </summary>
public static class ProStatus
{
    public static async Task<bool> IsProAsync(
        IApplicationDbContext db, IDateTimeProvider clock, Guid userId, CancellationToken ct = default)
    {
        var sub = await db.Subscriptions
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);

        return sub is not null && sub.IsActiveAt(clock.UtcNow);
    }
}
