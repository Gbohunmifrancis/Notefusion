using System.Reflection;
using Microsoft.AspNetCore.Mvc;
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
    [InlineData(null, null, true, true)]           // no key configured: a local stack
    [InlineData("", "anything", true, true)]
    [InlineData(null, null, false, false)]         // no key in production refuses everyone
    [InlineData("", "anything", false, false)]
    [InlineData("s3cret-key", "s3cret-key", false, true)]
    [InlineData("s3cret-key", "s3cret-kez", false, false)]
    [InlineData("s3cret-key", "", false, false)]
    [InlineData("s3cret-key", null, true, false)]
    public void The_completion_webhook_needs_the_worker_key(
        string? configured, string? presented, bool development, bool authorised)
        => Assert.Equal(authorised, WebhookController.IsAuthorised(configured, presented, development));

    [Theory]
    [InlineData(typeof(WebEventsController), nameof(WebEventsController.Record), AuthRateLimiting.WebEvents)]
    [InlineData(typeof(WebEventsController), nameof(WebEventsController.Beacon), AuthRateLimiting.WebEvents)]
    [InlineData(typeof(AuthController), nameof(AuthController.Refresh), AuthRateLimiting.TokenRefresh)]
    [InlineData(typeof(BlogController), nameof(BlogController.Reads), AuthRateLimiting.BlogReads)]
    [InlineData(typeof(AuthController), nameof(AuthController.Logout), AuthRateLimiting.TokenRefresh)]
    [InlineData(typeof(AuthController), nameof(AuthController.ChangePassword), AuthRateLimiting.Credentials)]
    [InlineData(typeof(PreviewController), nameof(PreviewController.LinkInfo), AuthRateLimiting.LinkInfo)]
    [InlineData(typeof(TranscriptionsController), nameof(TranscriptionsController.LinkInfo), AuthRateLimiting.LinkInfo)]
    [InlineData(typeof(BillingController), nameof(BillingController.Checkout), AuthRateLimiting.Billing)]
    [InlineData(typeof(BillingController), nameof(BillingController.Confirm), AuthRateLimiting.Billing)]
    [InlineData(typeof(BillingController), nameof(BillingController.CheckoutExit), AuthRateLimiting.Billing)]
    public void Anonymous_write_routes_carry_their_rate_limit(Type controller, string action, string policy)
    {
        var attribute = controller.GetMethod(action, BindingFlags.Public | BindingFlags.Instance)!
            .GetCustomAttribute<EnableRateLimitingAttribute>();

        Assert.NotNull(attribute);
        Assert.Equal(policy, attribute.PolicyName);
    }

    [Fact]
    public void Payment_webhooks_cap_the_body_they_read_before_the_signature_check()
    {
        var attribute = typeof(PaymentWebhooksController).GetMethod(nameof(PaymentWebhooksController.Receive))!
            .GetCustomAttribute<RequestSizeLimitAttribute>();

        Assert.NotNull(attribute);
    }

    [Theory]
    [InlineData("2a01:4f8:c0c:1234::1", "2a01:4f8:c0c:1234::/64")]
    [InlineData("2a01:4f8:c0c:1234:ffff:eeee:dddd:cccc", "2a01:4f8:c0c:1234::/64")]
    [InlineData("102.89.34.7", "102.89.34.7")]
    [InlineData("::ffff:102.89.34.7", "102.89.34.7")]
    public void Rate_limits_count_an_IPv6_subscriber_by_their_slash_64(string address, string bucket)
    {
        var context = new Microsoft.AspNetCore.Http.DefaultHttpContext();
        context.Connection.RemoteIpAddress = System.Net.IPAddress.Parse(address);

        Assert.Equal(bucket, AuthRateLimiting.PartitionKey(context, trustedProxyHops: 0));
    }
}
