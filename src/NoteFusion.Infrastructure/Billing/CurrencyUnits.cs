using System.Globalization;

namespace NoteFusion.Infrastructure.Billing;

/// <summary>
/// Converts between NoteFusion's integral minor units and the decimal-string MAJOR-unit amounts some
/// providers use on the wire (Bachs sends <c>"29.00"</c>, not <c>2900</c>). The domain never sees a
/// decimal — this is a wire boundary that lives entirely inside the adapter, so <see cref="long"/>
/// minor units stay the single money representation everywhere else.
/// </summary>
/// <remarks>
/// The exponent table exists because a missing entry is a 100× money bug, not a rounding nuisance:
/// treating ¥1000 as 10.00 would undercharge by a factor of 100, and treating it as 100000 would
/// overcharge by the same. Unlisted currencies default to 2, which is the ISO 4217 exponent for the
/// large majority; every currency whose exponent is NOT 2 is listed explicitly below.
/// </remarks>
internal static class CurrencyUnits
{
    private const int DefaultExponent = 2;

    /// <summary>10^n for n in 0..4, the full range of ISO 4217 exponents.</summary>
    private static readonly decimal[] Powers = [1m, 10m, 100m, 1_000m, 10_000m];

    /// <summary>ISO 4217 currencies whose minor-unit exponent is not 2. Everything else uses 2.</summary>
    private static readonly Dictionary<string, int> Exponents = new(StringComparer.OrdinalIgnoreCase)
    {
        // No minor unit at all — the "amount" is already whole currency.
        ["BIF"] = 0, ["CLP"] = 0, ["DJF"] = 0, ["GNF"] = 0, ["ISK"] = 0, ["JPY"] = 0,
        ["KMF"] = 0, ["KRW"] = 0, ["PYG"] = 0, ["RWF"] = 0, ["UGX"] = 0, ["UYI"] = 0,
        ["VND"] = 0, ["VUV"] = 0, ["XAF"] = 0, ["XOF"] = 0, ["XPF"] = 0,

        // Three-decimal currencies (Gulf dinars and the Tunisian/Libyan dinar).
        ["BHD"] = 3, ["IQD"] = 3, ["JOD"] = 3, ["KWD"] = 3, ["LYD"] = 3, ["OMR"] = 3, ["TND"] = 3,

        // Four-decimal units of account.
        ["CLF"] = 4, ["UYW"] = 4,
    };

    /// <summary>
    /// Formats minor units as the provider's major-unit decimal string, always with exactly the
    /// currency's number of decimal places (<c>499 USD → "4.99"</c>, <c>1000 JPY → "1000"</c>).
    /// Invariant culture, so a server with a comma decimal separator cannot corrupt an amount.
    /// </summary>
    public static string ToMajorString(long amountMinor, string currency)
    {
        var exponent = ExponentFor(currency);
        var major = amountMinor / Powers[exponent];
        return major.ToString("F" + exponent.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Parses a provider's major-unit decimal string back to minor units, or <c>null</c> when the value
    /// cannot be read exactly.
    /// </summary>
    /// <remarks>
    /// Null means "I could not read the provider's answer", which callers must treat as a transient
    /// failure to retry — never as a zero and never as a mismatch. Anything carrying more precision than
    /// the currency has (<c>"4.999"</c> for USD) is refused rather than rounded: silently rounding a
    /// provider amount is how a verified payment ends up fulfilled for the wrong figure.
    /// </remarks>
    public static long? TryToMinor(string? amount, string currency)
    {
        if (string.IsNullOrWhiteSpace(amount))
            return null;

        // Deliberately narrow: no exponent notation, no thousands separators, no currency symbols.
        // A provider sending any of those is anomalous, and "unreadable" is the safe verdict.
        const NumberStyles styles = NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint;
        if (!decimal.TryParse(amount.Trim(), styles, CultureInfo.InvariantCulture, out var major))
            return null;

        var minor = major * Powers[ExponentFor(currency)];
        if (minor != decimal.Truncate(minor))
            return null;

        return minor >= long.MinValue && minor <= long.MaxValue ? (long)minor : null;
    }

    /// <summary>
    /// A major-unit amount rounded to the currency's minor units, for a figure that is reported rather than verified
    /// (what a store says an order cost, tax included, which may carry more precision than the currency).
    /// </summary>
    public static long RoundToMinor(decimal major, string currency)
        => (long)decimal.Round(major * Powers[ExponentFor(currency)], 0, MidpointRounding.AwayFromZero);

    private static int ExponentFor(string currency)
        => Exponents.TryGetValue(currency.Trim(), out var exponent) ? exponent : DefaultExponent;
}
