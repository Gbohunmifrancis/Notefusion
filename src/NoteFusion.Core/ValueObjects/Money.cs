namespace NoteFusion.Core.ValueObjects;

/// <summary>
/// Immutable value object representing a monetary amount with an associated ISO currency code.
/// Enforces precision rounding, currency compatibility on arithmetic, and conversions to/from minor units.
/// </summary>
public readonly record struct Money : IComparable<Money>
{
    private static readonly HashSet<string> SupportedCurrencies = new(StringComparer.OrdinalIgnoreCase)
    {
        "USD", "NGN", "GBP", "EUR"
    };

    public decimal Amount { get; }
    public string Currency { get; }

    private Money(decimal amount, string currency)
    {
        Amount = amount;
        Currency = currency;
    }

    /// <summary>
    /// Creates a validated <see cref="Money"/> instance. Amount is rounded to 2 decimal places.
    /// </summary>
    /// <param name="amount">Monetary amount (must be non-negative and within allowed limits).</param>
    /// <param name="currency">ISO 4217 currency code (USD, NGN, GBP, EUR).</param>
    /// <exception cref="ArgumentOutOfRangeException">When amount is negative or exceeds 100,000,000.</exception>
    /// <exception cref="ArgumentException">When currency is null, empty, or unsupported.</exception>
    public static Money Create(decimal amount, string currency = "USD")
    {
        if (string.IsNullOrWhiteSpace(currency))
            throw new ArgumentException("Currency is required.", nameof(currency));

        var normalized = currency.Trim().ToUpperInvariant();
        if (!SupportedCurrencies.Contains(normalized))
            throw new ArgumentException($"Currency '{currency}' is not supported. Supported: {string.Join(", ", SupportedCurrencies)}.", nameof(currency));

        var rounded = Math.Round(amount, 2, MidpointRounding.AwayFromZero);
        if (rounded < 0m)
            throw new ArgumentOutOfRangeException(nameof(amount), "Amount must not be negative.");

        if (rounded > 100_000_000m)
            throw new ArgumentOutOfRangeException(nameof(amount), "Amount exceeds maximum permitted limit (100,000,000).");

        return new Money(rounded, normalized);
    }

    /// <summary>
    /// Returns zero money for the given currency.
    /// </summary>
    public static Money Zero(string currency = "USD") => Create(0m, currency);

    /// <summary>
    /// Creates a <see cref="Money"/> instance from an integer minor unit amount (e.g. cents, kobo).
    /// </summary>
    /// <param name="amountMinor">Minor unit amount (e.g., 500 for $5.00).</param>
    /// <param name="currency">ISO currency code.</param>
    public static Money FromMinorUnit(long amountMinor, string currency = "USD")
    {
        if (amountMinor < 0)
            throw new ArgumentOutOfRangeException(nameof(amountMinor), "Minor unit amount must not be negative.");

        var major = amountMinor / 100m;
        return Create(major, currency);
    }

    /// <summary>
    /// Converts the amount to its integer minor unit (e.g. cents for USD, kobo for NGN).
    /// </summary>
    public long ToMinorUnit()
    {
        return (long)Math.Round(Amount * 100m, MidpointRounding.AwayFromZero);
    }

    /// <summary>
    /// Converts to kobo. Valid only when currency is NGN.
    /// </summary>
    public long ToKobo()
    {
        if (!string.Equals(Currency, "NGN", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"ToKobo() is only valid for NGN, but current currency is '{Currency}'.");

        return ToMinorUnit();
    }

    /// <summary>
    /// Converts to cents. Valid only for USD, GBP, or EUR.
    /// </summary>
    public long ToCents()
    {
        if (string.Equals(Currency, "NGN", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"ToCents() is not valid for NGN. Use ToKobo() or ToMinorUnit().");

        return ToMinorUnit();
    }

    /// <summary>
    /// Adds two money values of the same currency.
    /// </summary>
    public Money Add(Money other)
    {
        AssertSameCurrency(other);
        return Create(Amount + other.Amount, Currency);
    }

    /// <summary>
    /// Subtracts another money value of the same currency.
    /// </summary>
    public Money Subtract(Money other)
    {
        AssertSameCurrency(other);
        if (Amount < other.Amount)
            throw new InvalidOperationException($"Cannot subtract {other} from {this}: result would be negative.");

        return Create(Amount - other.Amount, Currency);
    }

    /// <summary>
    /// Multiplies the money amount by a factor.
    /// </summary>
    public Money MultiplyBy(decimal factor)
    {
        if (factor < 0m)
            throw new ArgumentOutOfRangeException(nameof(factor), "Multiplier factor must not be negative.");

        return Create(Amount * factor, Currency);
    }

    private void AssertSameCurrency(Money other)
    {
        if (!string.Equals(Currency, other.Currency, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Currency mismatch: cannot operate between '{Currency}' and '{other.Currency}'.");
    }

    public static Money operator +(Money left, Money right) => left.Add(right);
    public static Money operator -(Money left, Money right) => left.Subtract(right);
    public static Money operator *(Money left, decimal factor) => left.MultiplyBy(factor);
    public static Money operator *(decimal factor, Money right) => right.MultiplyBy(factor);

    public static bool operator >(Money left, Money right)
    {
        left.AssertSameCurrency(right);
        return left.Amount > right.Amount;
    }

    public static bool operator <(Money left, Money right)
    {
        left.AssertSameCurrency(right);
        return left.Amount < right.Amount;
    }

    public static bool operator >=(Money left, Money right) => left > right || left == right;
    public static bool operator <=(Money left, Money right) => left < right || left == right;

    public int CompareTo(Money other)
    {
        AssertSameCurrency(other);
        return Amount.CompareTo(other.Amount);
    }

    public override string ToString()
    {
        return Currency switch
        {
            "NGN" => $"₦{Amount:N2}",
            "USD" => $"${Amount:N2}",
            "GBP" => $"£{Amount:N2}",
            "EUR" => $"€{Amount:N2}",
            _ => $"{Currency} {Amount:N2}"
        };
    }
}
