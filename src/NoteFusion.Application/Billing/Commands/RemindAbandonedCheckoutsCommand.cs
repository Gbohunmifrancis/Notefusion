using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Commands;

/// <summary>
/// Emails someone who opened a Pro checkout and did not finish it: once per abandoned attempt, at most
/// once a week, and never to an account that has Pro.
/// </summary>
/// <remarks>
/// Every checkout in the first weeks ended unpaid, and nobody heard from us about it: a person who
/// wanted Pro enough to reach the payment page, then hit a declined card, a bank block on online
/// payments or a page that would not load, simply left. The email says nothing was charged, offers
/// the way back, and asks them to write in if something went wrong, which is how a broken checkout gets
/// reported. It waits <see cref="QuietFor"/> after the attempt so a retry in progress is not
/// interrupted, and only looks back <see cref="Lookback"/>, so nobody hears about a week-old cart.
/// </remarks>
public sealed record RemindAbandonedCheckoutsCommand : IRequest<Result<int>>
{
    public static readonly TimeSpan QuietFor = TimeSpan.FromHours(2);
    public static readonly TimeSpan Lookback = TimeSpan.FromDays(3);
    public static readonly TimeSpan AtMostEvery = TimeSpan.FromDays(7);
    public const int BatchSize = 50;
}

public sealed class RemindAbandonedCheckoutsCommandHandler
    : IRequestHandler<RemindAbandonedCheckoutsCommand, Result<int>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;

    public RemindAbandonedCheckoutsCommandHandler(IApplicationDbContext db, IDateTimeProvider clock, IEmailSender email)
    {
        _db = db;
        _clock = clock;
        _email = email;
    }

    public async Task<Result<int>> Handle(RemindAbandonedCheckoutsCommand request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var since = now - RemindAbandonedCheckoutsCommand.Lookback;
        var quietSince = now - RemindAbandonedCheckoutsCommand.QuietFor;
        var weekAgo = now - RemindAbandonedCheckoutsCommand.AtMostEvery;

        // Each account's newest checkout in the window, paid or not: a newer paid one, or one still
        // inside the quiet period, means there is nothing to remind them of.
        var latest = await _db.PaymentTransactions
            .Where(t => t.CreatedAtUtc >= since)
            .GroupBy(t => t.UserId)
            .Select(g => g.OrderByDescending(t => t.CreatedAtUtc)
                .Select(t => new { t.UserId, t.PlanId, t.Status, t.CreatedAtUtc, ReachedCheckout = t.CheckoutUrl != null })
                .First())
            .ToListAsync(ct);

        // Only checkouts whose payment page opened: one the provider refused outright has already had
        // its "payment didn't go through" email from InitiateCheckoutCommand, and two about one attempt
        // is one too many.
        var abandoned = latest
            .Where(t => t.CreatedAtUtc < quietSince
                        && t.ReachedCheckout
                        && t.Status is not (PaymentStatus.Verified or PaymentStatus.Completed))
            .ToList();
        if (abandoned.Count == 0)
            return 0;

        var userIds = abandoned.Select(t => t.UserId).ToList();
        var withPro = (await _db.Subscriptions
            .Where(s => userIds.Contains(s.UserId)
                        && (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.Canceled)
                        && s.CurrentPeriodEndUtc > now)
            .Select(s => s.UserId)
            .ToListAsync(ct)).ToHashSet();
        var users = await _db.Users.Where(u => userIds.Contains(u.Id) && u.IsActive).ToDictionaryAsync(u => u.Id, ct);
        var planIds = abandoned.Select(t => t.PlanId).Distinct().ToList();
        var planNames = await _db.Plans.Where(p => planIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name, ct);

        var due = abandoned
            .Where(t => !withPro.Contains(t.UserId)
                        && users.TryGetValue(t.UserId, out var u)
                        && (u.CheckoutReminderSentAtUtc is not { } last || (last < t.CreatedAtUtc && last < weekAgo)))
            .OrderBy(t => t.CreatedAtUtc)
            .Take(RemindAbandonedCheckoutsCommand.BatchSize)
            .ToList();

        // Recorded before sending: a reminder that fails to send is not retried every sweep, which is
        // the better failure for an unsolicited email.
        foreach (var t in due)
            users[t.UserId].RecordCheckoutReminder(now);
        await _db.SaveChangesAsync(ct);

        foreach (var t in due)
        {
            var user = users[t.UserId];
            var plan = planNames.GetValueOrDefault(t.PlanId, "NoteFusion Pro");
            await _email.SendCheckoutAbandonedAsync(new EmailRecipient(user.Email, user.FullName), plan, ct);
        }

        return due.Count;
    }
}
