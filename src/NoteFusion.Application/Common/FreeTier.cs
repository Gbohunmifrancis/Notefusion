namespace NoteFusion.Application.Common;

/// <summary>
/// What an account gets without paying. One constant, because the gate that enforces it and the
/// number the app shows the user must never disagree — a paywall that fires at a different count
/// than the screen promised reads as a bug in the billing, which is the worst place to look buggy.
/// </summary>
public static class FreeTier
{
    /// <summary>
    /// Successful transcriptions a free account may generate, ever. Charged when the job is observed
    /// to have finished, so a failed transcription costs nothing and a deleted one is not refunded.
    /// </summary>
    public const int TrialGenerations = 5;
}
