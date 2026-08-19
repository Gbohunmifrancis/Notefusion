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
    Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken cancellationToken);
}

/// <summary>Everything we hold that could identify a payment to the provider.</summary>
/// <param name="Reference">
/// Our own reference, always present. Providers that let us look a payment up by it use this.
/// </param>
/// <param name="ProviderReference">
/// The provider's own id for the attempt, learned at initiation — <c>null</c> until then. Some providers
/// have no way to resolve our reference and can only be queried by their own id, so the adapter needs
/// both and decides which it can use. A provider that requires this must treat a null as a transient
/// failure, not a decline: not knowing the id is not evidence the payment failed.
/// </param>
public sealed record GatewayVerificationRequest(string Reference, string? ProviderReference);

/// <summary>What we ask a provider to start collecting. Amount is in the currency's minor units.</summary>
/// <param name="IdempotencyKey">
/// Stable for the lifetime of one initiation attempt: a retry MUST present the same key with the same
/// body so the provider recognises it as a replay and returns the original session instead of opening a
/// second one. Regenerating it per call defeats the provider's replay protection entirely.
/// </param>
/// <param name="PlanCode">
/// Our own plan code (e.g. <c>pro_monthly</c>). Providers that sell pre-registered products rather than
/// ad-hoc amounts need it to look up their product id for this plan; providers that charge an amount
/// directly ignore it. It stays a NoteFusion concept, so no provider vocabulary leaks into the contract.
/// </param>
/// <param name="CustomerName">
/// The payer's display name. Some providers require it when creating a customer, so it travels with the
/// email rather than being reconstructed from it. May be blank — a profile is not obliged to have one.
/// </param>
public sealed record GatewayInitiationRequest(
    string Reference,
    long AmountMinor,
    string Currency,
    string CustomerEmail,
    string CallbackUrl,
    bool Recurring,
    string IdempotencyKey,
    string PlanCode,
    string? CustomerName);

/// <summary>A provider's response to initiation: where to send the user, and the provider's own ref.</summary>
public sealed record GatewayInitiation(string CheckoutUrl, string? ProviderReference, string? Raw);

/// <summary>A provider's authoritative account of a payment, used to verify before fulfilling.</summary>
/// <param name="Terminal">
/// True when this is the provider's last word: the attempt can never become a success. Only consulted
/// when <paramref name="Succeeded"/> is false, and defaulted to <c>false</c> because that is the safe
/// answer — a checkout reported as still open is simply asked again, whereas one wrongly reported as
/// final is closed while the customer may be a keystroke away from paying it. An expired or cancelled
/// session is final; one the customer has merely not paid yet is not.
/// </param>
public sealed record GatewayVerification(
    bool Succeeded,
    long AmountMinor,
    string Currency,
    string ProviderReference,
    string? ProviderSubscriptionRef,
    string? Raw,
    bool Terminal = false);
