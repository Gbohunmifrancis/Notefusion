using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Outreach;

/// <summary>An account due a research message, and which one.</summary>
public sealed record OutreachCandidate(Guid UserId, OutreachSegment Segment);

/// <summary>
/// The founder's customer-research outreach: who is due which message (<see cref="FindDueAsync"/>), and
/// sending it by email and push (<see cref="SendAsync"/>), once per segment per account, ever.
/// </summary>
/// <remarks>
/// <para>
/// Who: active, non-admin, non-internal accounts at least two days old. Email needs a verified address and
/// no unsubscribe (<see cref="EmailOptOut"/>); push needs a registered device, which is the app's own push
/// switch (turning notifications off unregisters the device). An account reachable on neither is skipped.
/// </para>
/// <para>
/// The segments, in priority order (an account hears about the first it fits and has not had):
/// <list type="number">
/// <item><see cref="OutreachSegment.CheckoutAbandoned"/>: opened a checkout, newest one at least three days
/// ago, never paid, not Pro, and the abandoned-checkout reminder (if any) at least two days back. Until
/// then such an account gets no other outreach message either, so the higher priority one is not lost
/// to the seven-day spacing.</item>
/// <item><see cref="OutreachSegment.ActiveUser"/>: not Pro, account a week old, and active on three or more
/// days (WAT; a transcription, a saved sheet, a web-app event or a sign-in) or four finished transcriptions.</item>
/// <item><see cref="OutreachSegment.TriedOnce"/>: not Pro, exactly one finished transcription, nothing for
/// five days.</item>
/// <item><see cref="OutreachSegment.NeverTranscribed"/>: no transcription at all, signed up two days ago.
/// There is no other "you haven't transcribed yet" email in the code, so nothing to space this from.</item>
/// </list>
/// </para>
/// <para>
/// At most one message per account in <see cref="OutreachRules.Spacing"/>. Every send is claimed by
/// inserting its <see cref="OutreachMessage"/> row first; the unique (user, segment, channel) index makes the
/// second of two overlapping sweeps fail its insert and send nothing. A failed send is retried once.
/// </para>
/// </remarks>
public sealed class OutreachService
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;
    private readonly IPushSender _push;
    private readonly OutreachSettings _settings;
    private readonly IEmailUnsubscribeTokens _tokens;

    public OutreachService(
        IApplicationDbContext db,
        IDateTimeProvider clock,
        IEmailSender email,
        IPushSender push,
        OutreachSettings settings,
        IEmailUnsubscribeTokens tokens)
    {
        _db = db;
        _clock = clock;
        _email = email;
        _push = push;
        _settings = settings;
        _tokens = tokens;
    }

    /// <summary>Up to <paramref name="limit"/> accounts due a message, highest priority and oldest first.</summary>
    public async Task<IReadOnlyList<OutreachCandidate>> FindDueAsync(int limit, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var bornBy = now - OutreachRules.NeverTranscribedAccountAge;

        var users = await _db.Users.AsNoTracking()
            .Where(u => u.IsActive && u.Role != UserRole.Admin && !u.IsInternal && u.CreatedAt <= bornBy)
            .Select(u => new
            {
                u.Id,
                u.CreatedAt,
                u.EmailVerified,
                Seen = u.LastSeenAtUtc ?? u.LastLoginAt,
                u.CheckoutReminderSentAtUtc,
            })
            .ToListAsync(ct);
        if (users.Count == 0 || limit <= 0)
            return [];

        // Everything below is small per-account facts, read once and folded in memory, the way the analytics
        // queries do, so the rules read the same on Npgsql and on the tests' SQLite.
        var history = await _db.OutreachMessages.AsNoTracking()
            .Select(m => new { m.UserId, m.Segment, m.CreatedAtUtc })
            .ToListAsync(ct);
        var spacingSince = now - OutreachRules.Spacing;
        var recentlyWritten = history.Where(m => m.CreatedAtUtc > spacingSince).Select(m => m.UserId).ToHashSet();
        var alreadySent = history.Select(m => (m.UserId, m.Segment)).ToHashSet();

        var optedOut = (await _db.EmailOptOuts.Select(o => o.UserId).ToListAsync(ct)).ToHashSet();
        var withDevice = (await _db.DeviceTokens.Select(t => t.UserId).Distinct().ToListAsync(ct)).ToHashSet();
        var pro = (await _db.Subscriptions
                .Where(s => (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.Canceled)
                            && s.CurrentPeriodEndUtc > now)
                .Select(s => s.UserId).ToListAsync(ct))
            .ToHashSet();
        var paid = (await _db.PaymentTransactions
                .Where(t => t.Status == PaymentStatus.Verified || t.Status == PaymentStatus.Completed)
                .Select(t => t.UserId).Distinct().ToListAsync(ct))
            .ToHashSet();
        var lastCheckout = await _db.PaymentTransactions
            .GroupBy(t => t.UserId)
            .Select(g => new { UserId = g.Key, Last = g.Max(t => t.CreatedAtUtc) })
            .ToDictionaryAsync(x => x.UserId, x => x.Last, ct);
        var jobs = (await _db.TranscriptionJobs.AsNoTracking()
                .Select(j => new { j.UserId, j.CreatedAtUtc, Done = j.ResultJson != null })
                .ToListAsync(ct))
            .ToLookup(j => j.UserId);
        var saves = (await _db.Transcriptions.AsNoTracking()
                .Select(t => new { t.UserId, t.CreatedAtUtc })
                .ToListAsync(ct))
            .ToLookup(t => t.UserId, t => t.CreatedAtUtc);

        var reachable = users
            .Where(u => !recentlyWritten.Contains(u.Id)
                        && ((u.EmailVerified && !optedOut.Contains(u.Id)) || withDevice.Contains(u.Id)))
            .ToList();

        // Web-app events only matter to the two segments that look at activity; read them for those accounts.
        var needActivity = reachable
            .Where(u => !pro.Contains(u.Id)
                        && jobs[u.Id].Count(j => j.Done) < OutreachRules.ActiveUserMinTranscriptions
                        && (!alreadySent.Contains((u.Id, OutreachSegment.ActiveUser))
                            || !alreadySent.Contains((u.Id, OutreachSegment.TriedOnce))))
            .Select(u => u.Id)
            .ToList();
        var web = (await _db.WebEvents.AsNoTracking()
                .Where(e => e.UserId != null && needActivity.Contains(e.UserId.Value))
                .Select(e => new { UserId = e.UserId!.Value, e.OccurredAtUtc })
                .ToListAsync(ct))
            .ToLookup(e => e.UserId, e => e.OccurredAtUtc);

        var due = new List<(OutreachCandidate Candidate, DateTime CreatedAt)>();
        foreach (var u in reachable)
        {
            var isPro = pro.Contains(u.Id);
            var userJobs = jobs[u.Id].ToList();
            var finished = userJobs.Count(j => j.Done);
            IEnumerable<DateTime> Signals() => userJobs.Select(j => j.CreatedAtUtc)
                .Concat(saves[u.Id])
                .Concat(web[u.Id])
                .Concat(u.Seen is { } seen ? new[] { seen } : Array.Empty<DateTime>());

            bool Fits(OutreachSegment segment) => !alreadySent.Contains((u.Id, segment)) && segment switch
            {
                OutreachSegment.CheckoutAbandoned =>
                    !isPro && !paid.Contains(u.Id)
                    && lastCheckout.TryGetValue(u.Id, out var last) && last <= now - OutreachRules.CheckoutAge
                    && (u.CheckoutReminderSentAtUtc is not { } reminded
                        || reminded <= now - OutreachRules.AfterCheckoutReminder),
                OutreachSegment.ActiveUser =>
                    !isPro && u.CreatedAt <= now - OutreachRules.ActiveUserAccountAge
                    && (finished >= OutreachRules.ActiveUserMinTranscriptions
                        || Signals().Select(OutreachRules.LocalDate).Distinct().Count() >= OutreachRules.ActiveUserMinDays),
                OutreachSegment.TriedOnce =>
                    !isPro && finished == 1 && Signals().Max() <= now - OutreachRules.TriedOnceQuietFor,
                OutreachSegment.NeverTranscribed => userJobs.Count == 0,
                _ => false,
            };

            // Someone with an unpaid checkout is kept for "what stopped you?" until it is due (the checkout
            // or its reminder is still recent), rather than spending their seven days on a lesser message.
            var checkoutDue = Fits(OutreachSegment.CheckoutAbandoned);
            var heldForCheckout = !checkoutDue && !isPro && !paid.Contains(u.Id) && lastCheckout.ContainsKey(u.Id)
                                  && !alreadySent.Contains((u.Id, OutreachSegment.CheckoutAbandoned));
            if (heldForCheckout)
                continue;

            var segment = checkoutDue
                ? OutreachSegment.CheckoutAbandoned
                : Enum.GetValues<OutreachSegment>().Where(s => s != OutreachSegment.CheckoutAbandoned)
                    .Select(s => (OutreachSegment?)s).FirstOrDefault(s => Fits(s!.Value));
            if (segment is { } chosen)
                due.Add((new OutreachCandidate(u.Id, chosen), u.CreatedAt));
        }

        return [.. due
            .OrderBy(d => d.Candidate.Segment)
            .ThenBy(d => d.CreatedAt)
            .Take(limit)
            .Select(d => d.Candidate)];
    }

    /// <summary>
    /// Claims and sends <paramref name="candidate"/>'s message on every channel that reaches them. False
    /// when nothing was sent: the account is gone or unreachable, was written to meanwhile, or another sweep
    /// claimed the same message first.
    /// </summary>
    public async Task<bool> SendAsync(OutreachCandidate candidate, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var userId = candidate.UserId;
        var user = await _db.Users.AsNoTracking()
            .Where(u => u.Id == userId && u.IsActive)
            .Select(u => new { u.Email, u.FullName, u.EmailVerified })
            .FirstOrDefaultAsync(ct);
        if (user is null)
            return false;

        // The rules again, against the database rather than the list the sweep read a moment ago.
        var spacingSince = now - OutreachRules.Spacing;
        if (await _db.OutreachMessages.AnyAsync(
                m => m.UserId == userId && (m.Segment == candidate.Segment || m.CreatedAtUtc > spacingSince), ct))
            return false;

        var channels = await ChannelsAsync(userId, user.EmailVerified, ct);
        if (channels.Count == 0)
            return false;

        var claims = channels.Select(c => OutreachMessage.Claim(userId, candidate.Segment, c, now)).ToList();
        _db.OutreachMessages.AddRange(claims);
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Another sweep inserted the same (user, segment, channel) first: theirs to send.
            foreach (var claim in claims)
                _db.OutreachMessages.Remove(claim);
            return false;
        }

        foreach (var claim in claims)
        {
            var error = await DeliverAsync(userId, claim.Segment, claim.Channel, user.Email, user.FullName, ct);
            if (error is null)
                claim.MarkSent(_clock.UtcNow);
            else
                claim.MarkFailed(error);
        }
        await _db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>Failed sends still due their one retry, oldest first.</summary>
    public async Task<IReadOnlyList<Guid>> FindRetriesAsync(int limit, CancellationToken ct)
    {
        if (limit <= 0)
            return [];
        var since = _clock.UtcNow - OutreachRules.RetryWithin;
        return await _db.OutreachMessages.AsNoTracking()
            .Where(m => m.Status == OutreachStatus.Failed && m.Attempts < OutreachMessage.MaxAttempts && m.CreatedAtUtc >= since)
            .OrderBy(m => m.CreatedAtUtc)
            .Take(limit)
            .Select(m => m.Id)
            .ToListAsync(ct);
    }

    /// <summary>
    /// Tries a failed send a second (and last) time. Claimed by a conditional update on the attempt count, so
    /// two sweeps cannot both retry it. Re-checks the channel: an account that unsubscribed or turned
    /// notifications off since is not retried.
    /// </summary>
    public async Task<bool> RetryAsync(Guid messageId, CancellationToken ct)
    {
        var claimed = await _db.OutreachMessages
            .Where(m => m.Id == messageId && m.Status == OutreachStatus.Failed && m.Attempts < OutreachMessage.MaxAttempts)
            .ExecuteUpdateAsync(s => s
                .SetProperty(m => m.Attempts, m => m.Attempts + 1)
                .SetProperty(m => m.Status, OutreachStatus.Pending), ct);
        if (claimed != 1)
            return false;

        // Read without tracking and written back with a conditional update: the claim above went straight to
        // the database, so a tracked copy of this row would be stale.
        var message = await _db.OutreachMessages.AsNoTracking()
            .Where(m => m.Id == messageId)
            .Select(m => new { m.UserId, m.Segment, m.Channel })
            .FirstAsync(ct);
        var user = await _db.Users.AsNoTracking()
            .Where(u => u.Id == message.UserId && u.IsActive)
            .Select(u => new { u.Email, u.FullName, u.EmailVerified })
            .FirstOrDefaultAsync(ct);
        var channels = user is null ? new List<OutreachChannel>() : await ChannelsAsync(message.UserId, user.EmailVerified, ct);

        var error = user is null || !channels.Contains(message.Channel)
            ? "Not retried: the account can no longer be reached on this channel."
            : await DeliverAsync(message.UserId, message.Segment, message.Channel, user.Email, user.FullName, ct);
        var now = _clock.UtcNow;
        var stored = error is null ? null : OutreachMessage.TrimError(error);
        await _db.OutreachMessages
            .Where(m => m.Id == messageId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(m => m.Status, error is null ? OutreachStatus.Sent : OutreachStatus.Failed)
                .SetProperty(m => m.SentAtUtc, error is null ? now : (DateTime?)null)
                .SetProperty(m => m.Error, stored), ct);
        return user is not null && channels.Contains(message.Channel);
    }

    private async Task<List<OutreachChannel>> ChannelsAsync(Guid userId, bool emailVerified, CancellationToken ct)
    {
        var channels = new List<OutreachChannel>();
        if (emailVerified && !await _db.EmailOptOuts.AnyAsync(o => o.UserId == userId, ct))
            channels.Add(OutreachChannel.Email);
        if (await _db.DeviceTokens.AnyAsync(t => t.UserId == userId, ct))
            channels.Add(OutreachChannel.Push);
        return channels;
    }

    /// <summary>Sends one message on one channel. Null when the provider took it, else why not.</summary>
    private async Task<string?> DeliverAsync(
        Guid userId, OutreachSegment segment, OutreachChannel channel, string email, string fullName, CancellationToken ct)
    {
        if (channel == OutreachChannel.Email)
        {
            DateTime? triedOn = segment == OutreachSegment.TriedOnce
                ? await _db.TranscriptionJobs
                    .Where(j => j.UserId == userId && j.ResultJson != null)
                    .OrderBy(j => j.CreatedAtUtc)
                    .Select(j => (DateTime?)j.CreatedAtUtc)
                    .FirstOrDefaultAsync(ct)
                : null;
            var unsubscribeUrl = $"{_settings.ApiBaseUrl.TrimEnd('/')}/api/email/unsubscribe?token={_tokens.Create(userId)}";
            var result = await _email.SendOutreachAsync(
                new EmailRecipient(email, fullName),
                new OutreachEmail(segment, _settings.FounderName, _settings.ReplyTo, unsubscribeUrl, triedOn),
                ct);
            return result.IsSuccess ? null : result.Error.Message;
        }

        try
        {
            await _push.SendAsync([userId], OutreachPushCopy.For(segment), ct);
            return null;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            // A provider timeout arrives as a TaskCanceledException too; only our own shutdown is not a failure.
            return ex.Message;
        }
    }
}
