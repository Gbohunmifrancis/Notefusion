using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>
/// An outside provider (payments, email, push) is being refused calls because its circuit breaker is open.
/// Distinct from an ordinary network error so a batch that sees it stops for the run and keeps the item for
/// the next one, rather than counting it as a failed try.
/// </summary>
public static class ProviderErrors
{
    public const string UnavailableCode = "PROVIDER_UNAVAILABLE";

    public static readonly Error Unavailable =
        Error.Network(UnavailableCode, "A service we rely on is not answering right now. Please try again in a minute.");

    public static bool IsUnavailable(Error error) => error.Code == UnavailableCode;
}
