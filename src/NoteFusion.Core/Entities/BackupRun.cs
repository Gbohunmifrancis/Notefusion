using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// One run of the backup service (<c>ops/backup</c>): a logical dump, a base backup, the files, a WAL
/// shipping report, a repository check, the mirror copy, or the weekly restore drill's result. Written by
/// the backup container through its own database role, which may only INSERT here; the API reads the rows
/// for the System Health page and the backup alert, and prunes old WAL reports.
/// </summary>
/// <remarks>
/// Not a <c>BaseEntity</c>: the id is a database identity, so a shell script can insert a row without
/// generating one. The kinds are strings rather than an enum for the same reason — the writer is psql.
/// </remarks>
public class BackupRun
{
    public const int KindMaxLength = 20;
    public const int DetailMaxLength = 2000;

    private BackupRun() { } // EF Core

    public long Id { get; private set; }

    /// <summary>One of <see cref="BackupRunKind"/>.</summary>
    public string Kind { get; private set; } = string.Empty;

    public bool Ok { get; private set; }
    public DateTime StartedAtUtc { get; private set; }
    public DateTime FinishedAtUtc { get; private set; }

    /// <summary>The dump's size, the base backup's compressed size, or the files' total; null when not measured.</summary>
    public long? SizeBytes { get; private set; }

    /// <summary>
    /// A dump: read back out of the bucket and matched its SHA-256 (after <c>pg_restore --list</c> passed).
    /// A drill: the restore passed every check.
    /// </summary>
    public bool Verified { get; private set; }

    /// <summary>A WAL report: when a segment last reached the bucket.</summary>
    public DateTime? WalArchivedAtUtc { get; private set; }

    /// <summary>What happened, in one line: the snapshot and counts, or the error.</summary>
    public string? Detail { get; private set; }

    /// <summary>For tests and seeding; production rows come from the backup container.</summary>
    public static BackupRun Record(
        string kind, bool ok, DateTime startedAtUtc, DateTime finishedAtUtc,
        long? sizeBytes = null, bool verified = false, DateTime? walArchivedAtUtc = null, string? detail = null)
        => new()
        {
            Kind = Guard.NotNullOrWhiteSpace(kind),
            Ok = ok,
            StartedAtUtc = startedAtUtc,
            FinishedAtUtc = finishedAtUtc,
            SizeBytes = sizeBytes,
            Verified = verified,
            WalArchivedAtUtc = walArchivedAtUtc,
            Detail = detail
        };
}

/// <summary>The <see cref="BackupRun.Kind"/> values the backup scripts write.</summary>
public static class BackupRunKind
{
    /// <summary>The container started; Ok=false means a setting is missing (Detail names it).</summary>
    public const string Config = "config";

    /// <summary>A logical pg_dump of the whole database, every six hours.</summary>
    public const string Dump = "dump";

    /// <summary>A wal-g base backup, daily.</summary>
    public const string Base = "base";

    /// <summary>A WAL shipping report, every ten minutes.</summary>
    public const string Wal = "wal";

    /// <summary>Photos, the JWT key, the Caddyfile and the settings list, daily.</summary>
    public const string Files = "files";

    /// <summary>Retention plus <c>restic check</c>, daily.</summary>
    public const string Check = "check";

    /// <summary>The optional copy to a second provider, daily.</summary>
    public const string Mirror = "mirror";

    /// <summary>The weekly restore drill (GitHub Actions), as it left its result in the bucket.</summary>
    public const string Drill = "drill";
}
