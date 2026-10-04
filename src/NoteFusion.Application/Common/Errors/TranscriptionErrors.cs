using NoteFusion.Application.Transcriptions;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>Transcription/ML-related error codes (module: transcriptions).</summary>
public static class TranscriptionErrors
{
    public static readonly Error InvalidKey =
        Error.Validation("TRANS_INVALID_KEY",
            "Key must be a note (A–G) with an optional #/b and an optional major/minor, e.g. \"C\", \"Bb\", \"F# minor\", \"Am\".");

    public static readonly Error JobNotFound =
        Error.NotFound("TRANS_JOB_NOT_FOUND", "The transcription job was not found.");

    public static readonly Error JobNotDone =
        Error.Conflict("TRANS_JOB_NOT_DONE", "The transcription job has not completed yet.");

    public static readonly Error ServiceUnavailable =
        Error.Network("TRANS_SERVICE_UNAVAILABLE", "The transcription service is unavailable. Try again shortly.");

    public static readonly Error InvalidLink =
        Error.Validation("TRANS_INVALID_LINK",
            "Paste a link to a YouTube video, a Spotify track or an Apple Music song.");

    public static readonly Error SectionStartsBeforeTheSong =
        Error.Validation("TRANS_INVALID_SECTION", "The section must start at 0:00 or later.");

    public static readonly Error SectionEndsBeforeItStarts =
        Error.Validation("TRANS_INVALID_SECTION", "The section must end after it starts.");

    /// <summary>The chosen section is longer than this caller may have in one go; <paramref name="maxSeconds"/> is that allowance.</summary>
    public static Error SectionTooLong(double maxSeconds) =>
        Error.Validation("TRANS_SECTION_TOO_LONG", $"Pick up to {SongSections.Clock(maxSeconds)} of the song.");

    public static readonly Error InvalidKeyboardTranspose =
        Error.Validation("TRANS_INVALID_KEYBOARD_TRANSPOSE",
            "Keyboard transpose must be a whole number of semitones from -11 to 11.");

    public static readonly Error PreviewLimitReached =
        Error.Validation("PREVIEW_LIMIT_REACHED", "You've used today's free previews. Create a free account to keep transcribing.");

    public static readonly Error ProRequired =
        Error.Forbidden("BILLING_PRO_REQUIRED", "Sing-along grading is a Pro feature. Upgrade to have your takes marked note by note.");

    public static readonly Error HarmonyProRequired =
        Error.Forbidden("BILLING_PRO_REQUIRED", "Four-part harmony is a Pro feature. Upgrade to have alto, tenor and bass written under your tune.");

    public static readonly Error InvalidAudio =
        Error.Validation("TRANS_INVALID_AUDIO", "The uploaded audio could not be read. Use a WAV, MP3, or M4A file.");
}
