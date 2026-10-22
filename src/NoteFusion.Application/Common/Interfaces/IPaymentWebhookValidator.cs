using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Verifies a provider webhook's authenticity and extracts the fields the inbox needs. One
/// implementation per provider; the API controller resolves the right one by <see cref="Provider"/>.
/// Validation (signature check) MUST happen before any business logic — an unsigned or mis-signed
/// request never reaches the inbox.
/// </summary>
public interface IPaymentWebhookValidator
{
    PaymentProvider Provider { get; }

    /// <summary>
    /// Checks the signature against the raw body and, if valid, returns the identifying fields.
    /// A signature failure returns <see cref="ErrorType.Unauthorized"/>; a malformed body returns
    /// a validation error. The raw body must be the exact bytes received (signatures are byte-exact).
    /// </summary>
    Result<WebhookMessage> Validate(WebhookRequest request);
}

/// <summary>The raw webhook as received: exact body plus headers (lookups are case-insensitive).</summary>
/// <param name="RawBytes">
/// The body's bytes exactly as they arrived, for a validator that signs over bytes. Decoding to
/// <paramref name="RawBody"/> and encoding back is byte-identical for the UTF-8 JSON providers send, but the
/// signature is defined over what was received, so a validator hashes these when they are given.
/// </param>
public sealed record WebhookRequest(string RawBody, IReadOnlyDictionary<string, string> Headers, byte[]? RawBytes = null);

/// <summary>The fields lifted from a verified webhook, enough to persist and route it.</summary>
/// <param name="Settles">
/// Whether this event can settle a payment (a checkout completed or expired, money collected). One that
/// cannot — a payout, a dispute, a subscription notice — is stored and acknowledged at once rather than handed
/// to the worker, which would retry it until it parked as failed.
/// </param>
public sealed record WebhookMessage(string ProviderEventId, string EventType, string? PaymentReference, bool Settles = true);
