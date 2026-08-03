using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>Auth-related error codes (module: auth).</summary>
public static class AuthErrors
{
    public static readonly Error InvalidCredentials =
        Error.Unauthorized("AUTH_INVALID_CREDENTIALS", "Invalid email or password.");

    public static readonly Error AccountInactive =
        Error.Forbidden("AUTH_ACCOUNT_INACTIVE", "This account has been deactivated. Contact support.");

    public static Error AccountLocked(DateTime untilUtc) =>
        Error.Forbidden("AUTH_ACCOUNT_LOCKED",
            $"Account locked due to repeated failed attempts. Try again after {untilUtc:u}.");

    public static readonly Error InvalidRefreshToken =
        Error.Unauthorized("AUTH_INVALID_REFRESH_TOKEN", "The refresh token is invalid or has expired.");

    public static readonly Error CurrentPasswordIncorrect =
        Error.Validation("AUTH_CURRENT_PASSWORD_INCORRECT", "The current password is incorrect.");

    public static readonly Error PasswordTooWeak =
        Error.Validation("AUTH_PASSWORD_WEAK",
            "Password must be at least 8 characters and contain a letter and a number.");
}
