using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Choirs;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Billing;

/// <summary>
/// The single place that turns a verified payment into its business effects: the completed status, the
/// immutable ledger credit, and the started-or-renewed subscription — or, for a one-song purchase
/// (<see cref="BillingInterval.Single"/>), the ledger credit alone, which is the bought transcription. Both the webhook worker and the
/// reconciliation job call this, so a payment is fulfilled identically whether we heard about it by
/// push (webhook) or by poll (reconciliation). It stages entity changes only — the caller commits them
/// through <see cref="SaveAsync(IApplicationDbContext, IReadOnlyList{Fulfillment}, CancellationToken)"/>
/// so every write, plus the caller's own bookkeeping, commits in ONE transaction. A verified success on a
/// row we had already failed reopens it first, so every path can rescue it. Fulfilling an
/// already-completed payment is a safe no-op (it returns null); a truly concurrent double-apply is
/// prevented by a unique (PaymentTransactionId, Reason) index on the ledger, and two different payments
/// extending one membership at once are serialised by the subscription's concurrency token.
/// </summary>
internal static class PaymentFulfillment
{
    /// <summary>How many times a save that lost a race on a subscription row is attempted in all.</summary>
    internal const int MaxSaveAttempts = 4;

    /// <summary>
    /// Stages the fulfilment and returns it, for the caller to commit through <see cref="SaveAsync"/> and
    /// read the receipt from afterwards. Building the receipt here, where the plan and the computed renewal
    /// date already live, keeps every fulfilment path sending the same one. Null when the payment was
    /// already fulfilled. The send itself is the caller's job, deliberately after the commit: a receipt
    /// must never be sent for a fulfilment that failed to commit.
    /// </summary>
    public static async Task<Fulfillment?> ApplyAsync(
        IApplicationDbContext db, PaymentTransaction tx, GatewayVerification verification, DateTime now, CancellationToken ct)
    {
        // Idempotent by contract: an already-completed payment was fulfilled by an earlier call (a
        // redelivered webhook, or the reconciliation sweep arriving after the webhook), so do nothing and
        // signal "no receipt to send". A genuinely simultaneous double-apply — two callers that both read
        // this tx as not-yet-completed — is stopped at the database by the unique (PaymentTransactionId,
        // Reason) index on the ledger, whose second insert rolls its transaction back.
        if (tx.Status == PaymentStatus.Completed)
            return null;

        // The provider's word on settlement outranks our own earlier verdict: a checkout we closed (a sweep,
        // an answer that later proved wrong) can still have been paid, and that customer is owed Pro.
        if (tx.Status == PaymentStatus.Failed)
            tx.Reopen(now);

        tx.MarkVerified(verification.ProviderReference, verification.Raw, now);
        tx.MarkCompleted(now);

        // The admins' "someone just paid" push, claimed in this same unit of work: it exists exactly when the
        // payment completed, and its unique payment id refuses a second one. The payment-alert worker sends it.
        db.AdminPaymentAlerts.Add(AdminPaymentAlert.Claim(tx.Id, now));

        var plan = await db.Plans.FirstOrDefaultAsync(p => p.Id == tx.PlanId, ct);

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == tx.UserId, ct);

        // One transcription bought: the ledger row is the whole effect. It records the money and is the credit
        // the free-tier gate counts (TrialUsage.CountBoughtAsync), so the unique (transaction, reason) index
        // that stops a double credit also stops a double grant. No membership is started or extended.
        if (plan?.Interval == BillingInterval.Single)
        {
            db.LedgerEntries.Add(LedgerEntry.Create(
                tx.UserId, tx.Id, LedgerDirection.Credit, LedgerEntryReason.TranscriptionPurchase,
                tx.AmountMinor, tx.Currency, plan.Name, now));

            return new Fulfillment(tx, verification, BillingInterval.Single, plan.Name, now)
            {
                Recipient = user is null ? null : new EmailRecipient(user.Email, user.FullName)
            };
        }

        db.LedgerEntries.Add(LedgerEntry.Create(
            tx.UserId, tx.Id, LedgerDirection.Credit, LedgerEntryReason.SubscriptionCharge,
            tx.AmountMinor, tx.Currency, plan?.Name ?? "Subscription charge", now));

        // A choir plan opens or extends the payer's choir, never their own Pro row: the two are bought and run
        // separately, so time paid for one is never converted into the other.
        if (plan?.ChoirSeats is { } seats)
            return await ApplyChoirAsync(db, tx, verification, plan, seats, user, now, ct);

        var fulfillment = new Fulfillment(tx, verification, plan?.Interval ?? BillingInterval.Monthly, plan?.Name, now);

