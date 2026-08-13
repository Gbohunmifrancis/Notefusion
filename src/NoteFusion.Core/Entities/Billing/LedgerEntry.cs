using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities.Billing;

/// <summary>
/// An immutable, append-only record of one money movement. There is no mutable balance column
/// anywhere in the system: a balance is always computed as the sum of credits minus debits over
/// these entries (see the ledger-balance query). Entries are never updated or deleted — a mistake
/// is corrected by appending a compensating entry, which keeps the audit trail complete.
/// </summary>
public sealed class LedgerEntry : BaseEntity
{
    private LedgerEntry() { } // EF Core

    public Guid UserId { get; private set; }

    /// <summary>The payment this entry records. Both charges and refunds trace to a transaction.</summary>
    public Guid PaymentTransactionId { get; private set; }

    public LedgerDirection Direction { get; private set; }
    public LedgerEntryReason Reason { get; private set; }

    /// <summary>Always positive; the sign for balance math comes from <see cref="Direction"/>.</summary>
    public long AmountMinor { get; private set; }

    public string Currency { get; private set; } = "USD";
    public string Description { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>Signed contribution to a balance: positive for a credit, negative for a debit.</summary>
    public long SignedAmountMinor => Direction == LedgerDirection.Credit ? AmountMinor : -AmountMinor;

    public static LedgerEntry Create(
        Guid userId,
        Guid paymentTransactionId,
        LedgerDirection direction,
        LedgerEntryReason reason,
        long amountMinor,
        string currency,
        string description,
        DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            PaymentTransactionId = Guard.AgainstEmpty(paymentTransactionId),
            Direction = direction,
            Reason = reason,
            AmountMinor = amountMinor > 0
                ? amountMinor
                : throw new ArgumentOutOfRangeException(nameof(amountMinor), amountMinor, "Amount must be positive."),
            Currency = Guard.NotNullOrWhiteSpace(currency).ToUpperInvariant(),
            Description = Guard.NotNullOrWhiteSpace(description),
            CreatedAtUtc = utcNow
        };
}
