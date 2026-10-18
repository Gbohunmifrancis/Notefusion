using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Commands;

/// <summary>
/// Warns one subscriber that their paid period is about to end. Sends email <em>and</em> push,
/// because either channel alone is silently unreachable for some accounts — notifications switched
/// off, or an address that bounces — and a renewal charge nobody saw coming is a chargeback.
/// </summary>
/// <remarks>
/// The handler re-checks that the subscription is genuinely due rather than trusting its caller, so
/// the notice window is enforced in one place and a direct invocation cannot mail someone whose
/// period ends in three months. Idempotent per period: sending twice requires the period end to move,
/// which only a renewal does.
/// </remarks>
public sealed record NotifySubscriptionExpiringCommand(Guid SubscriptionId) : IRequest<Result>
{
    /// <summary>How far ahead of the period end the notice goes out.</summary>
    public static readonly TimeSpan NoticeWindow = TimeSpan.FromDays(7);
}

public sealed class NotifySubscriptionExpiringCommandHandler
    : IRequestHandler<NotifySubscriptionExpiringCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;
    private readonly IPushSender _push;
    private readonly IProviderHealth _health;

    public NotifySubscriptionExpiringCommandHandler(
        IApplicationDbContext db, IDateTimeProvider clock, IEmailSender email, IPushSender push,
        IProviderHealth? health = null)
    {
        _db = db;
        _clock = clock;
        _email = email;
        _push = push;
        _health = health ?? ProviderHealth.AlwaysAvailable;
    }

    public async Task<Result> Handle(NotifySubscriptionExpiringCommand request, CancellationToken ct)
    {
        var sub = await _db.Subscriptions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == request.SubscriptionId, ct);
        if (sub is null)
            return BillingErrors.SubscriptionNotFound;

        var now = _clock.UtcNow;

        // Only the two states that currently hold Pro. PastDue is deliberately excluded: its renewal
        // charge has already failed and SendPaymentFailedAsync has already said so, so an
        // "expiring soon" on top is a second email about the same problem.
        if (sub.Status is not (SubscriptionStatus.Active or SubscriptionStatus.Canceled))
            return Result.Success();

        // Google Play renews (or ends) these itself and writes to its own customers; "buy again" would be wrong.
        if (sub.Provider == PaymentProvider.GooglePlay)
            return Result.Success();

        // Already over, or too far out to be worth mentioning.
        if (sub.CurrentPeriodEndUtc <= now || sub.CurrentPeriodEndUtc > now + NotifySubscriptionExpiringCommand.NoticeWindow)
            return Result.Success();

        if (sub.ExpiryNoticeSentForPeriodEndUtc == sub.CurrentPeriodEndUtc)
            return Result.Success();

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == sub.UserId, ct);
        if (user is null)
            return BillingErrors.SubscriptionNotFound;

        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == sub.PlanId, ct);
        var planName = plan?.Name ?? "NoteFusion Pro";

        // Claimed in the database before either send, and only by whoever's update lands: the row must
        // still end where we read it ending and must not already be marked for that end. Two sweeps (two
        // instances, or a slow one overlapping the next) can both get this far, but only one of them
        // changes the row, and only that one sends. Delivery is best-effort and cannot throw, so marking
        // first and sending after buys nothing worse than a missed notice, never a doubled one. The
        // concurrency version is left alone on purpose: this touches only the notice column, which no
        // fulfilment writes, so there is nothing for a fulfilment holding the row to lose.
        // Not claimed while email or push is refusing calls: the notice would be marked sent and never arrive.
        // Left unclaimed, the next sweep sends it.
        if (_health.IsUnavailable(OutboundProviders.Email) || _health.IsUnavailable(OutboundProviders.Push))
            return ProviderErrors.Unavailable;

        var periodEnd = sub.CurrentPeriodEndUtc;
        var claimed = await _db.Subscriptions
            .Where(s => s.Id == sub.Id
                        && s.CurrentPeriodEndUtc == periodEnd
                        && (s.ExpiryNoticeSentForPeriodEndUtc == null || s.ExpiryNoticeSentForPeriodEndUtc != periodEnd))
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.ExpiryNoticeSentForPeriodEndUtc, periodEnd), ct);
        if (claimed != 1)
            return Result.Success();

        // Ceiling, and never below 1: "in 0 days" is not a thing to tell someone.
        var daysLeft = Math.Max(1, (int)Math.Ceiling((sub.CurrentPeriodEndUtc - now).TotalDays));

        // Nothing renews by itself: every checkout is a one-off for one period, so the notice always says
        // the date Pro ends and how to add more time. Promising a charge "on the card on file" would be a
        // promise no code in this system keeps, and the member would lose Pro without warning.
        const bool willRenew = false;

        await _email.SendSubscriptionExpiringAsync(
            new EmailRecipient(user.Email, user.FullName),
            new SubscriptionExpiry(planName, sub.CurrentPeriodEndUtc, daysLeft, willRenew),
            ct);

        await _push.SendAsync(
            [sub.UserId],
            new PushMessage(
                willRenew ? "Pro renews soon" : "Pro ends soon",
                willRenew
                    ? $"{planName} renews in {daysLeft} day{(daysLeft == 1 ? "" : "s")}."
                    : $"{planName} ends in {daysLeft} day{(daysLeft == 1 ? "" : "s")}. Resubscribe to keep Pro.",
                new Dictionary<string, string> { ["screen"] = "Upgrade" }),
            ct);

        return Result.Success();
    }
}
