using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Commands;

/// <summary>
/// Emails an account whose transcription failed: it cost nothing, three things that make the next one work,
/// and the way back. At most once a week per account, and never about a failure they have already tried
/// again after. Run by the completion sweep, so every way a job fails (the client's poll, the worker's
/// webhook, the sweep's own deadline) is covered by one rule.
/// </summary>
/// <remarks>
/// One in five transcriptions fails, and a free account that fails usually leaves without trying again,
/// not knowing the attempt was free or what to do differently. There is no email opt-out in the product to
/// respect yet; the weekly cap and <see cref="Lookback"/> keep this to a note about a recent attempt (the
/// tips are the same three every time, so a second copy within the week tells nobody anything). Optional
/// mail: while the sending quota holds it (<see cref="IEmailQuota"/>) nothing is claimed, and the next
/// sweep sends it if the failure is still recent.
/// </remarks>
public sealed record EmailFailedTranscriptionTipsCommand : IRequest<Result<int>>
{
    /// <summary>Waits this long after the failure, so someone already trying again is not interrupted.</summary>
    public static readonly TimeSpan QuietFor = TimeSpan.FromMinutes(10);

    /// <summary>Only failures this recent: nobody hears about last week's attempt.</summary>
    public static readonly TimeSpan Lookback = TimeSpan.FromDays(1);

    /// <summary>The most often one account is sent this email.</summary>
    public static readonly TimeSpan AtMostEvery = TimeSpan.FromDays(7);

    public const int BatchSize = 50;
}

public sealed class EmailFailedTranscriptionTipsCommandHandler
    : IRequestHandler<EmailFailedTranscriptionTipsCommand, Result<int>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;
    private readonly IProviderHealth _health;
    private readonly IEmailQuota _quota;

    public EmailFailedTranscriptionTipsCommandHandler(
        IApplicationDbContext db, IDateTimeProvider clock, IEmailSender email, IProviderHealth? health = null,
        IEmailQuota? quota = null)
    {
        _db = db;
        _clock = clock;
        _email = email;
        _health = health ?? ProviderHealth.AlwaysAvailable;
        _quota = quota ?? EmailBudget.Unlimited;
    }

    public async Task<Result<int>> Handle(EmailFailedTranscriptionTipsCommand request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var since = now - EmailFailedTranscriptionTipsCommand.Lookback;
        var quietSince = now - EmailFailedTranscriptionTipsCommand.QuietFor;
        var weekAgo = now - EmailFailedTranscriptionTipsCommand.AtMostEvery;

        // Each account's latest failure in the window: closed with no result, and started in the window too,
        // so an old job a sweep only now closes is not news. A job that finished, or is still running, is not
        // a failure.
        var failures = await _db.TranscriptionJobs
            .Where(j => j.ResultJson == null && j.SettledAtUtc != null && j.SettledAtUtc >= since && j.CreatedAtUtc >= since)
            .GroupBy(j => j.UserId)
            .Select(g => new { UserId = g.Key, FailedAt = g.Max(j => j.SettledAtUtc!.Value) })
            .ToListAsync(ct);
        failures = failures.Where(f => f.FailedAt <= quietSince).ToList();
        if (failures.Count == 0)
            return 0;

        var userIds = failures.Select(f => f.UserId).ToList();

        // Anyone who started another transcription after their failure has already tried again: whatever
        // came of it, tips on how to try again are late.
        var lastStarted = await _db.TranscriptionJobs
            .Where(j => userIds.Contains(j.UserId))
            .GroupBy(j => j.UserId)
            .Select(g => new { UserId = g.Key, At = g.Max(j => j.CreatedAtUtc) })
            .ToDictionaryAsync(x => x.UserId, x => x.At, ct);
        var users = await _db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id) && u.IsActive)
            .ToDictionaryAsync(u => u.Id, ct);

        var due = failures
            .Where(f => users.TryGetValue(f.UserId, out var u)
                        && !(lastStarted.TryGetValue(f.UserId, out var started) && started > f.FailedAt)
                        && (u.FailedTranscriptionEmailSentAtUtc is not { } last || (last < weekAgo && last < f.FailedAt)))
            .OrderBy(f => f.FailedAt)
            .Take(EmailFailedTranscriptionTipsCommand.BatchSize)
            .ToList();

        // Claimed before sending, by a conditional update that repeats the throttle in the database, and sent
        // only by whoever's update changed the row: two overlapping sweeps cannot both send. A send that then
        // fails is not retried, which is the better failure for an unasked-for email.
        var sent = 0;
        foreach (var f in due)
        {
            // The email provider is refusing calls: claiming the rest would mark them sent with nothing sent.
            // They stay due, and the next sweep sends them.
            if (_health.IsUnavailable(OutboundProviders.Email))
                break;

            // The sending quota is keeping room for essential mail: the same, unclaimed until it has room again.
            if (!await _quota.AllowsOptionalAsync(EmailKind.TranscriptionTips, ct))
                break;

            var failedAt = f.FailedAt;
            var claimed = await _db.Users
                .Where(u => u.Id == f.UserId
                            && (u.FailedTranscriptionEmailSentAtUtc == null
                                || (u.FailedTranscriptionEmailSentAtUtc < weekAgo && u.FailedTranscriptionEmailSentAtUtc < failedAt)))
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.FailedTranscriptionEmailSentAtUtc, now), ct);
            if (claimed != 1)
                continue;

            var user = users[f.UserId];
            var onPro = await ProStatus.IsProAsync(_db, _clock, user.Id, ct);
            await _email.SendTranscriptionFailedAsync(new EmailRecipient(user.Email, user.FullName), onPro, ct);
            sent++;
        }

        return sent;
    }
}
