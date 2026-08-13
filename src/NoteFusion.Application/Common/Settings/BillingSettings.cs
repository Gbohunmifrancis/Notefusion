namespace NoteFusion.Application.Common.Settings;

/// <summary>
/// Billing configuration (section <c>Billing</c>). Env-driven like the rest: <c>Billing__DefaultProvider</c>,
/// <c>Billing__CheckoutCallbackUrl</c>. Provider credentials live under their own sections (Paystack, etc.).
/// </summary>
public sealed class BillingSettings
{
    /// <summary>Provider chosen when a currency has more than one candidate. Matches a <c>PaymentProvider</c> name.</summary>
    public string DefaultProvider { get; init; } = "Paystack";

    /// <summary>
    /// Where the provider returns the user after hosted checkout. Deep-links back into the app
    /// (e.g. <c>notefusion://billing/return</c>); the real payment result arrives via webhook.
    /// </summary>
    public string CheckoutCallbackUrl { get; init; } = "notefusion://billing/return";

    /// <summary>How many times the webhook worker retries an event before parking it as Failed.</summary>
    public int MaxWebhookAttempts { get; init; } = 5;

    /// <summary>How often the webhook worker polls the inbox for undrained events.</summary>
    public int WebhookPollSeconds { get; init; } = 5;

    /// <summary>How often the reconciliation worker sweeps stuck transactions against the provider.</summary>
    public int ReconciliationMinutes { get; init; } = 15;
}
