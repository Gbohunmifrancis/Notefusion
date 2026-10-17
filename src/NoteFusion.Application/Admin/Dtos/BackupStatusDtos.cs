namespace NoteFusion.Application.Admin.Dtos;

/// <summary>One backup run as the console shows it.</summary>
public sealed record BackupRunDto(DateTime FinishedAtUtc, bool Ok, long? SizeBytes, bool Verified, string? Detail);

/// <summary>
/// What the backup service has done lately and whether that is enough (docs/BACKUP_AND_MIGRATION.md).
/// Read from the <c>backup_runs</c> rows the backup container writes; nothing here is probed live.
/// </summary>
/// <param name="Status">
/// <c>healthy</c>; <c>degraded</c> (something is late or failed, but a verified dump exists from the last
/// 26 hours); <c>down</c> (no verified dump in 26 hours); or <c>off</c> (the backup service has never run,
/// or says a setting is missing — <see cref="Summary"/> names it).
/// </param>
/// <param name="Summary">One line: "Last database backup 3 h ago · 412 MB · verified", or what is wrong.</param>
/// <param name="LastVerifiedDump">The newest dump that was read back from the bucket and matched.</param>
/// <param name="WalArchivedAtUtc">When a WAL segment last reached the bucket (point-in-time recovery's edge).</param>
/// <param name="DrillUrl">The GitHub run of the latest restore drill, when it left one.</param>
/// <param name="Problems">Plain sentences, worst first; empty when healthy. The same list the alert sends.</param>
public sealed record BackupStatusDto(
    string Status,
    string Summary,
    BackupRunDto? LastDump,
    BackupRunDto? LastVerifiedDump,
    BackupRunDto? LastBaseBackup,
    DateTime? WalArchivedAtUtc,
    BackupRunDto? LastWalReport,
    BackupRunDto? LastFiles,
    BackupRunDto? LastCheck,
    BackupRunDto? LastMirror,
    BackupRunDto? LastDrill,
    string? DrillUrl,
    IReadOnlyList<string> Problems);
