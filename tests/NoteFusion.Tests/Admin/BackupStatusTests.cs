using NoteFusion.Application.Admin.Commands;
using NoteFusion.Application.Admin.Services;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

/// <summary>
/// The backups as the console and the alert see them: read from the rows the backup container writes
/// (ops/backup). The rules that matter: a day without a verified dump is "down"; WAL that is behind or
/// silent, a late or failed daily job, or a failed restore drill is "degraded"; nothing at all, or a
/// missing setting, is "off" and never alerts.
/// </summary>
public class BackupStatusTests
{
    private static readonly DateTime Now = new(2026, 10, 17, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task With_no_backup_rows_the_backups_are_off_and_say_how_to_set_them_up()
    {
        using var h = new TestHarness(Now);

        var report = await BackupHealth.ReadAsync(h.Db, Now, CancellationToken.None);

        Assert.Equal("off", report.Status.Status);
        Assert.Contains("not set up", report.Status.Summary);
        Assert.Empty(report.Problems);
    }

    [Fact]
    public async Task A_missing_setting_reported_by_the_container_is_off_and_names_the_setting()
    {
        using var h = new TestHarness(Now);
        Add(h, BackupRun.Record("config", false, Now.AddMinutes(-5), Now.AddMinutes(-5),
            detail: "Backups are not set up: missing BACKUP_ENCRYPTION_PASSWORD"));

        var report = await BackupHealth.ReadAsync(h.Db, Now, CancellationToken.None);

        Assert.Equal("off", report.Status.Status);
        Assert.Contains("BACKUP_ENCRYPTION_PASSWORD", report.Status.Summary);
    }

    [Fact]
    public async Task A_service_set_up_an_hour_ago_is_not_yet_a_problem_but_not_healthy_either()
    {
        using var h = new TestHarness(Now);
        Admin(h);
        Add(h, BackupRun.Record("config", true, Now.AddHours(-1), Now.AddHours(-1)));
        Add(h, BackupRun.Record("wal", true, Now.AddMinutes(-3), Now.AddMinutes(-3), walArchivedAtUtc: Now.AddMinutes(-3)));

        var report = await BackupHealth.ReadAsync(h.Db, Now, CancellationToken.None);
        Assert.Equal("degraded", report.Status.Status);
        Assert.Empty(report.Problems);
        Assert.Equal("No verified database backup yet.", report.Status.Summary);

        await Alert(h, null);
        Assert.Empty(h.Push.Sent);

        // Eight hours on with still no dump: now it is.
        var later = await BackupHealth.ReadAsync(h.Db, Now.AddHours(8), CancellationToken.None);
        Assert.Equal("down", later.Status.Status);
        Assert.Contains(later.Problems, p => p.Key == "dump-stale");
    }

    [Fact]
    public async Task Everything_recent_and_verified_is_healthy_with_the_console_summary()
    {
        using var h = new TestHarness(Now);
        AllHealthy(h);

        var report = await BackupHealth.ReadAsync(h.Db, Now, CancellationToken.None);

        Assert.Equal("healthy", report.Status.Status);
        Assert.Empty(report.Problems);
        Assert.Equal("Last database backup 3 h ago · 412 MB · verified", report.Status.Summary);
        Assert.Equal(Now.AddSeconds(-40), report.Status.WalArchivedAtUtc);
        Assert.Equal("https://github.com/o/r/actions/runs/7", report.Status.DrillUrl);
    }

    [Fact]
    public async Task No_verified_dump_for_26_hours_is_down_even_if_a_later_one_failed()
    {
        using var h = new TestHarness(Now);
        AllHealthy(h, dumpAge: TimeSpan.FromHours(27));
        Add(h, BackupRun.Record("dump", false, Now.AddHours(-1), Now.AddHours(-1), detail: "pg_dump failed"));

        var report = await BackupHealth.ReadAsync(h.Db, Now, CancellationToken.None);

        Assert.Equal("down", report.Status.Status);
        Assert.Contains(report.Problems, p => p.Key == "dump-stale");
        Assert.Contains(report.Problems, p => p.Key == "dump-failed" && p.Message.Contains("pg_dump failed"));
    }

    [Fact]
    public async Task An_unverified_dump_does_not_count_as_a_backup()
    {
        using var h = new TestHarness(Now);
        AllHealthy(h, dumpAge: TimeSpan.FromHours(30));
        Add(h, BackupRun.Record("dump", true, Now.AddHours(-1), Now.AddHours(-1), 100, verified: false));

        var report = await BackupHealth.ReadAsync(h.Db, Now, CancellationToken.None);

        Assert.Equal("down", report.Status.Status);
    }

    [Fact]
    public async Task Wal_behind_is_degraded_and_a_silent_shipper_is_called_out()
    {
        using var h = new TestHarness(Now);
        AllHealthy(h);
        Add(h, BackupRun.Record("wal", false, Now.AddMinutes(-1), Now.AddMinutes(-1),
            walArchivedAtUtc: Now.AddMinutes(-20), detail: "12 waiting · oldest 1200s"));

        var behind = await BackupHealth.ReadAsync(h.Db, Now, CancellationToken.None);
        Assert.Equal("degraded", behind.Status.Status);
        Assert.Contains(behind.Problems, p => p.Key == "wal-behind");

        var silent = await BackupHealth.ReadAsync(h.Db, Now.AddMinutes(45), CancellationToken.None);
        Assert.Contains(silent.Problems, p => p.Key == "wal-silent" && p.Message.Contains("is the backup service running"));
    }

    [Fact]
    public async Task A_failed_restore_drill_and_a_late_base_backup_are_problems()
    {
        using var h = new TestHarness(Now);
        AllHealthy(h, baseAge: TimeSpan.FromHours(60));
        Add(h, BackupRun.Record("drill", false, Now.AddHours(-2), Now.AddHours(-1), detail: "row counts differ · https://github.com/o/r/actions/runs/8"));

        var report = await BackupHealth.ReadAsync(h.Db, Now, CancellationToken.None);

        Assert.Equal("degraded", report.Status.Status);
        Assert.Contains(report.Problems, p => p.Key == "drill-failed");
        Assert.Contains(report.Problems, p => p.Key == "base-stale");
        Assert.Equal("https://github.com/o/r/actions/runs/8", report.Status.DrillUrl);
    }

    // ------------------------------------------------------------------ alert

    [Fact]
    public async Task The_alert_stays_silent_while_backups_are_not_set_up()
    {
        using var h = new TestHarness(Now);
        Admin(h);

        var state = await Alert(h, null);

        Assert.Empty(h.Push.Sent);
        Assert.Empty(h.Email.CustomEmails);
        Assert.Empty(state.Keys);
    }

    [Fact]
    public async Task A_problem_pushes_and_emails_every_admin_once_then_again_a_day_later()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        AllHealthy(h, dumpAge: TimeSpan.FromHours(30));

        var first = await Alert(h, null);
        var (recipients, push) = Assert.Single(h.Push.Sent);
        Assert.Equal([admin.Id], recipients);
        Assert.Equal("Backups need attention", push.Title);
        var email = Assert.Single(h.Email.CustomEmails);
        Assert.Equal(admin.Email, email.To.Email);
        Assert.Contains("No verified database backup for 30 h", email.BodyHtml);
        Assert.Equal("https://admin.notefusion.studio/health", email.CtaUrl);

        // Same problem a quarter of an hour later: quiet.
        h.Clock.UtcNow = h.Clock.UtcNow.AddMinutes(15);
        var second = await Alert(h, first);
        Assert.Single(h.Push.Sent);

        // Still open a day later: said again.
        h.Clock.UtcNow = h.Clock.UtcNow.AddHours(24);
        await Alert(h, second);
        Assert.Equal(2, h.Push.Sent.Count);
        Assert.Equal(2, h.Email.CustomEmails.Count);
    }

