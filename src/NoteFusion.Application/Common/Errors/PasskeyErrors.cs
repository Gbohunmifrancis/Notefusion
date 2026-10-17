using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>
/// Passkey error codes (module: auth). Plain sentences: the console shows the message as-is. Registration
/// failures are never 401 — the console treats a 401 on a signed-in call as an expired session.
/// </summary>
public static class PasskeyErrors
{
    public static readonly Error AdminOnly =
        Error.Forbidden("PASSKEY_ADMIN_ONLY", "Passkeys are only available for admin accounts for now.");

    public static readonly Error RegistrationExpired =
        Error.Validation("PASSKEY_REQUEST_EXPIRED", "That passkey request expired. Try adding it again.");

    public static readonly Error RegistrationFailed =
        Error.Validation("PASSKEY_NOT_VERIFIED", "We couldn't verify that passkey. Try adding it again.");

    public static readonly Error AlreadyRegistered =
        Error.Conflict("PASSKEY_ALREADY_REGISTERED", "This passkey is already on an account.");

    public static readonly Error NotFound =
        Error.NotFound("PASSKEY_NOT_FOUND", "That passkey wasn't found. It may already have been removed.");

    public static readonly Error SignInExpired =
        Error.Unauthorized("PASSKEY_SIGN_IN_EXPIRED", "That sign-in request expired. Try again.");

    public static readonly Error UnknownPasskey =
        Error.Unauthorized("PASSKEY_UNKNOWN",
            "This passkey isn't registered with NoteFusion. Sign in with your password, then add it in Settings.");

    public static readonly Error SignInFailed =
        Error.Unauthorized("PASSKEY_SIGN_IN_FAILED",
            "We couldn't verify that passkey. Try again, or sign in with your password.");

    public static readonly Error NotAnAdmin =
        Error.Forbidden("PASSKEY_NOT_ADMIN", "This passkey isn't for an admin account.");
}
