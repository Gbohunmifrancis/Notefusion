namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// What a web push carries, as the web app's service worker (<c>web-site/sw.js</c>) reads it.
/// <paramref name="Tag"/> is the same tag the open tab's own notification uses (<c>nf-job-{jobId}</c>), so a
/// push and the tab never show the same job twice; <paramref name="Kind"/> is "ready" or "failed".
/// </summary>
public sealed record WebPushNotification(string Title, string Body, string Tag, string Url, string Kind);

/// <summary>
/// Sends a web push to every browser an account has subscribed (the web app's "notify me" switch). Best
/// effort and bounded, like the Expo push: it never throws for a provider's failure, only for the caller's
/// own cancellation. Subscriptions the push service says are gone are removed.
/// </summary>
public interface IWebPushSender
{
    /// <summary>To the account's browsers of one audience: the web app's ("app") or the admin console's ("console").</summary>
    Task<WebPushReport> SendAsync(Guid userId, WebPushNotification notification, CancellationToken ct = default, string audience = "app");
}

/// <summary>
/// What became of one send, per subscribed browser: delivered, gone (unsubscribed or expired, so removed), refused (a
/// stale key or a bad request, counted) or unanswered (the push service busy or away). <paramref name="Off"/> when web
/// push is off on this server. Most callers ignore it; the console's test shows it, so "on" is never a guess.
/// </summary>
public sealed record WebPushReport(bool Off, int Browsers, int Delivered, int Gone, int Refused, int Unanswered)
{
    public static readonly WebPushReport WebPushOff = new(true, 0, 0, 0, 0, 0);
    public static readonly WebPushReport NoBrowsers = new(false, 0, 0, 0, 0, 0);
}

/// <summary>The VAPID application server key browsers subscribe with; null when web push is off.</summary>
public interface IWebPushKeys
{
    /// <summary>The uncompressed P-256 public key, base64url without padding (what <c>applicationServerKey</c> takes).</summary>
    string? PublicKey { get; }
}
