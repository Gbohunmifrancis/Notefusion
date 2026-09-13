using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>Waitlist-related error codes (module: waitlist).</summary>
public static class WaitlistErrors
{
    public static readonly Error AlreadyRegistered =
        Error.Conflict("WAITLIST_ALREADY_REGISTERED", "This email address is already on the waitlist.");

    public static readonly Error InvalidEmail =
        Error.Validation("WAITLIST_INVALID_EMAIL", "A valid email address is required.");
}
