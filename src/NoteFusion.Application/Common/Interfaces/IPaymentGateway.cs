using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// One payment provider, behind a provider-agnostic contract. Every provider (Paystack, Flutterwave,
/// Bachs, Squad) implements this; the <see cref="IPaymentGatewayFactory"/> selects one at runtime, so
/// the choice of provider never leaks into the domain or the client. Implementations must be resilient
/// (retry transient failures with backoff) and must never apply business effects — they only initiate a
/// hosted checkout and report, authoritatively, what the provider says about a payment.
/// </summary>
public interface IPaymentGateway
{
    PaymentProvider Provider { get; }

    /// <summary>ISO 4217 codes this provider can charge in. Squad is NGN-only; card providers add USD.</summary>
    IReadOnlyCollection<string> SupportedCurrencies { get; }

    /// <summary>Opens a hosted-checkout session. On success returns the URL the app sends the user to.</summary>
    Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken cancellationToken);

    /// <summary>Asks the provider, authoritatively, what happened to a payment we referenced.</summary>
    Task<Result<GatewayVerification>> VerifyAsync(string reference, CancellationToken cancellationToken);
}

/// <summary>What we ask a provider to start collecting. Amount is in the currency's minor units.</summary>
public sealed record GatewayInitiationRequest(
    string Reference,
    long AmountMinor,
    string Currency,
    string CustomerEmail,
    string CallbackUrl,
    bool Recurring,
    string IdempotencyKey);

/// <summary>A provider's response to initiation: where to send the user, and the provider's own ref.</summary>
public sealed record GatewayInitiation(string CheckoutUrl, string? ProviderReference, string? Raw);

/// <summary>A provider's authoritative account of a payment, used to verify before fulfilling.</summary>
public sealed record GatewayVerification(
    bool Succeeded,
    long AmountMinor,
    string Currency,
    string ProviderReference,
    string? ProviderSubscriptionRef,
    string? Raw);
