using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Queries;

/// <summary>
/// The state of the money right now, in one request: how many payments sit in each state, how many are
/// overdue, how the webhook inbox is draining, and what the ledger sums to.
/// </summary>
/// <remarks>
/// Unfiltered and unpaged on purpose — it is a health readout, not a report. Every figure is counted from
/// the tables at read time; nothing here is cached or stored, so there is no counter that can drift away
/// from the rows it describes.
/// </remarks>
public sealed record GetPaymentOpsSummaryQuery : IRequest<Result<PaymentOpsSummaryDto>>;

public sealed class GetPaymentOpsSummaryQueryHandler
    : IRequestHandler<GetPaymentOpsSummaryQuery, Result<PaymentOpsSummaryDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly BillingSettings _settings;

    public GetPaymentOpsSummaryQueryHandler(
        IApplicationDbContext db, IDateTimeProvider clock, BillingSettings settings)
    {
        _db = db;
        _clock = clock;
        _settings = settings;
    }

    public async Task<Result<PaymentOpsSummaryDto>> Handle(
        GetPaymentOpsSummaryQuery request, CancellationToken cancellationToken)
    {
        var stuckCutoff = PaymentOps.StuckCutoff(_clock.UtcNow, _settings);

        // One grouped pass rather than five counts. A state with no rows is simply absent from the result,
        // which is why every lookup below defaults to zero instead of indexing.
        var paymentCounts = await _db.PaymentTransactions
            .AsNoTracking()
            .GroupBy(t => t.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);

        var stuck = _db.PaymentTransactions
            .AsNoTracking()
            .Where(t => t.Status == PaymentStatus.Processing && t.UpdatedAtUtc < stuckCutoff);

        var stuckCount = await stuck.CountAsync(cancellationToken);

        var oldestStuckSinceUtc = await stuck
            .OrderBy(t => t.UpdatedAtUtc)
            .Select(t => (DateTime?)t.UpdatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);

        var webhookCounts = await _db.WebhookEvents
            .AsNoTracking()
            .GroupBy(e => e.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);

        var oldestAwaitingWebhookAtUtc = await _db.WebhookEvents
            .AsNoTracking()
            .Where(e => e.Status == WebhookStatus.Received)
            .OrderBy(e => e.ReceivedAtUtc)
            .Select(e => (DateTime?)e.ReceivedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);

        // Summed from the entries, never read from a stored balance — the same rule
        // GetLedgerBalanceQuery follows for one account, which is the canonical statement of it.
        var credited = await _db.LedgerEntries
            .AsNoTracking()
            .Where(e => e.Direction == LedgerDirection.Credit)
            .SumAsync(e => e.AmountMinor, cancellationToken);

        var refunded = await _db.LedgerEntries
            .AsNoTracking()
            .Where(e => e.Direction == LedgerDirection.Debit)
            .SumAsync(e => e.AmountMinor, cancellationToken);

        // The oldest entry's currency, matching the per-user balance. Falls back to USD only when there
        // are no entries at all, where the figure is zero and the code is a label on nothing.
        var currency = await _db.LedgerEntries
            .AsNoTracking()
            .OrderBy(e => e.CreatedAtUtc)
            .Select(e => e.Currency)
            .FirstOrDefaultAsync(cancellationToken) ?? "USD";

        int PaymentsIn(PaymentStatus status)
            => paymentCounts.FirstOrDefault(c => c.Status == status)?.Count ?? 0;

        int WebhooksIn(WebhookStatus status)
            => webhookCounts.FirstOrDefault(c => c.Status == status)?.Count ?? 0;

        // Calculate MRR and active subscription counts
        var now = _clock.UtcNow;
        var inSevenDays = now.AddDays(7);

        var activeSubs = await _db.Subscriptions
            .AsNoTracking()
            .Where(s => (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.Canceled)
                        && now < s.CurrentPeriodEndUtc)
            .Join(_db.Plans.AsNoTracking(),
                s => s.PlanId,
                p => p.Id,
                (s, p) => new
                {
                    s.Provider,
                    s.CurrentPeriodEndUtc,
                    p.AmountMinor,
                    p.Interval
                })
            .ToListAsync(cancellationToken);

        var activePaidSubs = activeSubs.Where(s => s.Provider != null).ToList();
        var activeSubscribersCount = activePaidSubs.Count;

        long mrrMinor = 0;
        foreach (var sub in activePaidSubs)
        {
            if (sub.Interval == BillingInterval.Monthly)
                mrrMinor += sub.AmountMinor;
            else if (sub.Interval == BillingInterval.Yearly)
                mrrMinor += (long)Math.Round(sub.AmountMinor / 12.0);
        }

        // Money in today, West Africa Time, one total per currency (never added across them): the phone admin's
        // Today tile. A ledger credit is a completed payment.
        var todayStartUtc = DateTime.SpecifyKind((now + FreeTier.WestAfricaOffset).Date - FreeTier.WestAfricaOffset, DateTimeKind.Utc);
        var today = await _db.LedgerEntries
            .AsNoTracking()
            .Where(e => e.Direction == LedgerDirection.Credit && e.CreatedAtUtc >= todayStartUtc)
            .Select(e => new { e.Currency, e.AmountMinor })
            .ToListAsync(cancellationToken);
        var paidToday = today
            .GroupBy(e => e.Currency.ToUpperInvariant())
            .OrderByDescending(g => g.Key == "NGN")
            .ThenBy(g => g.Key)
            .Select(g => new CurrencyAmountDto(g.Key, g.Sum(e => e.AmountMinor)))
            .ToList();

        var expiringInSevenDaysCount = activeSubs
            .Count(s => s.CurrentPeriodEndUtc < inSevenDays && s.CurrentPeriodEndUtc < NoteFusion.Core.Entities.Billing.Subscription.LifetimeEndUtc);

        return new PaymentOpsSummaryDto(
            PaymentsIn(PaymentStatus.Pending),
            PaymentsIn(PaymentStatus.Processing),
            PaymentsIn(PaymentStatus.Verified),
            PaymentsIn(PaymentStatus.Completed),
            PaymentsIn(PaymentStatus.Failed),
            stuckCount,
            oldestStuckSinceUtc,
            WebhooksIn(WebhookStatus.Received),
            WebhooksIn(WebhookStatus.Processed),
            WebhooksIn(WebhookStatus.Failed),
            oldestAwaitingWebhookAtUtc,
            credited,
            refunded,
            credited - refunded,
            currency,
            Math.Max(1, _settings.ReconciliationGraceMinutes),
            Math.Max(1, _settings.ReconciliationMinutes),
            mrrMinor,
            activeSubscribersCount,
            expiringInSevenDaysCount,
            paidToday,
            today.Count);
    }
}
