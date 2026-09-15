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
    /// Where the provider returns the browser after hosted checkout. **Must be an absolute http(s) URL**:
    /// Hosted checkouts (Paystack, Flutterwave, Bachs) reject or ignore custom URI schemes directly,
    /// so point it at the API's own <c>GET /api/billing/return</c>, which instantly hands off to the
    /// app's deep link (<c>notefusion://billing/return</c>) to auto-dismiss the in-app browser.
    /// </summary>
    public string CheckoutCallbackUrl { get; init; } = "https://notefusion-api-3c2513a1e974.herokuapp.com/api/billing/return";

    /// <summary>How many times the webhook worker retries an event before parking it as Failed.</summary>
    public int MaxWebhookAttempts { get; init; } = 5;

    /// <summary>How often the webhook worker polls the inbox for undrained events.</summary>
    public int WebhookPollSeconds { get; init; } = 3;

    /// <summary>How often the reconciliation worker sweeps stuck transactions against the provider.</summary>
    public int ReconciliationMinutes { get; init; } = 15;

    /// <summary>
    /// How long a payment may sit in <c>Processing</c> before the reconciliation sweep treats it as stuck.
    /// Long enough for the normal webhook or instant client confirm to arrive, so the sweep does not race the primary path.
    /// </summary>
    /// <remarks>
    /// Settings rather than a constant in the worker because the admin console reports the same threshold —
    /// it flags stuck payments and prints the window as the definition of "stuck". Two copies of the number
    /// would eventually disagree, and the console would then be explaining a rule the worker does not follow.
    /// </remarks>
    public int ReconciliationGraceMinutes { get; init; } = 10;

    /// <summary>
    /// How often the expiry worker looks for subscriptions ending soon. Twice a day by default — the
    /// notice window is a week wide, so a tighter loop would only re-scan the same rows.
    /// </summary>
    public int ExpiryNoticeMinutes { get; init; } = 720;

    /// <summary>
    /// How often the stale payment cleanup worker sweeps to clear abandoned or expired payments.
    /// Runs hourly by default.
    /// </summary>
    public int StalePaymentSweepMinutes { get; init; } = 60;

    /// <summary>
    /// How many hours a Pending payment with no checkout session may sit before being cleared as expired.
    /// </summary>
    public int StalePendingHours { get; init; } = 2;

    /// <summary>
    /// How many hours a Processing payment may sit before being confirmed expired and cleared.
    /// Standard hosted checkout sessions across payment gateways expire within 24 hours.
    /// </summary>
    public int StaleProcessingHours { get; init; } = 24;
}
