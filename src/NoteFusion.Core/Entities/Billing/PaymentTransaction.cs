using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Core.ValueObjects;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities.Billing;

/// <summary>
/// One attempt to collect money from a user for a plan, and the audit record of that attempt.
/// The status field is a strict state machine (<see cref="PaymentStatus"/>): the row is created
/// <c>Pending</c> before the provider is ever called, moves to <c>Processing</c> once a
/// hosted-checkout URL is attached, to <c>Verified</c> when the provider confirms the money moved,
/// and to <c>Completed</c> when the ledger entry and subscription are written. Every transition is
/// guarded here so no caller can skip a step; repeated calls to the same target are no-ops, so a
/// replayed webhook is harmless.
/// </summary>
public class PaymentTransaction : BaseEntity
{
    private PaymentTransaction() { } // EF Core

    /// <summary>Owner of the payment.</summary>
    public Guid UserId { get; private set; }

    /// <summary>Plan being purchased.</summary>
    public Guid PlanId { get; private set; }

    public PaymentProvider Provider { get; private set; }

    /// <summary>
    /// Deduplicates retries of the same initiation. A second initiate with the same key must return
    /// the existing transaction rather than create a new one, so a double-tap never double-charges.
    /// </summary>
    public string IdempotencyKey { get; private set; } = string.Empty;

    /// <summary>Our own reference, generated up front and sent to the provider so a webhook maps back to this row.</summary>
    public string Reference { get; private set; } = string.Empty;

    /// <summary>The provider's own reference/id, learned at initiation or verification.</summary>
    public string? ProviderReference { get; private set; }

    /// <summary>Amount in the currency's minor units (cents for USD). Integral to avoid float drift.</summary>
    public long AmountMinor { get; private set; }

    /// <summary>ISO 4217 code, upper-case.</summary>
    public string Currency { get; private set; } = "USD";

    public PaymentStatus Status { get; private set; }

    /// <summary>Provider-hosted checkout URL the mobile app opens in an external browser (Spotify-style).</summary>
    public string? CheckoutUrl { get; private set; }

    public string? FailureReason { get; private set; }

    // Raw provider payloads, retained verbatim for dispute/audit. Mapped as jsonb in Postgres.
    public string? InitiateRaw { get; private set; }
    public string? VerifyRaw { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    public bool IsTerminal => Status is PaymentStatus.Completed or PaymentStatus.Failed;

    /// <summary>Monetary representation as a strongly typed domain Value Object.</summary>
    public Money Money => Money.FromMinorUnit(AmountMinor, Currency);

    /// <summary>
    /// Asserts that a received amount and currency match this payment transaction exactly.
    /// Prevents underpayment fraud or currency tampering.
    /// </summary>
    public void AssertAmountMatches(long receivedAmountMinor, string receivedCurrency)
    {
        if (!string.Equals(Currency, receivedCurrency, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"Payment currency mismatch on reference '{Reference}': expected '{Currency}', received '{receivedCurrency}'.");

        if (AmountMinor != receivedAmountMinor)
            throw new InvalidOperationException(
                $"Payment amount mismatch on reference '{Reference}': expected {AmountMinor} {Currency}, received {receivedAmountMinor} {receivedCurrency}.");
    }

    public static PaymentTransaction Create(
        Guid userId,
        Guid planId,
        PaymentProvider provider,
        string idempotencyKey,
        string reference,
        long amountMinor,
        string currency,
        DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            PlanId = Guard.AgainstEmpty(planId),
            Provider = provider,
            IdempotencyKey = Guard.NotNullOrWhiteSpace(idempotencyKey),
            Reference = Guard.NotNullOrWhiteSpace(reference),
            AmountMinor = amountMinor > 0
                ? amountMinor
                : throw new ArgumentOutOfRangeException(nameof(amountMinor), amountMinor, "Amount must be positive."),
            Currency = Guard.NotNullOrWhiteSpace(currency).ToUpperInvariant(),
            Status = PaymentStatus.Pending,
            CreatedAtUtc = utcNow,
            UpdatedAtUtc = utcNow
        };

    /// <summary>Pending → Processing once the provider accepts the initiation and returns a checkout URL.</summary>
    public void AttachCheckout(string? providerReference, string checkoutUrl, string? initiateRaw, DateTime utcNow)
    {
        RequireStatus(nameof(AttachCheckout), PaymentStatus.Pending);
        if (!string.IsNullOrWhiteSpace(providerReference))
            ProviderReference = providerReference;
        CheckoutUrl = Guard.NotNullOrWhiteSpace(checkoutUrl);
        InitiateRaw = initiateRaw;
        Status = PaymentStatus.Processing;
        Touch(utcNow);
    }

    /// <summary>
    /// Processing → Verified when the provider confirms the money moved (signature, reference,
    /// amount and currency already checked by the caller). Idempotent: a duplicate confirmation
    /// (already Verified or Completed) is a no-op, so replayed webhooks are safe.
    /// </summary>
    public void MarkVerified(string providerReference, string? verifyRaw, DateTime utcNow)
    {
        if (Status is PaymentStatus.Verified or PaymentStatus.Completed) return;
        RequireStatus(nameof(MarkVerified), PaymentStatus.Processing);
        ProviderReference = Guard.NotNullOrWhiteSpace(providerReference);
        VerifyRaw = verifyRaw;
        Status = PaymentStatus.Verified;
        Touch(utcNow);
    }

    /// <summary>Verified → Completed once the ledger entry and subscription are written. Idempotent.</summary>
    public void MarkCompleted(DateTime utcNow)
    {
        if (Status == PaymentStatus.Completed) return;
        RequireStatus(nameof(MarkCompleted), PaymentStatus.Verified);
        Status = PaymentStatus.Completed;
        Touch(utcNow);
    }

    /// <summary>
    /// Marks the attempt failed. Legal only from a pre-money state (Pending/Processing): once a
    /// payment is Verified the money is taken, so it must be reconciled, never silently failed.
    /// Idempotent when already Failed.
    /// </summary>
    public void MarkFailed(string reason, DateTime utcNow)
    {
        if (Status == PaymentStatus.Failed) return;
        RequireStatus(nameof(MarkFailed), PaymentStatus.Pending, PaymentStatus.Processing);
        FailureReason = Guard.NotNullOrWhiteSpace(reason);
        Status = PaymentStatus.Failed;
        Touch(utcNow);
    }

    private void Touch(DateTime utcNow) => UpdatedAtUtc = utcNow;

    private void RequireStatus(string operation, params PaymentStatus[] allowed)
    {
        if (Array.IndexOf(allowed, Status) < 0)
            throw new InvalidOperationException(
                $"{operation} is not allowed from status {Status}; expected one of {string.Join(", ", allowed)}.");
    }
}