    [Fact]
    public async Task A_new_problem_is_reported_at_once_and_recovery_is_announced_by_push()
    {
        using var h = new TestHarness(Now);
        Admin(h);
        AllHealthy(h, baseAge: TimeSpan.FromHours(60));

        var first = await Alert(h, null);
        Assert.Single(h.Push.Sent);

        h.Clock.UtcNow = h.Clock.UtcNow.AddMinutes(15);
        Add(h, BackupRun.Record("wal", false, h.Clock.UtcNow, h.Clock.UtcNow, detail: "error"));
        var second = await Alert(h, first);
        Assert.Equal(2, h.Push.Sent.Count);

        // Everything put right: one push, no email.
        h.Clock.UtcNow = h.Clock.UtcNow.AddMinutes(15);
        var t = h.Clock.UtcNow;
        Add(h, BackupRun.Record("base", true, t, t, 1000));
        Add(h, BackupRun.Record("wal", true, t, t, walArchivedAtUtc: t));
        var third = await Alert(h, second);
        Assert.Equal(3, h.Push.Sent.Count);
        Assert.Equal("Backups are healthy again", h.Push.Sent[^1].Message.Title);
        Assert.Equal(2, h.Email.CustomEmails.Count);
        Assert.Empty(third.Keys);
    }

