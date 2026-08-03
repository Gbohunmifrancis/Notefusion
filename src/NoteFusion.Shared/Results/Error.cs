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
