using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using NoteFusion.Api.Common;

namespace NoteFusion.Api.RateLimiting;

/// <summary>
/// The limits on "Hum to find a hymn" (<c>POST /api/hymns/identify</c>): per address and per device
/// (<c>X-Device-Id</c>), each by the minute and by the day (<see cref="RateLimitSettings.HymnIdentifyPermits"/>
/// and <see cref="RateLimitSettings.HymnIdentifyDailyPermits"/>). A try must fit all four buckets.
/// </summary>
/// <remarks>
/// An <c>[EnableRateLimiting]</c> policy partitions a request into one bucket, and this route needs four, so the
/// buckets are one chained limiter of their own, applied by <see cref="HymnIdentifyRateLimitAttribute"/>. The
/// address is read exactly as the policies read it (<see cref="AuthRateLimiting.PartitionKey"/>), the windows
/// slide the same way, and a refusal is the same 429. The device id is the browser's own claim, so it only ever
/// adds a limit: a request without one is held to its address's buckets alone.
/// </remarks>
public sealed class HymnIdentifyLimiter : IDisposable
{
    private readonly PartitionedRateLimiter<HttpContext> _limiter;

    public HymnIdentifyLimiter(RateLimitSettings settings)
    {
        var minute = (settings.HymnIdentifyPermits, settings.HymnIdentifyWindowSeconds);
        var day = (settings.HymnIdentifyDailyPermits, settings.HymnIdentifyDailyWindowSeconds);
        string Address(HttpContext c) => AuthRateLimiting.PartitionKey(c, settings.TrustedProxyHops);
        static string? Device(HttpContext c) => RequestDeviceFingerprint.Hash(c.Request.Headers[RequestDeviceFingerprint.HeaderName].ToString());

        _limiter = PartitionedRateLimiter.CreateChained(
            PartitionedRateLimiter.Create<HttpContext, string>(c => Window("ip-minute:" + Address(c), minute)),
            PartitionedRateLimiter.Create<HttpContext, string>(c => Window("ip-day:" + Address(c), day)),
            PartitionedRateLimiter.Create<HttpContext, string>(c => Device(c) is { } d ? Window("device-minute:" + d, minute) : Unlimited),
            PartitionedRateLimiter.Create<HttpContext, string>(c => Device(c) is { } d ? Window("device-day:" + d, day) : Unlimited));
    }

    private static readonly RateLimitPartition<string> Unlimited = RateLimitPartition.GetNoLimiter("none");

    /// <summary>A sliding window of <paramref name="limit"/>; shared with <see cref="PracticeDrillLimiter"/>.</summary>
    internal static RateLimitPartition<string> Window(string key, (int Permits, int Seconds) limit)
        => RateLimitPartition.GetSlidingWindowLimiter(key, _ => new SlidingWindowRateLimiterOptions
        {
            PermitLimit = limit.Permits,
            Window = TimeSpan.FromSeconds(limit.Seconds),
            // As the policies: the allowance decays in steps rather than all at once (a day in hours).
            SegmentsPerWindow = limit.Seconds >= 3600 ? 24 : 4,
            QueueLimit = 0,
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
        });

    /// <summary>One try from this request: acquired, or refused with how long to wait.</summary>
    public RateLimitLease Acquire(HttpContext context) => _limiter.AttemptAcquire(context);

    public void Dispose() => _limiter.Dispose();
}

/// <summary>
/// Applies <see cref="HymnIdentifyLimiter"/> before the upload is read (a resource filter runs ahead of model
/// binding), answering a refusal with the usual 429 envelope and <c>Retry-After</c>.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class HymnIdentifyRateLimitAttribute : Attribute, IAsyncResourceFilter
{
    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var limiter = context.HttpContext.RequestServices.GetRequiredService<HymnIdentifyLimiter>();
        using var lease = limiter.Acquire(context.HttpContext);
        if (lease.IsAcquired)
        {
            await next();
            return;
        }
        await AuthRateLimiting.WriteRejectedAsync(
            context.HttpContext, lease,
            seconds => $"You've tried a lot of tunes in a short while. Try again in {AuthRateLimiting.Describe(seconds)}.",
            context.HttpContext.RequestAborted);
        context.Result = new EmptyResult();
    }
}
