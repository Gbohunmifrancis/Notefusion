namespace NoteFusion.Infrastructure.Billing;

/// <summary>
/// Credentials, endpoint and plan→product mapping for Bachs, bound from the <c>Bachs</c> config section
/// (env-driven: <c>Bachs__SecretKey</c>, <c>Bachs__WebhookSecret</c>, <c>Bachs__ProductMap__pro_monthly</c>, …).
/// Deliberately a separate type from <see cref="PaymentProviderOptions"/> rather than a reuse of it, for
/// two reasons that both protect money:
/// <list type="bullet">
/// <item><description>
/// Bachs signs webhooks with a per-endpoint <c>whsec_</c> signing secret that is NOT the API key, so
/// <see cref="PaymentProviderOptions.EffectiveWebhookSecret"/>'s fallback to the secret key would make
/// every signature fail — silently, and identically to a forged request.
/// </description></item>
/// <item><description>
/// Bachs cannot charge an ad-hoc recurring amount: a subscription only arises from a catalog product
/// whose <c>billing_cycle</c> is set, so a plan code has to resolve to a <c>prod_…</c> id.
/// <see cref="ProductMap"/> is that lookup, and it has nowhere to live on the shared options type.
/// </description></item>
/// </list>
/// Both also keep the DI container unambiguous: registering two singletons of one options type would
/// hand Paystack's adapter Bachs' credentials depending on registration order.
/// </summary>
public sealed class BachsOptions
{
    /// <summary>REST base URL — <c>https://sandbox-api.bachs.io</c> or <c>https://api.bachs.io</c>.</summary>
    public string BaseUrl { get; init; } = string.Empty;

    /// <summary>Server-side API key (<c>sk_sandbox_…</c> / <c>sk_live_…</c>), sent as a bearer token.</summary>
    public string SecretKey { get; init; } = string.Empty;

    /// <summary>
    /// The webhook endpoint's own signing secret (<c>whsec_…</c>), used verbatim as the HMAC key. Sandbox
    /// and live endpoints have different secrets. No default and no fallback: without it we cannot tell a
    /// genuine delivery from a forged one, and guessing is worse than refusing.
    /// </summary>
    public string WebhookSecret { get; init; } = string.Empty;

    /// <summary>ISO 4217 codes this provider may charge, comma-separated (e.g. <c>USD,NGN</c>).</summary>
    public string SupportedCurrencies { get; init; } = "USD";

    /// <summary>
    /// Our plan code → Bachs catalog product id (<c>pro_monthly</c> → <c>prod_…</c>). Monthly and annual
    /// are necessarily two different products: a product's <c>billing_cycle</c> is immutable, so the
    /// interval is a property of the product, not of the checkout we open against it.
    /// </summary>
    public Dictionary<string, string> ProductMap { get; init; } = [];

    /// <summary>
    /// How far a webhook's signed timestamp may be from our clock, in seconds. Bounds replay of a
    /// captured (validly signed) delivery; 300s matches Bachs' documented default and leaves room for
    /// ordinary clock skew.
    /// </summary>
    public int WebhookToleranceSeconds { get; init; } = 300;

    /// <summary>
    /// How long a hosted checkout stays open, in minutes (Bachs allows 1–1440). Short enough that an
    /// abandoned session expires — and so becomes reconcilable — rather than sitting open for a day.
    /// </summary>
    public int CheckoutExpiryMinutes { get; init; } = 60;

    /// <summary>
    /// Live only when a key, a base URL and a webhook secret are all present. The signing secret is part
    /// of the gate on purpose: a deployment missing it could take payments it can never verify, and
    /// half-configured is worse than off.
    /// </summary>
    /// <remarks>
    /// <see cref="ProductMap"/> is deliberately NOT required. It is needed only to open a RECURRING
    /// checkout, and a deployment that sells only one-off purchases through Bachs legitimately has none —
    /// gating on it here would silently switch the provider off and strand every currency routed to it.
    /// The map is enforced instead at the point it actually matters, per request, where a recurring plan
    /// with no product fails loudly and a one-off proceeds.
    /// </remarks>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(SecretKey)
        && !string.IsNullOrWhiteSpace(BaseUrl)
        && !string.IsNullOrWhiteSpace(WebhookSecret);

    /// <summary>
    /// A sandbox key against the live host or a live key against the sandbox host, said in one line for the
    /// startup readiness log (the key itself is never printed); null when they agree or the key's prefix is
    /// unknown. Going live is a key swap and a host swap, and a deployment that made one without the other
    /// refuses every checkout with nothing more than "could not open the payment page".
    /// </summary>
    public string? EnvironmentMismatch
    {
        get
        {
            var sandboxKey = SecretKey.StartsWith("sk_sandbox_", StringComparison.OrdinalIgnoreCase);
            var liveKey = SecretKey.StartsWith("sk_live_", StringComparison.OrdinalIgnoreCase);
            if (!sandboxKey && !liveKey)
                return null;

            var sandboxHost = Uri.TryCreate(BaseUrl, UriKind.Absolute, out var uri)
                && uri.Host.Contains("sandbox", StringComparison.OrdinalIgnoreCase);
            if (sandboxKey == sandboxHost)
                return null;

            return sandboxKey
                ? $"Bachs__SecretKey is a sandbox key (sk_sandbox_…) but Bachs__BaseUrl is the live host {BaseUrl}; every checkout will be refused."
                : $"Bachs__SecretKey is a live key (sk_live_…) but Bachs__BaseUrl is the sandbox host {BaseUrl}; every checkout will be refused.";
        }
    }

    public IReadOnlyCollection<string> Currencies => SupportedCurrencies
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(c => c.ToUpperInvariant())
        .ToArray();

    /// <summary>
    /// Resolves a plan code to its Bachs product id, or <c>null</c> when unmapped. Matched
    /// case-insensitively because the key's casing comes from whatever the config file or env var used,
    /// not from our plan constants. The map is a handful of entries, so a scan is cheaper than keeping a
    /// second normalised copy in sync with the binder.
    /// </summary>
    public string? ProductIdFor(string planCode)
    {
        if (Lookup(planCode) is { } exact)
            return exact;

        // Plan codes carry their currency (pro_monthly_usd) since the geo split; a map keyed on the
        // older bare code (pro_monthly) still names the same Bachs product, so it is honoured rather
        // than making every deployment rename a secret on the day the catalogue changed.
        var suffix = planCode.LastIndexOf('_');
        if (suffix > 0 && planCode.Length - suffix == 4)
            return Lookup(planCode[..suffix]);

        return null;
    }

    private string? Lookup(string planCode)
    {
        foreach (var (key, productId) in ProductMap)
        {
            if (string.Equals(key, planCode, StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrWhiteSpace(productId))
            {
                return productId.Trim();
            }
        }

        return null;
    }
}
