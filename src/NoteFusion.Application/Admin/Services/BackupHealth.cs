using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Admin.Services;

/// <summary>A backup problem: a stable key (what the alert de-duplicates on) and the sentence shown.</summary>
public sealed record BackupProblem(string Key, string Message);

/// <summary>The console's view of the backups plus the keyed problems the alert works from.</summary>
public sealed record BackupHealthReport(BackupStatusDto Status, IReadOnlyList<BackupProblem> Problems)
{
    /// <summary>The backup service has never run here, or says a setting is missing: nothing to alert on.</summary>
    public bool IsOff => Status.Status == BackupHealth.Off;
}

/// <summary>
/// Reads the <c>backup_runs</c> rows the backup container writes (ops/backup) and decides whether the
/// backups are good enough. One place for the thresholds, so the System Health page and the alert agree.
/// </summary>
public static partial class BackupHealth
{
    public const string Healthy = "healthy";
    public const string Degraded = "degraded";
    public const string Down = "down";
    public const string Off = "off";

    /// <summary>Dumps run every 6 hours; a day without a verified one (plus two hours' grace) is an outage.</summary>
    public static readonly TimeSpan DumpMaxAge = TimeSpan.FromHours(26);

    /// <summary>A WAL segment waiting longer than this is the "WAL lag" alarm; the shipper itself judges it.</summary>
    public static readonly TimeSpan WalMaxLag = TimeSpan.FromMinutes(15);

    /// <summary>The shipper reports at least every ten minutes; silence past this means it is not running.</summary>
    public static readonly TimeSpan WalReportMaxAge = TimeSpan.FromMinutes(30);

    /// <summary>Daily jobs (base backup, files, repository check, mirror): a missed day plus margin.</summary>
    public static readonly TimeSpan DailyMaxAge = TimeSpan.FromHours(50);

    /// <summary>The restore drill is weekly; two days' grace for a delayed scheduled run.</summary>
    public static readonly TimeSpan DrillMaxAge = TimeSpan.FromDays(9);

    /// <summary>
    /// A freshly set-up service has not had its first dump yet (they run every 6 hours): "never" only
    /// becomes a problem this long after the service first said it was configured. Daily jobs get
    /// <see cref="DailyMaxAge"/> and the WAL shipper <see cref="WalReportMaxAge"/> the same way.
    /// </summary>
    public static readonly TimeSpan FirstDumpGrace = TimeSpan.FromHours(7);

    public static async Task<BackupHealthReport> ReadAsync(IApplicationDbContext db, DateTime now, CancellationToken ct)
    {
        var runs = db.BackupRuns.AsNoTracking();

        if (!await runs.AnyAsync(ct))
            return OffReport("Backups are not set up yet: no backup has run on this server (docs/BACKUP_AND_MIGRATION.md).");

        var config = await Latest(runs, BackupRunKind.Config, ct);
        var dump = await Latest(runs, BackupRunKind.Dump, ct);

        // "Missing a setting" wins until the service has done real work since saying so.
        if (config is { Ok: false } && (dump is null || dump.FinishedAtUtc < config.FinishedAtUtc))
            return OffReport(config.Detail ?? "Backups are not set up: a setting is missing.");

        // Since when this service has been running with its settings; "never ran" is judged from here.
        var since = await runs.Where(r => r.Kind == BackupRunKind.Config && r.Ok)
                        .MinAsync(r => (DateTime?)r.FinishedAtUtc, ct)
                    ?? await runs.MinAsync(r => (DateTime?)r.FinishedAtUtc, ct)
                    ?? now;
        var running = now - since;

        var verified = await runs
            .Where(r => r.Kind == BackupRunKind.Dump && r.Ok && r.Verified)
            .OrderByDescending(r => r.FinishedAtUtc)
            .FirstOrDefaultAsync(ct);
        var baseBackup = await Latest(runs, BackupRunKind.Base, ct);
        var wal = await Latest(runs, BackupRunKind.Wal, ct);
        var walArchivedAt = await runs
            .Where(r => r.Kind == BackupRunKind.Wal && r.WalArchivedAtUtc != null)
            .OrderByDescending(r => r.FinishedAtUtc)
            .Select(r => r.WalArchivedAtUtc)
            .FirstOrDefaultAsync(ct);
        var files = await Latest(runs, BackupRunKind.Files, ct);
        var check = await Latest(runs, BackupRunKind.Check, ct);
        var mirror = await Latest(runs, BackupRunKind.Mirror, ct);
        var drill = await Latest(runs, BackupRunKind.Drill, ct);

        var problems = new List<BackupProblem>();
        var dumpOverdue = verified is null
            ? running > FirstDumpGrace
            : now - verified.FinishedAtUtc > DumpMaxAge;

        if (dumpOverdue)
            problems.Add(new("dump-stale", verified is null
                ? "No verified database backup has been made yet."
                : $"No verified database backup for {Ago(now - verified.FinishedAtUtc)} (one is due every 6 hours)."));
        if (dump is { Ok: false })
            problems.Add(new("dump-failed", $"The last database backup failed {Ago(now - dump.FinishedAtUtc)} ago: {dump.Detail}"));

        if (wal is null ? running > WalReportMaxAge : now - wal.FinishedAtUtc > WalReportMaxAge)
            problems.Add(new("wal-silent", wal is null
                ? "WAL archiving has not reported yet, so point-in-time recovery is not running."
                : $"WAL archiving has not reported for {Ago(now - wal.FinishedAtUtc)}: is the backup service running?"));
        else if (!wal.Ok)
            problems.Add(new("wal-behind", $"WAL archiving is behind or interrupted: {wal.Detail}"));

        AddDaily(problems, baseBackup, "base", "base backup (point-in-time recovery)", now, running);
        AddDaily(problems, files, "files", "backup of the photos and the JWT key", now, running);
        AddDaily(problems, check, "check", "repository check", now, running);
        if (mirror is not null)
            AddDaily(problems, mirror, "mirror", "copy to the second destination", now, running);

        if (drill is { Ok: false })
            problems.Add(new("drill-failed", $"The last restore drill FAILED ({Ago(now - drill.FinishedAtUtc)} ago): {drill.Detail}"));
        else if (drill is not null && now - drill.FinishedAtUtc > DrillMaxAge)
            problems.Add(new("drill-stale", $"No restore drill for {Ago(now - drill.FinishedAtUtc)} (it runs weekly in GitHub Actions)."));

        // No verified dump yet but still within the grace: not an alert, but not "healthy" either.
        var status = dumpOverdue ? Down : problems.Count > 0 || verified is null ? Degraded : Healthy;
        var summary = verified is null
            ? "No verified database backup yet."
            : $"Last database backup {Ago(now - verified.FinishedAtUtc)} ago · {Size(verified.SizeBytes)} · verified";

        var dto = new BackupStatusDto(
            status,
            summary,
            Dto(dump),
            Dto(verified),
            Dto(baseBackup),
            walArchivedAt,
            Dto(wal),
            Dto(files),
            Dto(check),
            Dto(mirror),
            Dto(drill),
            drill?.Detail is { } d && UrlPattern().Match(d) is { Success: true } m ? m.Value : null,
            problems.Select(p => p.Message).ToList());

        return new BackupHealthReport(dto, problems);
    }

