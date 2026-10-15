namespace NoteFusion.Application.Billing;

/// <summary>
/// Which pricing tier a user may buy, given where their account was first seen. Three tiers: Nigerian
/// accounts buy in naira; accounts in the lower-income markets listed in <see cref="RegionalCountries"/> buy
/// the regional dollar set; everyone else buys the standard dollar set. One rule in one place because it has
/// two callers that must never disagree — the paywall list and the checkout handler — and a plan hidden from
/// the list but purchasable by id is not enforcement, it is decoration.
/// </summary>
/// <remarks>
/// Currency is what routes a charge to a provider: naira reaches Paystack, dollars reach Bachs (see
/// <c>PaymentGatewayFactory.SelectForCurrency</c>), so both dollar sets go to Bachs. What tells the two dollar
/// sets apart is the plan code: a regional plan's code carries <see cref="RegionalCodeMarker"/>
/// (<c>BillingSeeder</c> names them so), and a price change ships as a new code that keeps the marker.
/// </remarks>
public static class PlanEligibility
{
    private const string NairaCountry = "NG";
    private const string NairaCurrency = "NGN";

    /// <summary>The part of a plan code that marks it as one of the regional dollar plans.</summary>
    public const string RegionalCodeMarker = "_regional";

    /// <summary>
    /// The lower-income markets outside Nigeria that are offered the regional dollar prices: every African
    /// country except Nigeria (which has its own naira tier), and South and Southeast Asia. ISO 3166-1
    /// alpha-2. The one list; nothing else may name these countries.
    /// </summary>
    public static readonly IReadOnlySet<string> RegionalCountries = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        // Africa, the 53 sovereign states other than Nigeria, and Western Sahara.
        "DZ", "AO", "BJ", "BW", "BF", "BI", "CV", "CM", "CF", "TD", "KM", "CG", "CD", "CI", "DJ", "EG", "GQ", "ER",
        "SZ", "ET", "GA", "GM", "GH", "GN", "GW", "KE", "LS", "LR", "LY", "MG", "MW", "ML", "MR", "MU", "MA", "MZ",
        "NA", "NE", "RW", "ST", "SN", "SC", "SL", "SO", "ZA", "SS", "SD", "TZ", "TG", "TN", "UG", "ZM", "ZW", "EH",

        // South and Southeast Asia.
        "IN", "PK", "BD", "LK", "NP", "ID", "PH", "VN", "MM", "KH", "LA",
    };

    /// <summary>The price tiers. Each account is offered one of them, or both non-regional ones when its country is unknown.</summary>
    public enum Tier
    {
        Naira,
        StandardDollar,
        RegionalDollar
    }

    /// <summary>The tier a plan belongs to, from its currency and code.</summary>
    public static Tier TierOf(string code, string currency)
    {
        if (string.Equals(currency, NairaCurrency, StringComparison.OrdinalIgnoreCase))
            return Tier.Naira;

        return code.Contains(RegionalCodeMarker, StringComparison.OrdinalIgnoreCase)
            ? Tier.RegionalDollar
            : Tier.StandardDollar;
    }

    /// <summary>
    /// True when a plan (its <paramref name="code"/> and <paramref name="currency"/>) may be sold to an account
    /// whose country is <paramref name="country"/> (ISO 3166-1 alpha-2, or null when unknown).
    /// </summary>
    public static bool IsOffered(string code, string currency, string? country)
    {
        var tier = TierOf(code, currency);

        // Unknown country keeps what it always saw: naira and the standard dollar set. Every account created
        // before countries were resolved is in that state, along with anyone whose lookup failed, and guessing
        // a tier for them would mis-price real people who are already paying us. Not the regional set: an
        // unknown country is no evidence of a lower-income market, and offering it there would make a failed
        // lookup the cheapest way to buy.
        if (string.IsNullOrWhiteSpace(country))
            return tier is Tier.Naira or Tier.StandardDollar;

        // Exactly one tier per known country, in every direction: a Nigerian account is not offered dollars,
        // an international one is not offered naira, and neither dollar set is open to the other's countries.
        // Barring only one direction would leave the cheaper tier open to whoever thought to ask for it by id.
        return tier == TierFor(country);
    }

    /// <summary>The one tier an account in a known <paramref name="country"/> buys from.</summary>
    public static Tier TierFor(string country)
    {
        if (string.Equals(country, NairaCountry, StringComparison.OrdinalIgnoreCase))
            return Tier.Naira;

        return RegionalCountries.Contains(country.Trim()) ? Tier.RegionalDollar : Tier.StandardDollar;
    }
}
