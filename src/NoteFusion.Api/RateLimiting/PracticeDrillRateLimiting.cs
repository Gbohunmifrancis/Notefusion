using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using NoteFusion.Api.Common;

namespace NoteFusion.Api.RateLimiting;

/// <summary>
/// The address and device limits on marking a daily drill (<c>POST /api/practice/drills/grade</c>), beside the
/// per-account day allowance the handler counts (5 free, 20 Pro). The account count is what a singer meets; these
/// stop one phone or one address from minting accounts to get the worker's grader for free: a device by the
/// minute and the day, an address by the day (loosely — a carrier puts many phones behind one).
/// </summary>
/// <remarks>Built as <see cref="HymnIdentifyLimiter"/> is, for the same reason: one route, several buckets.</remarks>
public sealed class PracticeDrillLimiter : IDisposable
{
    private readonly PartitionedRateLimiter<HttpContext> _limiter;

    public PracticeDrillLimiter(RateLimitSettings settings)
    {
        var deviceMinute = (settings.PracticeDrillPermits, settings.PracticeDrillWindowSeconds);
        var deviceDay = (settings.PracticeDrillDeviceDailyPermits, 86_400);
        var addressDay = (settings.PracticeDrillAddressDailyPermits, 86_400);
        string Address(HttpContext c) => AuthRateLimiting.PartitionKey(c, settings.TrustedProxyHops);
        static string? Device(HttpContext c) => RequestDeviceFingerprint.Hash(c.Request.Headers[RequestDeviceFingerprint.HeaderName].ToString());

        _limiter = PartitionedRateLimiter.CreateChained(
            PartitionedRateLimiter.Create<HttpContext, string>(c => HymnIdentifyLimiter.Window("drill-ip-day:" + Address(c), addressDay)),
            PartitionedRateLimiter.Create<HttpContext, string>(c => Device(c) is { } d ? HymnIdentifyLimiter.Window("drill-device-minute:" + d, deviceMinute) : Unlimited),
            PartitionedRateLimiter.Create<HttpContext, string>(c => Device(c) is { } d ? HymnIdentifyLimiter.Window("drill-device-day:" + d, deviceDay) : Unlimited));
    }

    private static readonly RateLimitPartition<string> Unlimited = RateLimitPartition.GetNoLimiter("none");

    public RateLimitLease Acquire(HttpContext context) => _limiter.AttemptAcquire(context);

    public void Dispose() => _limiter.Dispose();
}

/// <summary>Applies <see cref="PracticeDrillLimiter"/> before the take is read, answering a refusal with the usual 429.</summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class PracticeDrillRateLimitAttribute : Attribute, IAsyncResourceFilter
{
    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var limiter = context.HttpContext.RequestServices.GetRequiredService<PracticeDrillLimiter>();
        using var lease = limiter.Acquire(context.HttpContext);
        if (lease.IsAcquired)
        {
            await next();
            return;
        }
        await AuthRateLimiting.WriteRejectedAsync(
            context.HttpContext, lease,
            seconds => $"That's a lot of drills from this phone for one day. Try again in {AuthRateLimiting.Describe(seconds)}.",
            context.HttpContext.RequestAborted);
        context.Result = new EmptyResult();
    }
}
