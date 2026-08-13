namespace NoteFusion.Core.Enums;

/// <summary>
/// Sign of an immutable ledger entry. A balance is never stored as a mutable column — it is always
/// the sum of credits minus debits over the entry history, so the audit trail is the source of truth.
/// </summary>
public enum LedgerDirection
{
    /// <summary>Money in — a successful charge.</summary>
    Credit = 1,

    /// <summary>Money out — a refund.</summary>
    Debit = 2
}
