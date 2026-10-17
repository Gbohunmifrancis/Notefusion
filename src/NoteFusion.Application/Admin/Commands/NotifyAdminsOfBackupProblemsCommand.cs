using System.Net;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Services;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// What the last alert said and when, handed back to the caller so the next check can stay quiet about
/// what it already reported. <see cref="Keys"/> is the set of <see cref="BackupProblem.Key"/>s then open.
/// </summary>
public sealed record BackupAlertState(IReadOnlySet<string> Keys, DateTime? AlertedAtUtc)
{
    public static readonly BackupAlertState None = new(new HashSet<string>(), null);
}

/// <summary>
/// Tells the admins — a push to their phones and an email to each — when the backups are not good enough:
/// no verified database dump in 26 hours, WAL archiving behind by more than 15 minutes or silent, a daily
/// job late or failing, or the weekly restore drill failing (<see cref="BackupHealth"/> holds the rules).
/// </summary>
/// <remarks>
/// Said once when a problem appears, again every <see cref="RepeatEvery"/> while anything stays open (an
/// unread backup alert is worse than a repeated one), and once more, push only, when everything clears.
/// Silent while the backups are not set up at all: the System Health page says so, and a daily email about
/// a feature not yet switched on would only teach the reader to ignore these.
/// </remarks>
public sealed record NotifyAdminsOfBackupProblemsCommand(BackupAlertState? Last) : IRequest<Result<BackupAlertState>>;

public sealed class NotifyAdminsOfBackupProblemsCommandHandler
    : IRequestHandler<NotifyAdminsOfBackupProblemsCommand, Result<BackupAlertState>>
{
    public static readonly TimeSpan RepeatEvery = TimeSpan.FromHours(24);

    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IPushSender _push;
    private readonly IEmailSender _email;
    private readonly BackupSettings _settings;

    public NotifyAdminsOfBackupProblemsCommandHandler(
        IApplicationDbContext db, IDateTimeProvider clock, IPushSender push, IEmailSender email, BackupSettings settings)
    {
        _db = db;
        _clock = clock;
        _push = push;
        _email = email;
        _settings = settings;
    }

    public async Task<Result<BackupAlertState>> Handle(NotifyAdminsOfBackupProblemsCommand request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var last = request.Last ?? BackupAlertState.None;
        var report = await BackupHealth.ReadAsync(_db, now, ct);

        if (report.IsOff || !_settings.AlertsEnabled)
            return BackupAlertState.None;

        var keys = report.Problems.Select(p => p.Key).ToHashSet();

        if (keys.Count == 0)
        {
            if (last.Keys.Count > 0)
                await PushAsync("Backups are healthy again", report.Status.Summary, ct);
            return BackupAlertState.None;
        }

        var somethingNew = keys.Any(k => !last.Keys.Contains(k));
        var due = last.AlertedAtUtc is not { } at || now - at >= RepeatEvery;
        if (!somethingNew && !due)
            return last with { Keys = keys };

        var first = report.Problems[0].Message;
        var more = report.Problems.Count > 1 ? $" (+{report.Problems.Count - 1} more)" : "";
        await PushAsync("Backups need attention", first + more, ct);
        await EmailAsync(report, ct);

        return new BackupAlertState(keys, now);
    }

    private async Task PushAsync(string title, string body, CancellationToken ct)
    {
        var admins = await _db.Users.AsNoTracking()
            .Where(u => u.Role == UserRole.Admin && u.IsActive)
            .Select(u => u.Id)
            .ToListAsync(ct);
        if (admins.Count > 0)
            await _push.SendAsync(admins, new PushMessage(title, body), ct);
    }

    private async Task EmailAsync(BackupHealthReport report, CancellationToken ct)
    {
        var admins = await _db.Users.AsNoTracking()
            .Where(u => u.Role == UserRole.Admin && u.IsActive)
            .Select(u => new { u.Email, u.FullName })
            .ToListAsync(ct);

        var items = string.Concat(report.Problems.Select(p => $"<li>{WebUtility.HtmlEncode(p.Message)}</li>"));
        var body =
            $"<p>The NoteFusion backups need a look:</p><ul>{items}</ul>" +
            $"<p>{WebUtility.HtmlEncode(report.Status.Summary)}.</p>" +
            "<p>The backup container's log says more (<code>docker compose -f docker-compose.prod.yml logs backup</code>, " +
            "or Dozzle at /logs), and docs/BACKUP_AND_MIGRATION.md has what to do for each case. " +
            "This email repeats once a day while anything is still wrong.</p>";

        foreach (var admin in admins)
        {
            await _email.SendCustomEmailAsync(
                new EmailRecipient(admin.Email, admin.FullName),
                "NoteFusion backups need attention",
                "Backups need attention",
                body,
                "Open System Health",
                _settings.ConsoleHealthUrl,
                ct);
        }
    }
}
