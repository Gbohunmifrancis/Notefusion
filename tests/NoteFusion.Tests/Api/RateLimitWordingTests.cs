using NoteFusion.Api.RateLimiting;

namespace NoteFusion.Tests.Api;

/// <summary>The wait a refusal names, in the unit a person would use.</summary>
public class RateLimitWordingTests
{
    [Theory]
    [InlineData(30, "30 seconds")]
    [InlineData(89, "89 seconds")]
    [InlineData(90, "2 minutes")]
    [InlineData(60 * 60, "60 minutes")]
    [InlineData(89 * 60, "89 minutes")]
    [InlineData(90 * 60, "2 hours")]
    [InlineData(23 * 60 * 60 + 1, "24 hours")]
    public void Describe_UsesSecondsThenMinutesThenHours(int seconds, string expected)
        => Assert.Equal(expected, AuthRateLimiting.Describe(seconds));
}
