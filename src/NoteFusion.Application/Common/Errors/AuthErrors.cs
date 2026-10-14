using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>Auth-related error codes (module: auth).</summary>
public static class AuthErrors
{
    public static readonly Error InvalidCredentials =
        Error.Unauthorized("AUTH_INVALID_CREDENTIALS", "Invalid email or password.");

    public static readonly Error AccountInactive =
        Error.Forbidden("AUTH_ACCOUNT_INACTIVE", "This account has been deactivated. Contact support.");

    public static readonly Error InvalidRefreshToken =
        Error.Unauthorized("AUTH_INVALID_REFRESH_TOKEN", "The refresh token is invalid or has expired.");

    public static readonly Error CurrentPasswordIncorrect =
        Error.Validation("AUTH_CURRENT_PASSWORD_INCORRECT", "The current password is incorrect.");

    public static readonly Error PasswordTooWeak =
        Error.Validation("AUTH_PASSWORD_WEAK",
            "Password must be at least 8 characters and contain a letter and a number.");

    public static readonly Error InvalidGoogleToken =
        Error.Unauthorized("AUTH_INVALID_GOOGLE_TOKEN", "The Google sign-in token is invalid or has expired.");

    public static readonly Error GoogleEmailNotVerified =
        Error.Forbidden("AUTH_GOOGLE_EMAIL_UNVERIFIED",
            "Google has not verified this email address, so it cannot be used to sign in.");

    /// <summary>
    /// Raised when a password-only operation is attempted on an account that signed up
    /// through Google and therefore never set one.
    /// </summary>
    public static readonly Error PasswordNotSet =
        Error.Validation("AUTH_PASSWORD_NOT_SET",
            "This account signs in with Google and has no password set.");

    public static readonly Error ReauthenticationRequired =
        Error.Unauthorized("AUTH_REAUTHENTICATION_REQUIRED",
            "Confirm it is you: supply your password, or a Google token if you sign in with Google.");

    /// <summary>
    /// Returned when the supplied reset token is missing, incorrect, or past its 1-hour window.
    /// Generic phrasing avoids confirming whether the email belongs to any account.
    /// </summary>
    public static readonly Error InvalidResetToken =
        Error.Validation("AUTH_INVALID_RESET_TOKEN",
            "The password-reset link is invalid or has expired. Request a new one.");

    /// <summary>
    /// Returned by login when the password was correct but the address has never been confirmed. The
    /// client routes on this code to the code-entry screen, and the handler has already mailed a fresh
    /// code by the time it is returned — so the user arrives there with something to type.
    /// </summary>
    /// <remarks>
    /// Only ever raised <em>after</em> the password check. Raising it first would be faster and would
    /// turn login into a way to ask "is this address registered?" without knowing any password.
    /// </remarks>
    public static readonly Error EmailNotVerified =
        Error.Forbidden("AUTH_EMAIL_NOT_VERIFIED",
            "Confirm your email address to finish setting up your account. We've sent you a new code.");

    /// <summary>
    /// One answer for a code that is wrong, expired, already used, or has run out of attempts. Which of
    /// those it was is exactly what someone guessing wants to know.
    /// </summary>
    public static readonly Error InvalidVerificationCode =
        Error.Validation("AUTH_INVALID_VERIFICATION_CODE",
            "That code is incorrect or has expired. Request a new one to try again.");
}
