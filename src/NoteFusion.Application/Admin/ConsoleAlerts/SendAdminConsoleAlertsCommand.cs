using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.PaymentAlerts;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.ConsoleAlerts;

/// <summary>
/// The numbers behind the console's alerts (<c>AdminConsoleAlerts__*</c>). The defaults are "clearly more than a normal
/// day": a church sending a few takes after service is not a flood, a script making accounts in a loop is.
/// </summary>
public sealed class AdminConsoleAlertSettings
{
    public bool Enabled { get; init; } = true;

    /// <summary>New accounts within <see cref="SignupWindowMinutes"/> that make a wave.</summary>
    public int SignupBurst { get; init; } = 10;
    public int SignupWindowMinutes { get; init; } = 15;

    /// <summary>Accounts on one inbox (the canonical address, +tags and gmail dots folded) within an hour.</summary>
    public int InboxBurst { get; init; } = 3;

    /// <summary>Transcriptions one account or one phone sends within <see cref="JobWindowMinutes"/>.</summary>
    public int JobBurstPerSender { get; init; } = 15;

    /// <summary>Transcriptions from everyone together within <see cref="JobWindowMinutes"/>.</summary>
    public int JobBurstTotal { get; init; } = 60;
    public int JobWindowMinutes { get; init; } = 10;

    /// <summary>The same alert (the same account, phone, inbox or wave) at most this often.</summary>
    public int CooldownMinutes { get; init; } = 60;
}

/// <summary>What one run told the console: the keys it alerted on (the worker keeps them for the cooldown).</summary>
public sealed record AdminConsoleAlertRun(IReadOnlyList<string> Alerted, int FailedPayments)
{
    public static readonly AdminConsoleAlertRun Nothing = new([], 0);
}

/// <summary>
/// Pushes the admin consoles (web push, audience "console") what needs a look: payment attempts that failed in
/// (<paramref name="AfterUtc"/>, <paramref name="UntilUtc"/>], a wave of new accounts, several accounts on one inbox, and
/// one account, one phone or everyone together sending far more transcriptions than usual. <paramref name="LastAlerted"/>
/// is when each key last rang (the worker's memory): a key inside its cooldown stays quiet. Admins' and internal
/// accounts are left out of every count. Successful payments ring from <c>SendPaymentAlertsCommand</c>.
/// </summary>
public sealed record SendAdminConsoleAlertsCommand(
    DateTime AfterUtc, DateTime UntilUtc, IReadOnlyDictionary<string, DateTime> LastAlerted)
    : IRequest<Result<AdminConsoleAlertRun>>;

public sealed class SendAdminConsoleAlertsCommandHandler : IRequestHandler<SendAdminConsoleAlertsCommand, Result<AdminConsoleAlertRun>>
{
    private readonly IApplicationDbContext _db;
    private readonly IWebPushSender _push;
    private readonly AdminConsoleAlertSettings _settings;

    public SendAdminConsoleAlertsCommandHandler(IApplicationDbContext db, IWebPushSender push, AdminConsoleAlertSettings? settings = null)
    {
        _db = db;
        _push = push;
        _settings = settings ?? new AdminConsoleAlertSettings();
    }

