namespace NoteFusion.Core.Enums;

/// <summary>
/// The customer-research groups the founder writes to (<c>SendOutreachCommand</c>). Declared in priority
/// order: when an account fits several, the lowest value is the one it hears about. Stored by name.
/// </summary>
public enum OutreachSegment
{
    /// <summary>Opened a Pro checkout, never paid, not Pro: "what stopped you?"</summary>
    CheckoutAbandoned = 0,

    /// <summary>Free, a week old and coming back: asked for a ten-minute chat.</summary>
    ActiveUser = 1,

    /// <summary>One finished transcription and gone quiet: "did the sheet come out right?"</summary>
    TriedOnce = 2,

    /// <summary>Signed up, never transcribed: "was something in the way?"</summary>
    NeverTranscribed = 3
}
