using Microsoft.EntityFrameworkCore;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The ledger's money-safety backstop, at the layer that must hold even when the application guards
/// race: the database itself refuses a second credit for a payment. A verified payment yields exactly
/// one SubscriptionCharge credit, so two fulfilment paths that both slip past the status checks
/// (overlapping webhook workers, or a webhook racing reconciliation) cannot both persist — the unique
/// (PaymentTransactionId, Reason) index rolls the second one back. Without that index the first test
/// fails, which is the whole point: it pins the guarantee, not today's happy path.
/// </summary>
public class LedgerUniquenessTests
{
    private static readonly DateTime Now = new(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task A_transaction_cannot_be_credited_twice_for_the_same_reason()
    {
        using var harness = new TestHarness();
        var db = harness.Db;

        var userId = Guid.NewGuid();
        var txId = Guid.NewGuid();

        db.LedgerEntries.Add(LedgerEntry.Create(
            userId, txId, LedgerDirection.Credit, LedgerEntryReason.SubscriptionCharge, 499, "USD", "Pro monthly", Now));
        await db.SaveChangesAsync();

        // A second processor fulfilling the same payment stages an identical credit. The database is the
        // last line of defence against a double-charge and must reject it.
        db.LedgerEntries.Add(LedgerEntry.Create(
            userId, txId, LedgerDirection.Credit, LedgerEntryReason.SubscriptionCharge, 499, "USD", "Pro monthly", Now));

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task A_refund_is_a_different_reason_so_it_still_persists_for_the_same_transaction()
    {
        using var harness = new TestHarness();
        var db = harness.Db;

        var userId = Guid.NewGuid();
        var txId = Guid.NewGuid();

        // Uniqueness is on (transaction, reason), not the transaction alone — a charge and its refund are
        // distinct reasons and both belong on the ledger. This guards against an over-broad constraint.
        db.LedgerEntries.Add(LedgerEntry.Create(
            userId, txId, LedgerDirection.Credit, LedgerEntryReason.SubscriptionCharge, 499, "USD", "Pro monthly", Now));
        db.LedgerEntries.Add(LedgerEntry.Create(
            userId, txId, LedgerDirection.Debit, LedgerEntryReason.Refund, 499, "USD", "Refund", Now));

        await db.SaveChangesAsync();

        Assert.Equal(2, await db.LedgerEntries.CountAsync());
    }
}
