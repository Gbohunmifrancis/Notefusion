namespace NoteFusion.Application.Common;

/// <summary>
/// The free tier's allowance: how many successful transcriptions an account without Pro may generate.
/// </summary>
public static class FreeTier
{
    /// <summary>
    /// Successful transcriptions a free account may generate, ever, everywhere: enough to hear the
    /// solfa come back on a couple of tunes, then the paywall. One number worldwide, so the trial
    /// pill, the refusal and the plans page all say the same thing.
    /// </summary>
    public const int TrialGenerations = 3;

    /// <summary>
    /// The allowance for an account in <paramref name="country"/>. The same everywhere now; kept as a
    /// method because the gate, the trial pill and the admin console all ask it, and a regional split
    /// would come back here rather than into each of them. Charged when the job is observed to have
    /// finished, so a failed transcription costs nothing and a deleted one is not refunded.
    /// </summary>
    public static int TrialGenerationsFor(string? country) => TrialGenerations;
}
