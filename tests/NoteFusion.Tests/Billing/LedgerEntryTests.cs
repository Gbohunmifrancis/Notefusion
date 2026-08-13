using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The ledger is the single source of truth for money held: there is no mutable balance column, so
/// a balance is only ever the sum of signed entries. These tests pin that arithmetic and the sign
/// convention, because a wrong sign is the difference between owing a refund and pocketing it.
/// </summary>
public class LedgerEntryTests
{
    private static readonly DateTime Now = new(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
    private static readonly Guid User = Guid.NewGuid();
    private static readonly Guid Tx = Guid.NewGuid();

    [Fact]
    public void A_credit_is_positive_and_a_debit_is_negative()
    {
        var charge = LedgerEntry.Create(
            User, Tx, LedgerDirection.Credit, LedgerEntryReason.SubscriptionCharge, 999, "USD", "Pro monthly", Now);
        var refund = LedgerEntry.Create(
            User, Tx, LedgerDirection.Debit, LedgerEntryReason.Refund, 999, "USD", "Refund", Now);

        Assert.Equal(999, charge.SignedAmountMinor);
        Assert.Equal(-999, refund.SignedAmountMinor);
    }

    [Fact]
    public void Balance_is_the_sum_of_signed_entries()
    {
        LedgerEntry[] entries =
        [
            LedgerEntry.Create(User, Tx, LedgerDirection.Credit, LedgerEntryReason.SubscriptionCharge, 999, "USD", "m1", Now),
            LedgerEntry.Create(User, Tx, LedgerDirection.Credit, LedgerEntryReason.SubscriptionCharge, 999, "USD", "m2", Now),
            LedgerEntry.Create(User, Tx, LedgerDirection.Debit, LedgerEntryReason.Refund, 999, "USD", "r1", Now),
        ];

        var balance = entries.Sum(e => e.SignedAmountMinor);

        Assert.Equal(999, balance);
    }

    [Fact]
    public void Rejects_a_non_positive_amount()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => LedgerEntry.Create(
            User, Tx, LedgerDirection.Credit, LedgerEntryReason.SubscriptionCharge, -1, "USD", "bad", Now));
    }

    [Fact]
    public void Has_no_public_mutators_so_entries_are_append_only()
    {
        // Immutability is the whole point of a ledger; a settable property would let a bug rewrite
        // history. Assert the shape directly so a future "convenience" setter fails this test.
        var settable = typeof(LedgerEntry)
            .GetProperties()
            .Where(p => p.SetMethod is { IsPublic: true })
            .Select(p => p.Name)
            .ToArray();

        Assert.Empty(settable);
    }
}