    private static void AddDaily(
        List<BackupProblem> problems, BackupRun? run, string key, string what, DateTime now, TimeSpan running)
    {
        if (run is null)
        {
            if (running > DailyMaxAge)
                problems.Add(new($"{key}-stale", $"No {what} has run yet."));
        }
        else if (!run.Ok)
            problems.Add(new($"{key}-failed", $"The last {what} failed {Ago(now - run.FinishedAtUtc)} ago: {run.Detail}"));
        else if (now - run.FinishedAtUtc > DailyMaxAge)
            problems.Add(new($"{key}-stale", $"No {what} for {Ago(now - run.FinishedAtUtc)} (it runs daily)."));
    }

    private static Task<BackupRun?> Latest(IQueryable<BackupRun> runs, string kind, CancellationToken ct)
        => runs.Where(r => r.Kind == kind).OrderByDescending(r => r.FinishedAtUtc).FirstOrDefaultAsync(ct);

    private static BackupHealthReport OffReport(string summary)
        => new(new BackupStatusDto(Off, summary, null, null, null, null, null, null, null, null, null, null, []), []);

    private static BackupRunDto? Dto(BackupRun? r)
        => r is null ? null : new BackupRunDto(r.FinishedAtUtc, r.Ok, r.SizeBytes, r.Verified, r.Detail);

    /// <summary>"40 s", "12 min", "3 h", "2 days" — the coarsest unit that still says something.</summary>
    public static string Ago(TimeSpan age)
    {
        if (age < TimeSpan.Zero) age = TimeSpan.Zero;
        if (age.TotalMinutes < 1) return $"{(int)age.TotalSeconds} s";
        if (age.TotalHours < 1) return $"{(int)age.TotalMinutes} min";
        if (age.TotalDays < 2) return $"{(int)age.TotalHours} h";
        return $"{(int)age.TotalDays} days";
    }

    /// <summary>"412 MB", "1.2 GB" (binary units, as the backup scripts print them).</summary>
    public static string Size(long? bytes)
    {
        if (bytes is not { } b) return "size unknown";
        string[] units = ["B", "KB", "MB", "GB", "TB"];
        double value = b;
        var unit = 0;
        while (value >= 1024 && unit < units.Length - 1)
        {
            value /= 1024;
            unit++;
        }
        return unit == 0 || value >= 10
            ? $"{Math.Round(value).ToString(CultureInfo.InvariantCulture)} {units[unit]}"
            : $"{value.ToString("0.#", CultureInfo.InvariantCulture)} {units[unit]}";
    }

    [GeneratedRegex(@"https://\S+")]
    private static partial Regex UrlPattern();
}
