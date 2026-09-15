using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>Billing/payment error codes (module: billing).</summary>
public static class BillingErrors
{
    public static readonly Error PlanNotFound =
        Error.NotFound("BILLING_PLAN_NOT_FOUND", "That plan does not exist or is no longer offered.");

    /// <summary>
    /// The plan exists, but not for this account's region. Deliberately distinct from
    /// <see cref="PlanNotFound"/>: a client that never showed the plan cannot have produced this by accident,
    /// so it means either a stale paywall or someone posting an id they were not given — and those want
    /// different follow-ups.
    /// </summary>
    public static readonly Error PlanNotAvailableInRegion =
        Error.Forbidden("BILLING_PLAN_NOT_AVAILABLE_IN_REGION",
            "That plan is not available in your region. Please choose one of the plans shown to you.");

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

    public static readonly Error SubscriptionNotFound =
        Error.NotFound("BILLING_SUBSCRIPTION_NOT_FOUND", "That subscription no longer exists.");

    public static readonly Error VerificationMismatch =
        Error.Conflict("BILLING_VERIFICATION_MISMATCH",
            "The provider's amount or currency did not match the payment; not fulfilling.");

    public static Error VerificationMismatchDetail(long expectedAmount, string expectedCurrency, long actualAmount, string actualCurrency, string? raw = null) =>
        Error.Conflict("BILLING_VERIFICATION_MISMATCH",
            $"The provider's amount or currency did not match the payment; not fulfilling. Expected {expectedAmount} {expectedCurrency}, received {actualAmount} '{actualCurrency}'. Raw: {raw}");

    public static readonly Error NotAuthenticated =
        Error.Unauthorized("BILLING_NOT_AUTHENTICATED", "You must be signed in to do that.");

    public static readonly Error NoActiveSubscription =
        Error.NotFound("BILLING_NO_ACTIVE_SUBSCRIPTION", "You do not have an active subscription to cancel.");

    public static readonly Error LifetimeNotCancelable =
        Error.Failure("BILLING_LIFETIME_NOT_CANCELABLE",
            "Lifetime access was bought outright, so there is nothing to cancel.");

    /// <summary>
    /// Takes the allowance that was actually enforced, because it is regional — naming a global number here
    /// would contradict the count the trial pill had been showing that user all along.
    /// </summary>
    public static Error FreeTierLimitReached(int allowance) =>
        Error.Forbidden("BILLING_FREE_TIER_LIMIT",
            $"You have used all {allowance} of your free transcriptions. "
            + "Upgrade to Pro for unlimited transcriptions.");
}
