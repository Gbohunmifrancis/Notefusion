using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>User/account-related error codes (module: users, me).</summary>
public static class UserErrors
{
    public static readonly Error NotFound =
        Error.NotFound("USER_NOT_FOUND", "The requested user was not found.");

    public static readonly Error EmailAlreadyExists =
        Error.Conflict("USER_EMAIL_EXISTS", "A user with this email address already exists.");

    public static readonly Error PictureTooLarge =
        Error.Validation("USER_PICTURE_TOO_LARGE", "Profile pictures must be 5 MB or smaller.");

    /// <summary>Also covers an empty upload — zero bytes is not one of the accepted formats either.</summary>
    public static readonly Error PictureUnsupportedType =
        Error.Validation("USER_PICTURE_UNSUPPORTED_TYPE", "Profile pictures must be a JPEG, PNG, or WebP image.");

    public static readonly Error PictureUploadFailed =
        Error.Failure("USER_PICTURE_UPLOAD_FAILED", "The picture could not be uploaded. Please try again.");

    /// <summary>This deployment has nowhere to store pictures, so nothing was saved and the old one stays.</summary>
    public static readonly Error PictureStorageUnavailable =
        Error.Failure("USER_PICTURE_STORAGE_UNAVAILABLE", "Photo uploads aren't available right now. Please try again later.");
}
