namespace NoteFusion.Api.Common;

/// <summary>
/// The single error shape every failed response carries. <c>Code</c> is the machine-readable catalogue
/// code (e.g. <c>Auth.InvalidCredentials</c>); <c>Details</c> holds per-field validation messages.
/// </summary>
public sealed record ApiError(string Code, string Message, IReadOnlyDictionary<string, string[]>? Details = null);