    // --------------------------------------------------------------- helpers

    private static async Task<BackupAlertState> Alert(TestHarness h, BackupAlertState? last)
    {
        var result = await new NotifyAdminsOfBackupProblemsCommandHandler(
                h.Db, h.Clock, h.Push, h.Email, new BackupSettings())
            .Handle(new NotifyAdminsOfBackupProblemsCommand(last), CancellationToken.None);
        Assert.True(result.IsSuccess);
        return result.Value;
    }

    /// <summary>A full set of recent, successful runs; ages adjustable to make one of them late.</summary>
    private static void AllHealthy(TestHarness h, TimeSpan? dumpAge = null, TimeSpan? baseAge = null)
    {
        var now = h.Clock.UtcNow;
        var dumpAt = now - (dumpAge ?? TimeSpan.FromHours(3));
        Add(h, BackupRun.Record("config", true, now.AddDays(-10), now.AddDays(-10)));
        Add(h, BackupRun.Record("dump", true, dumpAt.AddMinutes(-2), dumpAt, 412L * 1024 * 1024, verified: true,
            detail: "snapshot 1a2b3c4d · 52 tables"));
        var baseAt = now - (baseAge ?? TimeSpan.FromHours(10));
        Add(h, BackupRun.Record("base", true, baseAt, baseAt, 100L * 1024 * 1024));
        Add(h, BackupRun.Record("wal", true, now.AddMinutes(-2), now.AddMinutes(-2), walArchivedAtUtc: now.AddSeconds(-40)));
        Add(h, BackupRun.Record("files", true, now.AddHours(-9), now.AddHours(-9), 5000));
        Add(h, BackupRun.Record("check", true, now.AddHours(-8), now.AddHours(-8), verified: true));
        Add(h, BackupRun.Record("drill", true, now.AddDays(-2), now.AddDays(-2), verified: true,
            detail: "logical restore matched · https://github.com/o/r/actions/runs/7"));
    }

    private static void Add(TestHarness h, BackupRun run)
    {
        h.Db.BackupRuns.Add(run);
        h.Db.SaveChanges();
    }

    private static User Admin(TestHarness h)
    {
        var admin = User.Create("Founder", "founder@example.com", h.Hasher.Hash("password123"), Now.AddDays(-100));
        admin.PromoteToAdmin();
        h.Db.Users.Add(admin);
        h.Db.SaveChanges();
        return admin;
    }
}