    public async Task<Result<AdminConsoleAlertRun>> Handle(SendAdminConsoleAlertsCommand request, CancellationToken ct)
    {
        var (after, until) = (request.AfterUtc, request.UntilUtc);
        var cooldown = TimeSpan.FromMinutes(_settings.CooldownMinutes);
        bool Quiet(string key) => request.LastAlerted.TryGetValue(key, out var at) && until - at < cooldown;

        var real = _db.Users.Where(u => u.Role != UserRole.Admin && !u.IsInternal);
        var alerts = new List<(string Key, WebPushNotification Push)>();

        // Payment attempts the provider turned down.
        var failed = await _db.PaymentTransactions.AsNoTracking()
            .Where(t => t.Status == PaymentStatus.Failed && t.UpdatedAtUtc > after && t.UpdatedAtUtc <= until
                        && t.Provider != PaymentProvider.GooglePlay && real.Any(u => u.Id == t.UserId))
            .OrderBy(t => t.UpdatedAtUtc)
            .Select(t => new FailedPayment(
                t.Id, t.AmountMinor, t.Currency,
                _db.Plans.Where(p => p.Id == t.PlanId).Select(p => p.Name).FirstOrDefault(),
                _db.Users.Where(u => u.Id == t.UserId).Select(u => u.FullName).FirstOrDefault()))
            .Take(50)
            .ToListAsync(ct);
        if (failed.Count > 0)
            alerts.Add(($"payment-failed:{failed[0].Id}", AdminConsoleAlertCopy.FailedPayments(failed)));

        // A wave of new accounts.
        var signupsSince = until.AddMinutes(-_settings.SignupWindowMinutes);
        var signups = await real.CountAsync(u => u.CreatedAt > signupsSince && u.CreatedAt <= until, ct);
        if (signups >= _settings.SignupBurst && !Quiet("signups"))
            alerts.Add(("signups", AdminConsoleAlertCopy.SignupWave(signups, _settings.SignupWindowMinutes)));

        // Several accounts on one inbox within the hour.
        var hourAgo = until.AddHours(-1);
        var inboxes = await real
            .Where(u => u.CreatedAt > hourAgo && u.CreatedAt <= until && u.CanonicalEmail != null)
            .GroupBy(u => u.CanonicalEmail!)
            .Select(g => new { Inbox = g.Key, Count = g.Count() })
            .Where(g => g.Count >= _settings.InboxBurst)
            .ToListAsync(ct);
        foreach (var inbox in inboxes.Where(i => !Quiet($"inbox:{i.Inbox}")))
            alerts.Add(($"inbox:{inbox.Inbox}", AdminConsoleAlertCopy.SameInbox(inbox.Count, inbox.Inbox)));

        // Transcriptions far past a normal pace: one account, one phone, or everyone.
        var jobsSince = until.AddMinutes(-_settings.JobWindowMinutes);
        var jobs = await _db.TranscriptionJobs.AsNoTracking()
            .Where(j => j.CreatedAtUtc > jobsSince && j.CreatedAtUtc <= until && real.Any(u => u.Id == j.UserId))
            .Select(j => new { j.UserId, j.DeviceFingerprint })
            .ToListAsync(ct);
        foreach (var sender in jobs.GroupBy(j => j.UserId).Where(g => g.Count() >= _settings.JobBurstPerSender))
        {
            if (Quiet($"jobs:user:{sender.Key}"))
                continue;
            var name = await _db.Users.Where(u => u.Id == sender.Key).Select(u => u.FullName).FirstOrDefaultAsync(ct);
            alerts.Add(($"jobs:user:{sender.Key}", AdminConsoleAlertCopy.AccountFlood(name, sender.Count(), _settings.JobWindowMinutes, sender.Key)));
        }
        foreach (var phone in jobs.Where(j => j.DeviceFingerprint != null).GroupBy(j => j.DeviceFingerprint!)
                     .Where(g => g.Count() >= _settings.JobBurstPerSender && g.Select(j => j.UserId).Distinct().Count() > 1))
        {
            // One phone across several accounts: each account may be under the line, the phone is not.
            if (!Quiet($"jobs:device:{phone.Key}"))
                alerts.Add(($"jobs:device:{phone.Key}", AdminConsoleAlertCopy.PhoneFlood(phone.Count(), phone.Select(j => j.UserId).Distinct().Count(), _settings.JobWindowMinutes)));
        }
        if (jobs.Count >= _settings.JobBurstTotal && !Quiet("jobs:all"))
            alerts.Add(("jobs:all", AdminConsoleAlertCopy.EveryoneFlood(jobs.Count, _settings.JobWindowMinutes)));

        if (alerts.Count == 0)
            return AdminConsoleAlertRun.Nothing;

        foreach (var (_, push) in alerts)
            await AdminConsolePush.SendToAdminsAsync(_db, _push, push, ct);
        return new AdminConsoleAlertRun(alerts.Select(a => a.Key).ToList(), failed.Count);
    }
}

public sealed record FailedPayment(Guid Id, long AmountMinor, string Currency, string? Plan, string? Name);

