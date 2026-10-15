namespace NoteFusion.Core.Enums;

/// <summary>Why a ledger entry exists, for the financial audit trail.</summary>
public enum LedgerEntryReason
{
    SubscriptionCharge = 1,
    Refund = 2,

    /// <summary>
    /// A one-off purchase of one transcription (a <c>Single</c> plan). The money record and the credit in
    /// one row: the account's bought transcriptions are counted from these entries, so the unique
    /// (transaction, reason) index that stops a payment being credited twice also stops it granting two.
    /// </summary>
    TranscriptionPurchase = 3
}
