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

    /// <summary>
    /// The payment page could not be opened. Deliberately says nothing about why: the provider's own
    /// reason (an error code, an HTTP status, an account setting) is for the log and the transaction row,
    /// never for the customer's screen.
    /// </summary>
    public static readonly Error GatewayInitiationFailed =
        Error.Network("BILLING_GATEWAY_INITIATION_FAILED",
            "We couldn't open the payment page just now. Please try again in a minute.");

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
            $"The provider's amount or currency did not match the payment; not fulfilling. Expected {expectedAmount} {expectedCurrency}, received {actualAmount} '{actualCurrency}'.");

    public static readonly Error NotAuthenticated =
        Error.Unauthorized("BILLING_NOT_AUTHENTICATED", "You must be signed in to do that.");

    public static readonly Error NoActiveSubscription =
        Error.NotFound("BILLING_NO_ACTIVE_SUBSCRIPTION", "You do not have an active subscription to cancel.");

    /// <summary>Lifetime access was bought outright; there is nothing more to buy.</summary>
    public static readonly Error AlreadyLifetime =
        Error.Conflict("BILLING_ALREADY_LIFETIME", "You have lifetime Pro, so there is nothing more to buy.");

    public static readonly Error LifetimeNotCancelable =
        Error.Failure("BILLING_LIFETIME_NOT_CANCELABLE",
            "Lifetime access was bought outright, so there is nothing to cancel.");

    /// <summary>
    /// Takes the allowance that was actually enforced, because it is regional — naming a global number here
    /// would contradict the count the trial pill had been showing that user all along.
    /// </summary>
    /// <summary>A Pro account has used this month's song allowance; the number named is the one enforced.</summary>
    public static Error SongCreditsExhausted(int allowance) =>
        Error.Forbidden("BILLING_SONG_CREDITS_EXHAUSTED",
            $"You have transcribed all {allowance} of this month's songs. Your allowance resets next month.");

    /// <summary>
    /// A choir's shared monthly pool is spent (or held by songs still running). Same code as
    /// <see cref="SongCreditsExhausted"/>, so the clients treat it the same way.
    /// </summary>
    public static Error ChoirSongsExhausted(int pool) =>
        Error.Forbidden("BILLING_SONG_CREDITS_EXHAUSTED",
            $"Your choir has transcribed all {pool} of this month's songs. The choir's songs reset next month.");

    /// <summary>
    /// A Pro account already has <paramref name="max"/> songs running. Songs take the worker's fast lane, so
    /// one account starting many at once would hold every other subscriber up behind it.
    /// </summary>
    public static Error SongsInProgress(int max) =>
        Error.Conflict("BILLING_SONGS_IN_PROGRESS",
            $"You have {max} songs in progress. Wait for one to finish, then try again.");

    /// <summary>
    /// A free account has had its one song preview and has no bought transcription left; a whole song takes
    /// one bought transcription, or Pro.
    /// </summary>
    public static readonly Error SongPreviewUsed =
        Error.Forbidden("BILLING_SONG_PREVIEW_USED",
            "You have used your free song preview. Buy just this song, or upgrade to Pro to transcribe full songs from a link.");

    /// <summary>
    /// The free tier is spent, bought transcriptions included. Takes both numbers that were actually
    /// enforced, so the refusal agrees with the count the app had been showing.
    /// </summary>
    public static Error FreeTierLimitReached(int free, int bought = 0) =>
        Error.Forbidden("BILLING_FREE_TIER_LIMIT",
            (bought > 0
                ? $"You have used all {free} of your free transcriptions and the {bought} you bought. "
                : $"You have used all {free} of your free transcriptions. ")
            + "Buy just this song, or upgrade to Pro for unlimited transcriptions.");

    /// <summary>
    /// A Pro member asked for a one-song purchase. Pro already includes every transcription, so the
    /// purchase would be money for nothing; the paywall hides the product from members and this holds it.
    /// </summary>
    public static readonly Error SingleNotNeededOnPro =
        Error.Conflict("BILLING_SINGLE_NOT_NEEDED",
            "You're on Pro, so every transcription is already included. There is nothing more to buy.");
}
