using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>Refusals from the console's Feature flags page. The message is shown to the admin as it is.</summary>
public static class FeatureFlagErrors
{
    public static readonly Error Unknown =
        Error.NotFound("FEATURE_FLAG_UNKNOWN", "There is no feature flag by that name.");

    /// <summary>Switched on with a last day already gone: it would be off the moment it was turned on.</summary>
    public static readonly Error AutoOffPassed =
        Error.Validation("FEATURE_FLAG_AUTO_OFF_PASSED", "That switch-off date has passed. Pick a later one, or untick it.");

    /// <summary>Two admins saved the same flag at the same moment; the other one's change landed first.</summary>
    public static readonly Error Conflict =
        Error.Conflict("FEATURE_FLAG_CONFLICT", "Someone else changed this flag just now. Reload the page and try again.");
}
