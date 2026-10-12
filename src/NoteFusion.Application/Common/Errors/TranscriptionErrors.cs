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

    /// <summary>The worker looked at the link and found no video behind it.</summary>
    public static readonly Error LinkNotFound =
        Error.Validation("TRANS_LINK_NOT_FOUND", "That video doesn't exist. Check the link and try again.");

    public static readonly Error LinkUnavailable =
        Error.Validation("TRANS_LINK_UNAVAILABLE", "That video is private or unavailable, so it can't be fetched.");

    public static readonly Error LinkLive =
        Error.Validation("TRANS_LINK_LIVE", "That's a live stream or a premiere. Paste a link to the recorded song instead.");

    public static readonly Error LinkRefused =
        Error.Validation("TRANS_LINK_REFUSED", "YouTube is refusing automated downloads right now. Upload the audio file instead.");

    /// <summary>The video outruns the worker's cap on a linked video; <paramref name="limitSeconds"/> is that cap when it was named.</summary>
    public static Error LinkTooLong(double? limitSeconds) =>
        Error.Validation("TRANS_LINK_TOO_LONG", limitSeconds is { } cap
            ? $"Links are limited to videos up to {SongSections.Length(cap)} long. Upload the song's audio file instead."
            : "That video is too long to fetch from a link. Upload the song's audio file instead.");

    /// <summary>
    /// This API's own words for a reason the worker named by code when it turned a link away; null for a
    /// code it has no words for, which the caller answers as an invalid link. The worker's sentence itself
    /// is never shown.
    /// </summary>
    public static Error? ForLink(string? code, double? limitSeconds = null) => code switch
    {
        "not_found" => LinkNotFound,
        "unavailable" => LinkUnavailable,
        "live" => LinkLive,
        "refused" => LinkRefused,
        "too_long" => LinkTooLong(limitSeconds),
        _ => null,
    };

    public static readonly Error SectionStartsBeforeTheSong =
        Error.Validation("TRANS_INVALID_SECTION", "The section must start at 0:00 or later.");

    public static readonly Error SectionEndsBeforeItStarts =
        Error.Validation("TRANS_INVALID_SECTION", "The section must end after it starts.");

    /// <summary>The section starts at or past the song's end (or at no finite time at all).</summary>
    public static readonly Error SectionOutsideTheSong =
        Error.Validation("TRANS_INVALID_SECTION", "Pick a section within the song.");

    /// <summary>The chosen section is longer than this caller may have in one go; <paramref name="maxSeconds"/> is that allowance.</summary>
    public static Error SectionTooLong(double maxSeconds) =>
        Error.Validation("TRANS_SECTION_TOO_LONG", $"Pick up to {SongSections.Clock(maxSeconds)} of the song.");

    public static readonly Error InvalidKeyboardTranspose =
        Error.Validation("TRANS_INVALID_KEYBOARD_TRANSPOSE",
            "Keyboard transpose must be a whole number of semitones from -11 to 11.");

    public static readonly Error PreviewLimitReached =
        Error.Validation("PREVIEW_LIMIT_REACHED", "You've had your free preview. Sign in or create a free account to keep transcribing.");

    public static readonly Error ProRequired =
        Error.Forbidden("BILLING_PRO_REQUIRED", "Sing-along grading is a Pro feature. Upgrade to have your takes marked note by note.");

    public static readonly Error HarmonyProRequired =
        Error.Forbidden("BILLING_PRO_REQUIRED", "Four-part harmony is a Pro feature. Upgrade to have alto, tenor and bass written under your tune.");

    public static readonly Error InvalidAudio =
        Error.Validation("TRANS_INVALID_AUDIO", "The uploaded audio could not be read. Use a WAV, MP3, or M4A file.");
}
