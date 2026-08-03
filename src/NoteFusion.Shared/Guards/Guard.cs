using System.Runtime.CompilerServices;

namespace NoteFusion.Shared.Guards;

/// <summary>
/// Argument guards for constructors and domain methods. Throw for programmer errors;
/// use <see cref="Results.Result"/> for expected, recoverable failures.
/// </summary>
public static class Guard
{
    public static T NotNull<T>(T? value, [CallerArgumentExpression(nameof(value))] string? name = null)
        where T : class
        => value ?? throw new ArgumentNullException(name);

    public static string NotNullOrWhiteSpace(string? value, [CallerArgumentExpression(nameof(value))] string? name = null)
        => string.IsNullOrWhiteSpace(value)
            ? throw new ArgumentException("Value cannot be null or whitespace.", name)
            : value;

    public static Guid AgainstEmpty(Guid value, [CallerArgumentExpression(nameof(value))] string? name = null)
        => value == Guid.Empty
            ? throw new ArgumentException("Value cannot be an empty GUID.", name)
            : value;

    public static int InRange(int value, int min, int max, [CallerArgumentExpression(nameof(value))] string? name = null)
        => value < min || value > max
            ? throw new ArgumentOutOfRangeException(name, value, $"Value must be between {min} and {max}.")
            : value;

    public static double InRange(double value, double min, double max, [CallerArgumentExpression(nameof(value))] string? name = null)
        => value < min || value > max
            ? throw new ArgumentOutOfRangeException(name, value, $"Value must be between {min} and {max}.")
            : value;
}
