namespace NoteFusion.Application.Common;

/// <summary>
/// What an account gets without paying. Resolved through one method, because the gate that enforces it
/// and the number the app shows the user must never disagree — a paywall that fires at a different count
/// than the screen promised reads as a bug in the billing, which is the worst place to look buggy.
/// </summary>
public static class FreeTier
{
    /// <summary>
    /// A Nigerian account's allowance. Smaller than the rest of the world's in the same proportion its
    /// naira Pro pricing is a fraction of the dollar tier — a market priced to local purchasing power gets
    /// a trial sized to match, or the trial itself becomes the cheaper product.
    /// </summary>
    public const int NigeriaTrialGenerations = 5;

    /// <summary>
    /// The allowance everywhere else, and wherever the country is not yet known. The larger of the two,
    /// because an unresolved country is "not known to be Nigeria" — and erring toward the fuller trial
    /// matches the fail-open stance the rest of billing takes on a missing country (a null country is
    /// offered every tier; a header-less install keeps its own full count).
    /// </summary>
    public const int DefaultTrialGenerations = 10;

    /// <summary>
    /// Successful transcriptions a free account in <paramref name="country"/> may generate, ever. Charged
    /// when the job is observed to have finished, so a failed transcription costs nothing and a deleted one
    /// is not refunded. Keyed on the same <c>"NG"</c> country code the paywall's currency rule uses, so the
    /// two halves of the geo split cannot drift apart.
    /// </summary>
    public static int TrialGenerationsFor(string? country) =>
        string.Equals(country, "NG", StringComparison.OrdinalIgnoreCase)
            ? NigeriaTrialGenerations
            : DefaultTrialGenerations;
}
