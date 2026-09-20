using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

public static class WebPreviewErrors
{
    public static readonly Error Disabled =
        Error.NotFound("WEB_PREVIEW_DISABLED", "Web preview is not available right now.");

    public static readonly Error InvalidToken =
        Error.NotFound("WEB_PREVIEW_NOT_FOUND", "That preview is unavailable or has expired.");

    public static readonly Error Expired =
        Error.NotFound("WEB_PREVIEW_EXPIRED", "That preview has expired. Start a new preview to continue.");

    public static Error QuotaReached(int allowance) =>
        Error.Forbidden("WEB_PREVIEW_QUOTA_REACHED",
            $"You have used the {allowance} web preview allowed in this period. Create an account or continue in the app for more.");

    public static readonly Error InvalidEvent =
        Error.Validation("TELEMETRY_INVALID_EVENT", "That product event is not supported.");

    public static readonly Error EventTooLarge =
        Error.Validation("TELEMETRY_EVENT_TOO_LARGE", "That product event is too large.");
}