        // A row this unit of work has already started (two payments for one member in one sweep) is not in
        // the database yet, so the change tracker is asked first; otherwise a second Start would trip the
        // unique index on UserId.
        var sub = db.Subscriptions.Local.FirstOrDefault(s => s.UserId == tx.UserId)
                  ?? await db.Subscriptions.FirstOrDefaultAsync(s => s.UserId == tx.UserId, ct);
        if (sub is null)
        {
            var renewsAtUtc = BillingPeriod.Advance(now, fulfillment.Interval);
            sub = Subscription.Start(
                tx.UserId, tx.PlanId, tx.Provider, now, renewsAtUtc, verification.ProviderSubscriptionRef, now);
            db.Subscriptions.Add(sub);
            fulfillment.Subscription = sub;
            fulfillment.RenewsAtUtc = renewsAtUtc;
        }
        else
        {
            fulfillment.Subscription = sub;
            fulfillment.Extend();
        }

        if (user is not null)
            fulfillment.Recipient = new EmailRecipient(user.Email, user.FullName);

        return fulfillment;
    }

    /// <summary>
    /// A choir plan paid for: the director's choir starts (named after them, with a fresh invite code) or its
    /// period stacks after the time it has left, exactly as a Pro renewal does. A director is in one choir:
    /// a seat they held in someone else's choir is given up, since they now lead their own.
    /// </summary>
    private static async Task<Fulfillment> ApplyChoirAsync(
        IApplicationDbContext db, PaymentTransaction tx, GatewayVerification verification, Plan plan, int seats,
        Core.Entities.User? user, DateTime now, CancellationToken ct)
    {
        var fulfillment = new Fulfillment(tx, verification, plan.Interval, plan.Name, now, seats)
        {
            Recipient = user is null ? null : new EmailRecipient(user.Email, user.FullName)
        };

        // The change tracker first, for two payments from one director in one sweep (see the Pro path).
        var choir = db.Choirs.Local.FirstOrDefault(c => c.OwnerId == tx.UserId)
                    ?? await db.Choirs.FirstOrDefaultAsync(c => c.OwnerId == tx.UserId, ct);
        if (choir is null)
        {
            var endsAtUtc = BillingPeriod.Advance(now, plan.Interval);
            choir = Choir.Start(
                tx.UserId, DefaultChoirName(user?.FullName), ChoirAccess.NewInviteCode(), plan.Id, seats, tx.Provider,
                now, endsAtUtc, now);
            db.Choirs.Add(choir);
            fulfillment.Choir = choir;
            fulfillment.RenewsAtUtc = endsAtUtc;
        }
        else
        {
            fulfillment.Choir = choir;
            fulfillment.Extend();
        }

        var seat = await db.ChoirMembers.FirstOrDefaultAsync(m => m.UserId == tx.UserId, ct);
        if (seat is not null)
            await ChoirAccess.DetachAsync(db, seat, ct);

        return fulfillment;
    }

    private static string DefaultChoirName(string? directorName)
    {
        var first = ChoirAccess.FirstName(directorName);
        return string.IsNullOrWhiteSpace(directorName) ? "My choir" : $"{first}'s choir";
    }

    /// <summary>
    /// Commits the caller's unit of work, fulfilment included. See the list overload.
    /// </summary>
    public static Task SaveAsync(IApplicationDbContext db, Fulfillment? fulfillment, CancellationToken ct)
        => SaveAsync(db, fulfillment is null ? [] : [fulfillment], ct);

    /// <summary>
    /// Commits the caller's unit of work, fulfilments included. When the save loses a race on a
    /// subscription row — another payment for the same member committed after this one read the row — the
    /// row is reloaded, every fulfilment staged on it is applied again from the fresh period end, and the
    /// save is retried, a bounded number of times. Nothing else is re-run: the transaction and ledger
    /// changes are still staged, and the ledger's unique index still refuses a second credit for one
    /// payment, so a retry can never fulfil the same payment twice.
    /// </summary>
    public static async Task SaveAsync(IApplicationDbContext db, IReadOnlyList<Fulfillment> fulfillments, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await db.SaveChangesAsync(ct);
                return;
            }
            catch (DbUpdateConcurrencyException ex)
                when (attempt < MaxSaveAttempts && ex.Entries.Count > 0 && ex.Entries.All(e => e.Entity is Subscription or Choir))
            {
                var reloaded = new HashSet<object>();
                foreach (var entry in ex.Entries)
                {
                    await entry.ReloadAsync(ct);

                    // Deleted under us: there is no row left to extend, so this is not a race to retry.
                    if (entry.State == EntityState.Detached)
                        throw;

                    reloaded.Add(entry.Entity);
                }

                // In the order they were staged, so two payments in one sweep still stack one after the other.
                foreach (var f in fulfillments)
                {
                    if ((f.Subscription is not null && reloaded.Contains(f.Subscription))
                        || (f.Choir is not null && reloaded.Contains(f.Choir)))
                        f.Extend();
                }
            }
        }
    }
}

