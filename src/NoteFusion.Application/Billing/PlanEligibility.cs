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
        // Unknown country shows every tier. Every account created before countries were resolved is in that
        // state, along with anyone whose lookup failed, and guessing a tier for them would mis-price real
        // people who are already paying us.
        if (country is null)
            return true;

        var isNigerian = string.Equals(country, NairaCountry, StringComparison.OrdinalIgnoreCase);
        var isNaira = string.Equals(currency, NairaCurrency, StringComparison.OrdinalIgnoreCase);

        // Symmetric on purpose, in both directions: a Nigerian account is not offered the dollar lifetime,
        // and an international one is not offered naira. Barring only the second half would leave the
        // cheaper-per-month tier open to whoever thought to ask for it by id.
        return isNigerian == isNaira;
    }
}
