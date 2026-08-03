using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>User/account-related error codes (module: users, me).</summary>
public static class UserErrors
{
    public static readonly Error NotFound =
        Error.NotFound("USER_NOT_FOUND", "The requested user was not found.");

    public static readonly Error EmailAlreadyExists =
        Error.Conflict("USER_EMAIL_EXISTS", "A user with this email address already exists.");
}