/// <summary>
/// One staged fulfilment: what was paid for, the membership row it extends, and the receipt to send once
/// the caller has committed. An object rather than a finished receipt because the renewal date can still
/// move — a save that lost a race applies <see cref="Extend"/> again on the reloaded row.
/// </summary>
internal sealed class Fulfillment
{
    private readonly PaymentTransaction _tx;
    private readonly GatewayVerification _verification;
    private readonly string? _planName;
    private readonly DateTime _now;

    private readonly int _choirSeats;

    internal Fulfillment(
        PaymentTransaction tx, GatewayVerification verification, BillingInterval interval, string? planName, DateTime now,
        int choirSeats = 0)
    {
        _tx = tx;
        _verification = verification;
        Interval = interval;
        _planName = planName;
        _now = now;
        _choirSeats = choirSeats;
    }

    internal BillingInterval Interval { get; }
    internal Subscription? Subscription { get; set; }

    /// <summary>The choir a choir-plan payment opened or extended; null for every other payment.</summary>
    internal Choir? Choir { get; set; }
    internal DateTime RenewsAtUtc { get; set; }
    internal EmailRecipient? Recipient { get; set; }

    /// <summary>
    /// Who to thank and what to tell them. Null only if the paying user cannot be found — there is then no
    /// one to email, and a missing user for a settled payment is itself the caller's problem to notice.
    /// </summary>
    public FulfillmentReceipt? Receipt => Recipient is null
        ? null
        : Interval == BillingInterval.Single
            // One transcription bought: no period to state, and nothing about Pro.
            ? new FulfillmentReceipt(
                Recipient,
                new SubscriptionReceipt(
                    _planName ?? "One song", _tx.AmountMinor, _tx.Currency, null, _tx.Reference,
                    OneTranscription: true))
            : new FulfillmentReceipt(
                Recipient,
                new SubscriptionReceipt(
                    _planName ?? "NoteFusion Pro", _tx.AmountMinor, _tx.Currency,
                    // Null, not the sentinel: a lifetime purchase has no renewal date, and the receipt must
                    // not print 31 December 9999 at the customer who paid the most.
                    RenewsAtUtc >= Subscription.LifetimeEndUtc ? null : RenewsAtUtc,
                    _tx.Reference));

    /// <summary>Applies this payment's period to the existing membership row, from its current period end.</summary>
    internal void Extend()
    {
        if (Choir is { } choir)
        {
            // As a Pro renewal: from the later of now and the current period end, on the plan just bought.
            var from = choir.CurrentPeriodEndUtc > _now ? choir.CurrentPeriodEndUtc : _now;
            RenewsAtUtc = BillingPeriod.Advance(from, Interval);
            choir.Renew(from, RenewsAtUtc, _tx.PlanId, _choirSeats, _tx.Provider, _now);
            return;
        }

        var sub = Subscription!;
        if (sub.IsLifetime)
        {
            // Already sold outright. No later purchase can extend "forever", and advancing from the
            // sentinel would overflow DateTime, so leave the window alone and let the payment record
            // itself in the ledger. Once lifetime, always lifetime — a subsequent monthly charge
            // must never shorten access that was already paid for in full.
            RenewsAtUtc = sub.CurrentPeriodEndUtc;
            sub.AttachPayment(_tx.Provider, _verification.ProviderSubscriptionRef, _now);
            return;
        }

        // Renew from the later of "now" and the current period end, so an early renewal stacks the
        // remaining time instead of discarding it.
        var start = sub.CurrentPeriodEndUtc > _now ? sub.CurrentPeriodEndUtc : _now;
        RenewsAtUtc = BillingPeriod.Advance(start, Interval);
        sub.Renew(start, RenewsAtUtc, _now);

        // Switching monthly to yearly (or back): the new period is the new plan's, so the
        // membership is on that plan from here, and the remaining time stacks as above.
        if (sub.PlanId != _tx.PlanId)
            sub.SwitchPlan(_tx.PlanId, _now);

        // Whoever this row belonged to before, it is paid for now. Matters for the account that was
        // comped from the admin console and then bought: leaving the provider null would keep calling a
        // paying customer's subscription a gift.
        sub.AttachPayment(_tx.Provider, _verification.ProviderSubscriptionRef, _now);
    }
}

/// <summary>Who to thank and what to tell them, once a fulfilment has committed.</summary>
internal sealed record FulfillmentReceipt(EmailRecipient Recipient, SubscriptionReceipt Receipt);
