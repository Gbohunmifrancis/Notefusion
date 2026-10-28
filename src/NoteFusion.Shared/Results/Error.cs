namespace NoteFusion.Shared.Results;

/// <summary>
/// Classifies a failure so callers (UI, API client) can react appropriately
/// without the application layer knowing about transport or presentation.
/// </summary>
public enum ErrorType
{
    Failure = 0,
    Validation = 1,
    NotFound = 2,
    Conflict = 3,
    Unauthorized = 4,
    Forbidden = 5,
    LowConfidence = 6,
    Network = 7
}

/// <summary>
/// A machine-readable error code, a human-readable message, and a type used for handling decisions.
/// </summary>
public sealed record Error(string Code, string Message, ErrorType Type)
{
    public static readonly Error None = new(string.Empty, string.Empty, ErrorType.Failure);

    /// <summary>
    /// Where on its way in a submission stopped (the worker's stages: parse, resolve, metadata, search, download, decode,
    /// separation, transcription; or this API's own gate), for the activity log only: never shown. Not part of equality,
    /// so an error carrying it is still the error it names.
    /// </summary>
    public string? Stage { get; init; }

    /// <summary>The reason in one word as the worker gave it (blocked, unavailable, no_match…), for the log only.</summary>
    public string? Cause { get; init; }

    public bool Equals(Error? other)
        => other is not null && Code == other.Code && Message == other.Message && Type == other.Type;

    public override int GetHashCode() => HashCode.Combine(Code, Message, Type);

    public static Error Failure(string code, string message) => new(code, message, ErrorType.Failure);
    public static Error Validation(string code, string message) => new(code, message, ErrorType.Validation);
    public static Error NotFound(string code, string message) => new(code, message, ErrorType.NotFound);
    public static Error Conflict(string code, string message) => new(code, message, ErrorType.Conflict);
    public static Error Unauthorized(string code, string message) => new(code, message, ErrorType.Unauthorized);
    public static Error Forbidden(string code, string message) => new(code, message, ErrorType.Forbidden);

    /// <summary>Transcription confidence too low to publish; PRD requires honest messaging over garbage output.</summary>
    public static Error LowConfidence(string code, string message) => new(code, message, ErrorType.LowConfidence);

    /// <summary>Connectivity failures — common in the target market; must be surfaced with retry guidance.</summary>
    public static Error Network(string code, string message) => new(code, message, ErrorType.Network);
}
