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
    Task SendAsync(Guid userId, WebPushNotification notification, CancellationToken ct = default, string audience = "app");
}

/// <summary>The VAPID application server key browsers subscribe with; null when web push is off.</summary>
public interface IWebPushKeys
{
    /// <summary>The uncompressed P-256 public key, base64url without padding (what <c>applicationServerKey</c> takes).</summary>
    string? PublicKey { get; }
}
