using System.Text.RegularExpressions;

namespace NoteFusion.Core.ValueObjects;

/// <summary>
/// Immutable value object representing a unique, validated payment reference string.
/// </summary>
public readonly partial record struct PaymentReference
{
    private static readonly Regex ValidPattern = ReferenceRegex();

    public string Value { get; }

    private PaymentReference(string value)
    {
        Value = value;
    }

    /// <summary>
    /// Generates a new unique payment reference with the given prefix (default "NF").
    /// </summary>
    public static PaymentReference Generate(string prefix = "NF")
    {
        if (string.IsNullOrWhiteSpace(prefix))
            prefix = "NF";

        var sanitizedPrefix = prefix.Trim().ToUpperInvariant();
        var unique = Guid.NewGuid().ToString("N");
        return new PaymentReference($"{sanitizedPrefix}_{unique}");
    }

    /// <summary>
    /// Validates and encapsulates an existing payment reference string.
    /// </summary>
    public static PaymentReference Create(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new ArgumentException("Payment reference cannot be empty.", nameof(value));

        var trimmed = value.Trim();
        if (trimmed.Length is < 5 or > 128)
            throw new ArgumentException("Payment reference must be between 5 and 128 characters.", nameof(value));

        if (!ValidPattern.IsMatch(trimmed))
            throw new ArgumentException($"Payment reference '{trimmed}' contains invalid characters.", nameof(value));

        return new PaymentReference(trimmed);
    }

    public override string ToString() => Value;

    public static implicit operator string(PaymentReference reference) => reference.Value;

    [GeneratedRegex(@"^[a-zA-Z0-9_\-]+$")]
    private static partial Regex ReferenceRegex();
}
