namespace NoteFusion.Application.Billing;

/// <summary>
/// Which pricing tier a user may buy, given where their account was first seen. Nigerian accounts
/// subscribe to Pro in naira; everyone else subscribes in dollars. One rule in one place because it has
/// two callers that must never disagree — the paywall list and the checkout handler — and a plan hidden from
/// the list but purchasable by id is not enforcement, it is decoration.
/// </summary>
/// <remarks>
/// Currency is the key rather than the interval, because currency is what routes a charge to a provider:
/// naira reaches Paystack, dollars reach Bachs (see <c>PaymentGatewayFactory.SelectForCurrency</c>).
/// </remarks>
public static class PlanEligibility
{
    private const string NairaCountry = "NG";
    private const string NairaCurrency = "NGN";

    /// <summary>
    /// True when a plan priced in <paramref name="currency"/> may be sold to an account whose country is
    /// <paramref name="country"/> (ISO 3166-1 alpha-2, or null when unknown).
    /// </summary>
    public static bool IsOffered(string currency, string? country)
    {
        var isNaira = string.Equals(currency, NairaCurrency, StringComparison.OrdinalIgnoreCase);

        // Unknown country is offered the international (dollar) tier only. Offering every tier let anyone
        // whose lookup failed — or who arranged for it to fail — buy the cheaper naira plan, so "unknown"
        // has to land on one side, and the regional discount is the side that needs proving.
        if (string.IsNullOrWhiteSpace(country))
            return !isNaira;

        var isNigerian = string.Equals(country, NairaCountry, StringComparison.OrdinalIgnoreCase);

        // Symmetric on purpose, in both directions: a Nigerian account is not offered the dollar lifetime,
        // and an international one is not offered naira. Barring only the second half would leave the
        // cheaper-per-month tier open to whoever thought to ask for it by id.
        return isNigerian == isNaira;
    }
}
