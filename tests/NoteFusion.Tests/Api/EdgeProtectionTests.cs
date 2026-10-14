using System.Reflection;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Controllers;
using NoteFusion.Api.RateLimiting;

namespace NoteFusion.Tests.Api;

/// <summary>
/// The API's own edge: which browsers may call it, which routes are rate limited, and the key the worker's
/// completion callback must carry.
/// </summary>
public class EdgeProtectionTests
{
    private static readonly string[] Listed = ["https://notefusion.studio", "http://localhost:3000"];

    [Theory]
    [InlineData("https://notefusion.studio", true)]
    [InlineData("HTTPS://NOTEFUSION.STUDIO", true)]
    [InlineData("http://localhost:3000", true)]
    [InlineData("https://notefusion-web-git-feature-x.vercel.app", true)]
    [InlineData("http://notefusion-web-git-feature-x.vercel.app", false)]
    [InlineData("https://evil.example", false)]
    [InlineData("https://vercel.app.evil.example", false)]
    [InlineData("https://evilvercel.app", false)]
    [InlineData("https://preview.vercel.app:8443", false)]
    [InlineData("null", false)]
    public void Cors_allows_the_listed_origins_and_https_vercel_previews_only(string origin, bool allowed)
        => Assert.Equal(allowed, Program.IsAllowedOrigin(origin, Listed));

    [Theory]
    [InlineData(null, null, true)]           // no key configured: a local stack
    [InlineData("", "anything", true)]
    [InlineData("s3cret-key", "s3cret-key", true)]
    [InlineData("s3cret-key", "s3cret-kez", false)]
    [InlineData("s3cret-key", "", false)]
    [InlineData("s3cret-key", null, false)]
    public void The_completion_webhook_needs_the_worker_key_when_one_is_configured(
        string? configured, string? presented, bool authorised)
        => Assert.Equal(authorised, WebhookController.IsAuthorised(configured, presented));

    [Theory]
    [InlineData(typeof(WebEventsController), nameof(WebEventsController.Record), AuthRateLimiting.WebEvents)]
    [InlineData(typeof(AuthController), nameof(AuthController.Refresh), AuthRateLimiting.TokenRefresh)]
    public void Anonymous_write_routes_carry_their_rate_limit(Type controller, string action, string policy)
    {
        var attribute = controller.GetMethod(action, BindingFlags.Public | BindingFlags.Instance)!
            .GetCustomAttribute<EnableRateLimitingAttribute>();

        Assert.NotNull(attribute);
        Assert.Equal(policy, attribute.PolicyName);
    }
}
