namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// What the database itself can say about its own state — deliberately not exposed through
/// <see cref="IApplicationDbContext"/>, which stays a set of <c>DbSet</c>s so no handler can reach
/// <c>Database</c> and start issuing raw SQL or opening transactions of its own.
/// </summary>
public interface IDatabaseHealth
{
    /// <summary>
    /// Round-trips a trivial query and reports how long it took, or an error when the connection could
    /// not be made at all.
    /// </summary>
    Task<DatabaseHealth> CheckAsync(CancellationToken ct = default);
}

/// <summary>
/// The database's answer to a health probe.
/// </summary>
/// <param name="LatencyMs">
/// Round-trip time of one trivial query, or null when the probe failed — a failed probe has no latency,
/// and reporting the time spent failing as a latency figure would make an outage look like a slow query.
/// </param>
/// <param name="PendingMigrations">
/// Migrations in the assembly that this database has not applied. Non-zero after a deploy where the code
/// shipped but the migration did not, which is the state that produces "column does not exist" in
/// production and nowhere else — so it is worth a number on the dashboard.
/// </param>
/// <param name="Error">Why the probe failed, or null when it succeeded.</param>
public sealed record DatabaseHealth(int? LatencyMs, int PendingMigrations, string? Error)
{
    public bool IsReachable => Error is null;
}
