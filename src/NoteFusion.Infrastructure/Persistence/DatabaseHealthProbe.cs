using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Persistence;

/// <summary>
/// Probes the database through the same context and connection pool the request path uses, so the number
/// on the dashboard is the latency real work sees rather than a fresh connection's best case.
/// </summary>
internal sealed class DatabaseHealthProbe : IDatabaseHealth
{
    private readonly ApplicationDbContext _db;

    public DatabaseHealthProbe(ApplicationDbContext db) => _db = db;

    public async Task<DatabaseHealth> CheckAsync(CancellationToken ct = default)
    {
        var stopwatch = Stopwatch.StartNew();

        try
        {
            // CanConnectAsync rather than a SELECT of our own: it is the provider's own trivial probe, and
            // it does not depend on any table existing — which matters, because a database that is up but
            // un-migrated is exactly one of the states this is here to distinguish.
            if (!await _db.Database.CanConnectAsync(ct))
                return new DatabaseHealth(null, 0, "The database refused the connection.");

            var latency = (int)stopwatch.ElapsedMilliseconds;
            var pending = (await _db.Database.GetPendingMigrationsAsync(ct)).Count();

            return new DatabaseHealth(latency, pending, null);
        }
        catch (OperationCanceledException)
        {
            // The caller gave up, which is not a verdict on the database.
            throw;
        }
        catch (Exception ex)
        {
            // Every failure mode is one panel reading "unreachable" rather than a 500 that takes the whole
            // health page down with it — a dashboard that cannot load is no use during an incident.
            // The message is shown to an operator behind the admin policy, so it stays as it is: the
            // provider's own text is what makes a bad password distinguishable from a firewall.
            return new DatabaseHealth(null, 0, ex.Message);
        }
    }
}
