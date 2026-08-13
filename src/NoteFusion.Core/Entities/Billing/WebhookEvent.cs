using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities.Billing;

/// <summary>
/// A persisted provider webhook — the inbox that makes processing exactly-once. The signature is
/// verified BEFORE this row is written; a unique (Provider, ProviderEventId) index means a replayed
/// webhook collides on insert and is recognised as already-received. A background worker drains
/// unprocessed rows, applies the business effect in one transaction, then marks the row Processed.
/// </summary>
public class WebhookEvent : BaseEntity
{
    private WebhookEvent() { } // EF Core

    public PaymentProvider Provider { get; private set; }

    /// <summary>The provider's own event id (dedupe key). Unique per provider.</summary>
    public string ProviderEventId { get; private set; } = string.Empty;

    public string EventType { get; private set; } = string.Empty;

    /// <summary>Our payment reference extracted from the payload, linking the event to a transaction.</summary>
    public string? PaymentReference { get; private set; }

    /// <summary>Raw request body, retained verbatim for reprocessing and dispute evidence.</summary>
    public string Payload { get; private set; } = string.Empty;

    public WebhookStatus Status { get; private set; }
    public int ProcessAttempts { get; private set; }
    public string? LastError { get; private set; }

    public DateTime ReceivedAtUtc { get; private set; }
    public DateTime? LastAttemptAtUtc { get; private set; }
    public DateTime? ProcessedAtUtc { get; private set; }

    public static WebhookEvent Receive(
        PaymentProvider provider, string providerEventId, string eventType,
        string? paymentReference, string payload, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            Provider = provider,
            ProviderEventId = Guard.NotNullOrWhiteSpace(providerEventId),
            EventType = Guard.NotNullOrWhiteSpace(eventType),
            PaymentReference = paymentReference,
            Payload = Guard.NotNull(payload),
            Status = WebhookStatus.Received,
            ReceivedAtUtc = utcNow
        };

    public void MarkProcessed(DateTime utcNow)
    {
        Status = WebhookStatus.Processed;
        ProcessedAtUtc = utcNow;
        LastAttemptAtUtc = utcNow;
        LastError = null;
    }

    /// <summary>
    /// Records a failed processing attempt. The row stays <see cref="WebhookStatus.Received"/> (so
    /// the worker retries it) until attempts are exhausted, then flips to
    /// <see cref="WebhookStatus.Failed"/> for the reconciliation job to pick up.
    /// </summary>
    public void RecordFailure(string error, int maxAttempts, DateTime utcNow)
    {
        ProcessAttempts++;
        LastError = error;
        LastAttemptAtUtc = utcNow;
        if (ProcessAttempts >= maxAttempts)
            Status = WebhookStatus.Failed;
    }
}
