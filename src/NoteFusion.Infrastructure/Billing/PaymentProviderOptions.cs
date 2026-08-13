namespace NoteFusion.Infrastructure.Billing;

/// <summary>
/// Credentials and endpoints for one payment provider, bound from its own config section
/// (env-driven: <c>Paystack__SecretKey</c>, <c>Paystack__BaseUrl</c>, …). Secrets never have
/// defaults — an unconfigured provider is simply disabled, so nothing ships with a baked-in key.
/// </summary>
public sealed class PaymentProviderOptions
{
    /// <summary>Provider REST base URL (e.g. <c>https://api.paystack.co</c>).</summary>
    public string BaseUrl { get; init; } = string.Empty;

    /// <summary>Server-side secret key. Also the HMAC key for webhook signatures unless overridden.</summary>
    public string SecretKey { get; init; } = string.Empty;

    /// <summary>HMAC secret for webhook signature verification. Defaults to <see cref="SecretKey"/>.</summary>
    public string? WebhookSecret { get; init; }

    /// <summary>ISO 4217 codes this provider may charge, comma-separated (e.g. <c>USD,NGN</c>).</summary>
    public string SupportedCurrencies { get; init; } = "USD";

    /// <summary>A provider with a secret key configured is live; otherwise it is skipped.</summary>
    public bool IsConfigured => !string.IsNullOrWhiteSpace(SecretKey) && !string.IsNullOrWhiteSpace(BaseUrl);

    public string EffectiveWebhookSecret => string.IsNullOrWhiteSpace(WebhookSecret) ? SecretKey : WebhookSecret;

    public IReadOnlyCollection<string> Currencies => SupportedCurrencies
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(c => c.ToUpperInvariant())
        .ToArray();
}
