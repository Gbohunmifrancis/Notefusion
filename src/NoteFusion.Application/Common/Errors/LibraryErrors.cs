using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>Library/transcription-related error codes (module: library).</summary>
public static class LibraryErrors
{
    public static readonly Error NotFound =
        Error.NotFound("LIBRARY_NOT_FOUND", "The requested transcription was not found.");

    public static readonly Error NotOwnedByUser =
        Error.Forbidden("LIBRARY_NOT_OWNED", "This transcription belongs to another account.");

    public static readonly Error InvalidKey =
        Error.Validation("LIBRARY_INVALID_KEY",
            "Key must be a note (A–G) with an optional #/b and an optional major/minor, e.g. \"C\", \"Bb\", \"F# minor\", \"Am\".");

    public static readonly Error InvalidTempo =
        Error.Validation("LIBRARY_INVALID_TEMPO", "Tempo must be between 20 and 300 BPM.");

    public static readonly Error InvalidScore =
        Error.Validation("LIBRARY_INVALID_SCORE", "The stored score is not well-formed MusicXML, so it cannot be transposed.");

    public static readonly Error InvalidTransposition =
        Error.Validation("LIBRARY_INVALID_TRANSPOSITION", "Transpose by between -12 and 12 semitones.");

    public static readonly Error ShareNotFound =
        Error.NotFound("SHARE_NOT_FOUND", "This sheet is no longer shared.");

    public static readonly Error InvalidTimeSignature =
        Error.Validation("LIBRARY_INVALID_TIME_SIGNATURE", "Time signature must be in format N/D (e.g. 4/4, 3/4, 6/8).");

    public static readonly Error EmptyFolder =
        Error.Validation("LIBRARY_EMPTY_FOLDER", "There are no sheets in that folder to share.");
}
