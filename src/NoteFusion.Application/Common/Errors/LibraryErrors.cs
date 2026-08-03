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
}