/// <summary>Sends one notification to every active admin's console browsers.</summary>
public static class AdminConsolePush
{
    public static async Task SendToAdminsAsync(IApplicationDbContext db, IWebPushSender push, WebPushNotification notification, CancellationToken ct)
    {
        var admins = await db.Users
            .Where(u => u.Role == UserRole.Admin && u.IsActive
                        && db.WebPushSubscriptions.Any(s => s.UserId == u.Id && s.Audience == WebPushSubscription.ConsoleAudience))
            .Select(u => u.Id)
            .ToListAsync(ct);
        foreach (var admin in admins)
            await push.SendAsync(admin, notification, ct, WebPushSubscription.ConsoleAudience);
    }
}

/// <summary>
/// The console alerts' words: a title that says what happened and a line on what to look at. Each opens the console
/// page that answers it (<see cref="WebPushNotification.Url"/>, a console path) and replaces the last of its kind (tag).
/// </summary>
public static class AdminConsoleAlertCopy
{
    public static WebPushNotification Payment(IReadOnlyList<PaymentAlertFacts> paid)
    {
        var words = PaymentPushCopy.Summary(paid, hideNames: false);
        var url = paid.Count == 1 ? $"/payments/{paid[0].PaymentId}" : "/payments";
        return new WebPushNotification(words.Title, words.Body, $"nf-paid-{paid[0].PaymentId}", url, "payment");
    }

    public static WebPushNotification FailedPayments(IReadOnlyList<FailedPayment> failed)
    {
        if (failed.Count == 1)
        {
            var f = failed[0];
            var who = string.IsNullOrWhiteSpace(f.Name) ? "A customer" : f.Name!.Trim();
            return new WebPushNotification(
                $"Payment failed · {PaymentPushCopy.Money(f.AmountMinor, f.Currency)}",
                $"{who}’s {PaymentPushCopy.ShortPlan(f.Plan)} payment didn’t go through. They may need a hand.",
                $"nf-payment-failed-{f.Id}", $"/payments/{f.Id}", "payment-failed");
        }
        var names = failed.Select(f => string.IsNullOrWhiteSpace(f.Name) ? null : f.Name!.Trim().Split(' ')[0])
            .OfType<string>().Distinct().Take(3).ToList();
        return new WebPushNotification(
            $"{failed.Count} payments failed",
            names.Count == 0 ? "Open Payments to see who." : $"{string.Join(", ", names)}{(failed.Count > names.Count ? " and others" : "")}: open Payments to see why.",
            "nf-payments-failed", "/payments", "payment-failed");
    }

    public static WebPushNotification SignupWave(int count, int minutes)
        => new($"{count} new accounts in {minutes} minutes",
            "Far more than usual. Check they’re real people and not a script.", "nf-signups", "/users", "signups");

    public static WebPushNotification SameInbox(int count, string inbox)
        => new($"{count} accounts on one inbox in an hour",
            $"All on {Mask(inbox)}. Someone may be making accounts for more free transcriptions.", $"nf-inbox-{inbox}", "/users", "signups");

    public static WebPushNotification AccountFlood(string? name, int count, int minutes, Guid userId)
        => new($"{count} transcriptions in {minutes} minutes",
            $"{(string.IsNullOrWhiteSpace(name) ? "One account" : name!.Trim())} is sending far more than anyone usually does.",
            $"nf-flood-{userId}", $"/users/{userId}", "transcriptions");

    public static WebPushNotification PhoneFlood(int count, int accounts, int minutes)
        => new($"{count} transcriptions from one phone",
            $"{accounts} accounts on the same phone in {minutes} minutes. It may be one person working around the limits.",
            "nf-flood-phone", "/transcriptions", "transcriptions");

    public static WebPushNotification EveryoneFlood(int count, int minutes)
        => new($"{count} transcriptions in {minutes} minutes",
            "The worker is busier than usual. Check the queue and System Health.", "nf-flood-all", "/health", "transcriptions");

    /// <summary>"fr•••@gmail.com", as the phone admin masks addresses.</summary>
    private static string Mask(string email) => PhoneLock.AdminPhoneLockRules.MaskEmail(email);
}
