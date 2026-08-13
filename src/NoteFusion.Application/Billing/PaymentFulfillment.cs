using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Billing;

/// <summary>
/// The single place that turns a verified payment into its business effects: the completed status, the
/// immutable ledger credit, and the started-or-renewed subscription. Both the webhook worker and the
/// reconciliation job call this, so a payment is fulfilled identically whether we heard about it by
/// push (webhook) or by poll (reconciliation). It stages entity changes only — the caller owns the
/// <c>SaveChangesAsync</c> so every write, plus the caller's own bookkeeping, commits in ONE
/// transaction. Fulfilling an already-completed payment is a safe no-op (it returns null); a truly
/// concurrent double-apply is prevented by a unique (PaymentTransactionId, Reason) index on the ledger.
/// </summary>
internal static class PaymentFulfillment
{
    /// <summary>
    /// Stages the fulfilment and returns the receipt to email once the caller commits. Building it here,
    /// where the plan and the computed renewal date already live, keeps both fulfilment paths sending the
    /// same receipt. Null only if the paying user cannot be found — there is then no one to email, and a
    /// missing user for a settled payment is itself the caller's problem to notice, not this method's.
    /// The send itself is the caller's job, deliberately after <c>SaveChangesAsync</c>: a receipt must
    /// never be sent for a fulfilment that failed to commit.
    /// </summary>
    public static async Task<FulfillmentReceipt?> ApplyAsync(
        IApplicationDbContext db, PaymentTransaction tx, GatewayVerification verification, DateTime now, CancellationToken ct)
    {
        // Idempotent by contract: an already-completed payment was fulfilled by an earlier call (a
        // redelivered webhook, or the reconciliation sweep arriving after the webhook), so do nothing and
        // signal "no receipt to send". A genuinely simultaneous double-apply — two callers that both read
        // this tx as not-yet-completed — is stopped at the database by the unique (PaymentTransactionId,
        // Reason) index on the ledger, whose second insert rolls its transaction back.
        if (tx.Status == PaymentStatus.Completed)
            return null;

        tx.MarkVerified(verification.ProviderReference, verification.Raw, now);
        tx.MarkCompleted(now);

        var plan = await db.Plans.FirstOrDefaultAsync(p => p.Id == tx.PlanId, ct);

        db.LedgerEntries.Add(LedgerEntry.Create(
            tx.UserId, tx.Id, LedgerDirection.Credit, LedgerEntryReason.SubscriptionCharge,
            tx.AmountMinor, tx.Currency, plan?.Name ?? "Subscription charge", now));

        var interval = plan?.Interval ?? BillingInterval.Monthly;
        var sub = await db.Subscriptions.FirstOrDefaultAsync(s => s.UserId == tx.UserId, ct);
        DateTime renewsAtUtc;
        if (sub is null)
        {
            renewsAtUtc = Advance(now, interval);
            db.Subscriptions.Add(Subscription.Start(
                tx.UserId, tx.PlanId, tx.Provider, now, renewsAtUtc, verification.ProviderSubscriptionRef, now));
        }
        else
        {
            // Renew from the later of "now" and the current period end, so an early renewal stacks the
            // remaining time instead of discarding it.
            var start = sub.CurrentPeriodEndUtc > now ? sub.CurrentPeriodEndUtc : now;
            renewsAtUtc = Advance(start, interval);
            sub.Renew(start, renewsAtUtc, now);
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == tx.UserId, ct);
        if (user is null)
            return null;

        return new FulfillmentReceipt(
            new EmailRecipient(user.Email, user.FullName),
            new SubscriptionReceipt(
                plan?.Name ?? "NoteFusion Pro", tx.AmountMinor, tx.Currency, renewsAtUtc, tx.Reference));
    }

    private static DateTime Advance(DateTime from, BillingInterval interval)
        => interval == BillingInterval.Monthly ? from.AddMonths(1) : from.AddYears(1);
}

/// <summary>Who to thank and what to tell them, once a fulfilment has committed.</summary>
internal sealed record FulfillmentReceipt(EmailRecipient Recipient, SubscriptionReceipt Receipt);
