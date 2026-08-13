using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>Billing/payment error codes (module: billing).</summary>
public static class BillingErrors
{
    public static readonly Error PlanNotFound =
        Error.NotFound("BILLING_PLAN_NOT_FOUND", "That plan does not exist or is no longer offered.");

    public static readonly Error CurrencyUnsupported =
        Error.Failure("BILLING_CURRENCY_UNSUPPORTED", "No payment provider is available for this currency.");

    public static readonly Error ProviderNotConfigured =
        Error.Failure("BILLING_PROVIDER_NOT_CONFIGURED", "The selected payment provider is not configured.");

    public static Error GatewayInitiationFailed(string detail) =>
        Error.Network("BILLING_GATEWAY_INITIATION_FAILED", detail);

    public static readonly Error WebhookEventNotFound =
        Error.NotFound("BILLING_WEBHOOK_EVENT_NOT_FOUND", "The webhook event was not found.");

    public static readonly Error TransactionNotFound =
        Error.NotFound("BILLING_TRANSACTION_NOT_FOUND", "No payment matches the webhook reference.");

    public static readonly Error VerificationMismatch =
        Error.Conflict("BILLING_VERIFICATION_MISMATCH",
            "The provider's amount or currency did not match the payment; not fulfilling.");

    public static readonly Error NotAuthenticated =
        Error.Unauthorized("BILLING_NOT_AUTHENTICATED", "You must be signed in to do that.");
}
