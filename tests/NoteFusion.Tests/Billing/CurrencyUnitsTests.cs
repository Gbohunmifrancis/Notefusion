using NoteFusion.Infrastructure.Billing;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The wire boundary where money changes representation, pinned in both directions. NoteFusion stores
/// integral minor units; Bachs sends decimal strings in MAJOR units. A wrong exponent here does not
/// throw — it charges the wrong number, so these tests exist to make the factor-of-100 class of bug
/// impossible to introduce silently. The refusal cases matter as much as the happy path: an amount the
/// adapter cannot read exactly must come back null so the caller retries, never rounded into a figure
/// we would then fulfil.
/// </summary>
public class CurrencyUnitsTests
{
    [Theory]
    // Two-decimal currencies: the product's own prices, plus the seeded yearly plan.
    [InlineData(499, "USD", "4.99")]
    [InlineData(4990, "USD", "49.90")]
    [InlineData(2900, "USD", "29.00")]
    [InlineData(7500000, "NGN", "75000.00")]
    [InlineData(5, "USD", "0.05")]
    [InlineData(100, "EUR", "1.00")]
    // Zero-decimal: the amount IS whole currency. Formatting 1000 JPY as "10.00" would undercharge 100×.
    [InlineData(1000, "JPY", "1000")]
    [InlineData(1500, "KRW", "1500")]
    // Three-decimal.
    [InlineData(29000, "KWD", "29.000")]
    [InlineData(1, "BHD", "0.001")]
    // Unlisted codes fall back to the ISO default of 2.
    [InlineData(1234, "GBP", "12.34")]
    public void Minor_units_format_with_exactly_the_currencys_decimal_places(long minor, string currency, string expected)
        => Assert.Equal(expected, CurrencyUnits.ToMajorString(minor, currency));

    [Theory]
    [InlineData("4.99", "USD", 499L)]
    [InlineData("49.90", "USD", 4990L)]
    [InlineData("75000.00", "NGN", 7500000L)]
    [InlineData("1000", "JPY", 1000L)]
    [InlineData("29.000", "KWD", 29000L)]
    // A provider may omit trailing zeros or the decimal point entirely; both are the same money.
    [InlineData("4.9", "USD", 490L)]
    [InlineData("29", "USD", 2900L)]
    [InlineData("0.05", "USD", 5L)]
    public void Major_unit_strings_parse_back_to_minor_units(string amount, string currency, long expected)
        => Assert.Equal(expected, CurrencyUnits.TryToMinor(amount, currency));

    [Theory]
    [InlineData(499L, "USD")]
    [InlineData(4990L, "USD")]
    [InlineData(1000L, "JPY")]
    [InlineData(29000L, "KWD")]
    [InlineData(7500000L, "NGN")]
    [InlineData(1L, "BHD")]
    public void Round_tripping_an_amount_returns_the_same_minor_units(long minor, string currency)
        => Assert.Equal(minor, CurrencyUnits.TryToMinor(CurrencyUnits.ToMajorString(minor, currency), currency));

    [Theory]
    // More precision than the currency has. Rounding this to 4.99 or 5.00 would fulfil a payment for an
    // amount the provider never named, so it is refused outright.
    [InlineData("4.999", "USD")]
    [InlineData("1000.5", "JPY")]
    [InlineData("29.0001", "KWD")]
    // Not a number we are willing to read: exponent notation, thousands separators, symbols, empty.
    [InlineData("4.99e2", "USD")]
    [InlineData("1,234.00", "USD")]
    [InlineData("$4.99", "USD")]
    [InlineData("", "USD")]
    [InlineData("   ", "USD")]
    [InlineData("not-a-number", "USD")]
    [InlineData(null, "USD")]
    public void An_amount_that_cannot_be_read_exactly_returns_null_rather_than_a_guess(string? amount, string currency)
        => Assert.Null(CurrencyUnits.TryToMinor(amount, currency));

    [Fact]
    public void Currency_codes_are_matched_case_insensitively_and_tolerate_padding()
    {
        // Providers are not guaranteed to echo the casing we sent. A lookup miss would silently fall back
        // to exponent 2 and turn ¥1000 into ¥10 — so the miss must not be reachable by casing alone.
        Assert.Equal("1000", CurrencyUnits.ToMajorString(1000, "jpy"));
        Assert.Equal("1000", CurrencyUnits.ToMajorString(1000, " JPY "));
        Assert.Equal(1000L, CurrencyUnits.TryToMinor("1000", "jpy"));
    }

    [Fact]
    public void Formatting_uses_the_invariant_culture_regardless_of_the_hosts_locale()
    {
        // A host with a comma decimal separator would otherwise emit "4,99", which Bachs would reject or,
        // worse, read as a different number.
        var original = Thread.CurrentThread.CurrentCulture;
        try
        {
            Thread.CurrentThread.CurrentCulture = new System.Globalization.CultureInfo("de-DE");
            Assert.Equal("4.99", CurrencyUnits.ToMajorString(499, "USD"));
            Assert.Equal(499L, CurrencyUnits.TryToMinor("4.99", "USD"));
        }
        finally
        {
            Thread.CurrentThread.CurrentCulture = original;
        }
    }
}
