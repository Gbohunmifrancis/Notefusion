namespace NoteFusion.Core.Enums;

/// <summary>
/// The strict payment lifecycle. Every transition is enforced by
/// <see cref="Entities.Billing.PaymentTransaction"/>; an illegal jump is a programmer error
/// (it throws), not a recoverable failure.
/// </summary>
/// <remarks>
/// <c>Pending</c> is persisted BEFORE the provider is ever called, so a crash mid-initiation
/// still leaves an auditable row. <c>Processing</c> means the provider accepted the initiation
/// and a hosted-checkout URL was attached. <c>Verified</c> means the provider confirmed the money
/// moved — signature, reference, amount and currency all matched — but the business effect has
/// not been applied yet. <c>Completed</c> means the ledger entry and subscription were written
/// exactly once. A verified payment whose fulfilment fails stays <c>Verified</c> for retry; it
/// never regresses to <c>Failed</c>, because the money is already taken.
/// </remarks>
public enum PaymentStatus
{
    Pending = 0,
    Processing = 1,
    Verified = 2,
    Completed = 3,
    Failed = 4
}
