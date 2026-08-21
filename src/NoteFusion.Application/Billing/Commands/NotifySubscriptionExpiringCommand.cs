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

    public NotifySubscriptionExpiringCommandHandler(
        IApplicationDbContext db, IDateTimeProvider clock, IEmailSender email, IPushSender push)
    {
        _db = db;
        _clock = clock;
        _email = email;
        _push = push;
    }

    public async Task<Result> Handle(NotifySubscriptionExpiringCommand request, CancellationToken ct)
    {
        var sub = await _db.Subscriptions.FirstOrDefaultAsync(s => s.Id == request.SubscriptionId, ct);
        if (sub is null)
            return BillingErrors.SubscriptionNotFound;

        var now = _clock.UtcNow;

        // Only the two states that currently hold Pro. PastDue is deliberately excluded: its renewal
        // charge has already failed and SendPaymentFailedAsync has already said so, so an
        // "expiring soon" on top is a second email about the same problem.
        if (sub.Status is not (SubscriptionStatus.Active or SubscriptionStatus.Canceled))
            return Result.Success();

        // Already over, or too far out to be worth mentioning.
        if (sub.CurrentPeriodEndUtc <= now || sub.CurrentPeriodEndUtc > now + NotifySubscriptionExpiringCommand.NoticeWindow)
            return Result.Success();

        if (!sub.MarkExpiryNoticeSent(now))
            return Result.Success();

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == sub.UserId, ct);
        if (user is null)
            return BillingErrors.SubscriptionNotFound;

        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == sub.PlanId, ct);
        var planName = plan?.Name ?? "NoteFusion Pro";

        // Committed before either send, matching the receipt path: delivery is best-effort and cannot
        // throw, so the alternative — send first, mark after — buys nothing and risks mailing twice.
        await _db.SaveChangesAsync(ct);

        // Ceiling, and never below 1: "in 0 days" is not a thing to tell someone.
        var daysLeft = Math.Max(1, (int)Math.Ceiling((sub.CurrentPeriodEndUtc - now).TotalDays));

        // Active is not enough on its own: a gift granted from the admin console is Active too, and nothing
        // is going to renew it, so promising a renewal would be a promise no code in this system keeps.
        var willRenew = sub.Status == SubscriptionStatus.Active && !sub.IsGift;

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
