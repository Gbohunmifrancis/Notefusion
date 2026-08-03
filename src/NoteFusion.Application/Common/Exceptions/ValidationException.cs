namespace NoteFusion.Application.Common.Exceptions;

/// <summary>
/// Thrown by the validation pipeline behavior when a request fails its FluentValidation rules.
/// Carries per-field errors which the API maps to a 422 response.
/// </summary>
public sealed class ValidationException : Exception
{
    public ValidationException(IReadOnlyDictionary<string, string[]> errors)
        : base("One or more validation errors occurred.")
        => Errors = errors;

    public IReadOnlyDictionary<string, string[]> Errors { get; }
}
