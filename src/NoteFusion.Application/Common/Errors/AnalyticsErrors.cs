using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>Admin analytics error codes (module: analytics).</summary>
public static class AnalyticsErrors
{
    public static readonly Error RangeTooWide =
        Error.Validation("ANALYTICS_RANGE_TOO_WIDE",
            $"A range may span at most {AnalyticsRange.MaxDays} days. Request a narrower window.");

    public static readonly Error RangeInverted =
        Error.Validation("ANALYTICS_RANGE_INVERTED", "The start of the range must not be after its end.");
}
