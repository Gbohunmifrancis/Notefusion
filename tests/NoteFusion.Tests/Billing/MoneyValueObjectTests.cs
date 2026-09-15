using NoteFusion.Core.ValueObjects;

namespace NoteFusion.Tests.Billing;

public class MoneyValueObjectTests
{
    [Fact]
    public void Create_with_valid_amount_and_currency_succeeds()
    {
        var money = Money.Create(19.99m, "USD");

        Assert.Equal(19.99m, money.Amount);
        Assert.Equal("USD", money.Currency);
    }

    [Fact]
    public void Create_rounds_to_two_decimal_places()
    {
        var money = Money.Create(10.555m, "USD");

        Assert.Equal(10.56m, money.Amount);
    }

    [Theory]
    [InlineData("usd", "USD")]
    [InlineData("ngn", "NGN")]
    [InlineData("gbp", "GBP")]
    [InlineData("eur", "EUR")]
    public void Create_normalizes_currency_to_uppercase(string input, string expected)
    {
        var money = Money.Create(50m, input);

        Assert.Equal(expected, money.Currency);
    }

    [Fact]
    public void Create_throws_when_currency_is_unsupported()
    {
        var ex = Assert.Throws<ArgumentException>(() => Money.Create(100m, "XYZ"));
        Assert.Contains("not supported", ex.Message);
    }

    [Fact]
    public void Create_throws_when_amount_is_negative()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Money.Create(-5m, "USD"));
    }

    [Fact]
    public void Create_throws_when_amount_exceeds_maximum_limit()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Money.Create(100_000_001m, "USD"));
    }

    [Fact]
    public void Zero_returns_zero_amount()
    {
        var zero = Money.Zero("NGN");

        Assert.Equal(0m, zero.Amount);
        Assert.Equal("NGN", zero.Currency);
    }

    [Fact]
    public void FromMinorUnit_converts_correctly()
    {
        var moneyUsd = Money.FromMinorUnit(499, "USD");
        Assert.Equal(4.99m, moneyUsd.Amount);
        Assert.Equal("USD", moneyUsd.Currency);

        var moneyNgn = Money.FromMinorUnit(500000, "NGN");
        Assert.Equal(5000.00m, moneyNgn.Amount);
        Assert.Equal("NGN", moneyNgn.Currency);
    }

    [Fact]
    public void ToMinorUnit_converts_correctly()
    {
        var money = Money.Create(12.34m, "USD");
        Assert.Equal(1234, money.ToMinorUnit());
        Assert.Equal(1234, money.ToCents());

        var ngn = Money.Create(1500.50m, "NGN");
        Assert.Equal(150050, ngn.ToMinorUnit());
        Assert.Equal(150050, ngn.ToKobo());
    }

    [Fact]
    public void ToKobo_throws_for_non_ngn_currency()
    {
        var money = Money.Create(10m, "USD");
        Assert.Throws<InvalidOperationException>(() => money.ToKobo());
    }

    [Fact]
    public void ToCents_throws_for_ngn_currency()
    {
        var money = Money.Create(1000m, "NGN");
        Assert.Throws<InvalidOperationException>(() => money.ToCents());
    }

    [Fact]
    public void Add_same_currency_succeeds()
    {
        var a = Money.Create(10.50m, "USD");
        var b = Money.Create(5.25m, "USD");

        var sum = a + b;

        Assert.Equal(15.75m, sum.Amount);
        Assert.Equal("USD", sum.Currency);
    }

    [Fact]
    public void Add_different_currency_throws()
    {
        var a = Money.Create(10m, "USD");
        var b = Money.Create(10m, "NGN");

        Assert.Throws<InvalidOperationException>(() => a + b);
    }

    [Fact]
    public void Subtract_same_currency_succeeds()
    {
        var a = Money.Create(20m, "EUR");
        var b = Money.Create(5m, "EUR");

        var diff = a - b;

        Assert.Equal(15m, diff.Amount);
        Assert.Equal("EUR", diff.Currency);
    }

    [Fact]
    public void Subtract_resulting_in_negative_throws()
    {
        var a = Money.Create(5m, "USD");
        var b = Money.Create(10m, "USD");

        Assert.Throws<InvalidOperationException>(() => a - b);
    }

    [Fact]
    public void MultiplyBy_scales_amount()
    {
        var a = Money.Create(10m, "GBP");
        var scaled = a * 2.5m;

        Assert.Equal(25m, scaled.Amount);
        Assert.Equal("GBP", scaled.Currency);
    }

    [Fact]
    public void Comparisons_work_for_same_currency()
    {
        var low = Money.Create(10m, "USD");
        var high = Money.Create(20m, "USD");
        var equal = Money.Create(10m, "USD");

        Assert.True(low < high);
        Assert.True(high > low);
        Assert.True(low <= equal);
        Assert.True(low >= equal);
        Assert.Equal(low, equal);
    }

    [Fact]
    public void ToString_formats_with_currency_symbols()
    {
        Assert.Equal("₦1,500.00", Money.Create(1500m, "NGN").ToString());
        Assert.Equal("$25.00", Money.Create(25m, "USD").ToString());
        Assert.Equal("£10.00", Money.Create(10m, "GBP").ToString());
        Assert.Equal("€12.50", Money.Create(12.50m, "EUR").ToString());
    }
}
