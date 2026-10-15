using Microsoft.EntityFrameworkCore;

namespace NoteFusion.Infrastructure.Persistence;

/// <summary>
/// Fills <c>users.CanonicalEmail</c> on rows made before the column existed, in C# so the backfill applies
/// exactly the rule new accounts get (<see cref="Core.ValueObjects.Mailbox.Canonical"/>) rather than a SQL
/// copy of it that could drift. Run at startup, after migrations; a no-op once every row has one.
/// </summary>
public static class CanonicalEmailBackfill
{
    public const int BatchSize = 500;

    /// <summary>Returns how many rows were filled.</summary>
    public static async Task<int> RunAsync(ApplicationDbContext db, CancellationToken ct = default)
    {
        var filled = 0;
        while (true)
        {
            // Every row taken gets a non-null value, so each pass shrinks the set and the loop ends.
            var batch = await db.Users
                .Where(u => u.CanonicalEmail == null)
                .OrderBy(u => u.Id)
                .Take(BatchSize)
                .ToListAsync(ct);
            if (batch.Count == 0)
                return filled;

            foreach (var user in batch)
                user.RefreshCanonicalEmail();

            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
            filled += batch.Count;
        }
    }
}
