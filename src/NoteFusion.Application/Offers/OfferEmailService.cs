using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Choirs;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Outreach;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Offers;

/// <summary>
/// Sends the offer emails Send queued (<see cref="OfferEmail"/> rows), one run at a time (<c>OfferEmailWorker</c>).
/// </summary>
/// <remarks>
/// <para>
/// For each offer whose email was sent, switched on, started and not paused, the queue goes last calls first (they are
/// the ones short of time), then lapsed Pro, then free accounts by when they were last seen (newest first), then Pro
/// now. Each row is sent as its round: the email, or the last call with its countdown. Each person is checked again at their turn: an
/// account suspended, unverified or no longer on dollar prices is skipped (<see cref="OfferSkipReason.NoLongerEligible"/>),
/// as is one that turned email off (<see cref="OfferSkipReason.OptedOut"/>), paid at this offer's price
/// (<see cref="OfferSkipReason.Bought"/>), became Pro another way (free and lapsed only,
/// <see cref="OfferSkipReason.BecamePro"/>) or whose own end has passed (<see cref="OfferSkipReason.Ended"/>): nobody is
/// sent an offer they can no longer take.
/// </para>
/// <para>
/// Then it goes only in their sending hours (09:00–19:00 in their own time zone, the UK's when unknown) and only while
/// the quota allows optional mail (<see cref="IEmailQuota"/>): the run stops at the first "no", so the rest stays queued
/// for a run with room. A refused send is tried once more on a later run, then marked failed with its error. Once the
/// offer is over everywhere, whatever is still queued is skipped as ended.
/// </para>
/// </remarks>
public sealed class OfferEmailService
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;
    private readonly OfferSettings _settings;
    private readonly IEmailUnsubscribeTokens _tokens;
    private readonly IProviderHealth _health;
    private readonly IEmailQuota _quota;
    private readonly ILogger<OfferEmailService> _logger;

    public OfferEmailService(
        IApplicationDbContext db,
        IDateTimeProvider clock,
        IEmailSender email,
        OfferSettings settings,
        IEmailUnsubscribeTokens tokens,
        IProviderHealth? health = null,
        IEmailQuota? quota = null,
        ILogger<OfferEmailService>? logger = null)
    {
        _db = db;
        _clock = clock;
        _email = email;
        _settings = settings;
        _tokens = tokens;
        _health = health ?? ProviderHealth.AlwaysAvailable;
        _quota = quota ?? EmailBudget.Unlimited;
        _logger = logger ?? NullLogger<OfferEmailService>.Instance;
    }

    /// <summary>One run over every sending offer. Returns how many emails the provider took.</summary>
    public async Task<int> RunAsync(CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var offers = await _db.Offers.AsNoTracking().Where(o => o.SendStartedAtUtc != null).ToListAsync(ct);
        var budget = Math.Max(1, _settings.BatchSize);
        var sent = 0;

        foreach (var offer in offers.OrderBy(o => o.StartsAtUtc))
        {
            if (offer.HasEndedEverywhere(now))
            {
                await CloseQueueAsync(offer.Id, ct);
                continue;
            }
            // Off, paused, not started or its season off: the queue waits, no try spent.
            if (!offer.Enabled || offer.SendPaused || !offer.HasStarted(now) || !await OfferSeason.IsOnAsync(_db, offer, now, ct))
                continue;

            var (count, stop) = await SendQueueAsync(offer, budget - sent, ct);
            sent += count;
            if (stop || sent >= budget)
                break;
        }

        return sent;
    }

    /// <summary>The offer is over everywhere: nothing queued will ever go.</summary>
    private Task<int> CloseQueueAsync(Guid offerId, CancellationToken ct)
        => _db.OfferEmails
            .Where(e => e.OfferId == offerId && e.Status == OfferEmailStatus.Queued)
            .ExecuteUpdateAsync(s => s
                .SetProperty(e => e.Status, OfferEmailStatus.Skipped)
                .SetProperty(e => e.SkipReason, (OfferSkipReason?)OfferSkipReason.Ended), ct);

    /// <returns>How many went, and whether the run must stop (the quota or the provider said no).</returns>
    private async Task<(int Sent, bool Stop)> SendQueueAsync(Offer offer, int budget, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var queue = await _db.OfferEmails
            .Where(e => e.OfferId == offer.Id && e.Status == OfferEmailStatus.Queued)
            .ToListAsync(ct);
        if (queue.Count == 0)
            return (0, false);

        var ids = queue.Select(e => e.UserId).ToList();
        var users = await _db.Users.AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .Select(u => new
            {
                u.Id, u.Email, u.FullName, u.IsActive, u.EmailVerified, u.Country, u.TimeZone,
                Seen = u.LastSeenAtUtc ?? u.LastLoginAt,
            })
            .ToDictionaryAsync(u => u.Id, ct);
        var optedOut = (await _db.EmailOptOuts.Where(o => ids.Contains(o.UserId)).Select(o => o.UserId).ToListAsync(ct)).ToHashSet();
        var bought = (await _db.PaymentTransactions
                .Where(t => t.OfferId == offer.Id && t.Status == PaymentStatus.Completed)
                .Select(t => t.UserId)
                .Distinct()
                .ToListAsync(ct))
            .ToHashSet();
        var pro = (await _db.Subscriptions
                .Where(s => (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.Canceled)
                            && s.CurrentPeriodEndUtc > now && ids.Contains(s.UserId))
                .Select(s => s.UserId)
                .ToListAsync(ct))
            .ToHashSet();
        pro.UnionWith(await ChoirAccess.ActiveChoirUserIdsAsync(_db, now, ct));
        var plans = await OfferEmailComposer.OfferablePlansAsync(_db, ct);

        var ordered = queue
            .OrderBy(e => e.Round == OfferEmailRound.LastCall ? 0 : 1)
            .ThenBy(e => e.Group)
            .ThenByDescending(e => users.TryGetValue(e.UserId, out var u) ? u.Seen ?? DateTime.MinValue : DateTime.MinValue)
            .ToList();

        var sent = 0;
        foreach (var row in ordered)
        {
            if (sent >= budget)
                return (sent, true);

            // Gone accounts take their rows with them (cascade); one read a moment ago may still be missing.
            if (!users.TryGetValue(row.UserId, out var user))
            {
                row.Skip(OfferSkipReason.NoLongerEligible);
                await _db.SaveChangesAsync(ct);
                continue;
            }

            var set = string.IsNullOrWhiteSpace(user.Country) ? null : OfferPlans.SetFor(user.Country);
            var zone = OfferWindow.Resolve(user.TimeZone);
            OfferSkipReason? skip =
                !user.IsActive || !user.EmailVerified || set is null ? OfferSkipReason.NoLongerEligible
                : optedOut.Contains(user.Id) ? OfferSkipReason.OptedOut
                : bought.Contains(user.Id) ? OfferSkipReason.Bought
                : row.Group != OfferEmailGroup.ProNow && pro.Contains(user.Id) ? OfferSkipReason.BecamePro
                : now >= OfferWindow.EndsAtUtc(offer, zone) ? OfferSkipReason.Ended
                : null;
            if (skip is { } reason)
            {
                row.Skip(reason);
                await _db.SaveChangesAsync(ct);
                continue;
            }

            // Their own morning will come round; the quota and the provider are for everyone, so those stop the run.
            if (!OutreachRules.IsSendingHour(now, zone))
                continue;
            if (_health.IsUnavailable(OutboundProviders.Email))
            {
                _logger.LogWarning("Offer emails paused for this run: the email provider is unavailable.");
                return (sent, true);
            }
            if (!await _quota.AllowsOptionalAsync(EmailKind.Offer, ct))
                return (sent, true);

            var content = OfferEmailComposer.Compose(
                offer, plans, set!, row.Token, OfferEmailComposer.UnsubscribeUrl(_settings, _tokens, user.Id), _settings, row.Round);
            var result = await _email.SendOfferAsync(new EmailRecipient(user.Email, user.FullName), content, test: false, ct);
            if (result.IsSuccess)
            {
                row.MarkSent(_clock.UtcNow);
                sent++;
            }
            else if (ProviderErrors.IsUnavailable(result.Error) || EmailBudget.IsHeld(result.Error))
            {
                // Not sent at all: no try is spent, and the rest waits for a run when it can go.
                return (sent, true);
            }
            else
            {
                row.MarkAttemptFailed(result.Error.Message);
                _logger.LogWarning(
                    "Offer email {OfferKey} to {UserId} was refused (try {Attempt} of {Max}): {Error}",
                    offer.Key, user.Id, row.Attempts, OfferEmail.MaxAttempts, result.Error.Message);
            }
            await _db.SaveChangesAsync(ct);
        }

        return (sent, false);
    }
}
