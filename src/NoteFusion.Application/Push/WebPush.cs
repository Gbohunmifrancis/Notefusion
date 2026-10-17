using System.Buffers.Text;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Push;

/// <summary>The web push rules the commands, the sender and the completion path share.</summary>
public static partial class WebPush
{
    /// <summary>A browser profile per row; past this many on one account the least recently refreshed go.</summary>
    public const int MaxSubscriptionsPerUser = 10;

    /// <summary>The longest body a notification is given (a failure reason can run long).</summary>
    public const int MaxBodyLength = 300;

    /// <summary>
    /// The push services a browser hands out endpoints on: Chrome, Edge (Chromium), Opera, Brave and Samsung
    /// use FCM; Firefox Mozilla's autopush; Edge on Windows may use WNS; Safari Apple's. The API POSTs to the
    /// endpoint a client sends, so anything else is refused rather than letting an account make the server
    /// call an address of its choosing.
    /// </summary>
    private static readonly string[] PushServiceHosts =
    [
        "fcm.googleapis.com",
        "android.googleapis.com",
        "push.services.mozilla.com",
        "notify.windows.com",
        "push.apple.com",
    ];

    public static readonly Error Off =
        Error.NotFound("WEBPUSH_OFF", "Notifications from this website aren't available right now.");

    public static readonly Error EndpointNotAllowed =
        Error.Validation("WEBPUSH_ENDPOINT_NOT_ALLOWED", "This browser's push service isn't supported.");

    /// <summary>An https URL on one of the known push services (the host itself or a subdomain of it).</summary>
    public static bool IsAllowedEndpoint(string? endpoint)
    {
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps
            || !uri.IsDefaultPort || !string.IsNullOrEmpty(uri.UserInfo))
            return false;
        var host = uri.IdnHost.ToLowerInvariant();
        return PushServiceHosts.Any(h => host == h || host.EndsWith("." + h, StringComparison.Ordinal))
               || GoogleChromiumHost().IsMatch(host);
    }

    /// <summary>Chromium builds without Chrome's own keys are handed FCM endpoints on jmtNN.google.com.</summary>
    [System.Text.RegularExpressions.GeneratedRegex(@"^jmt\d{1,3}\.google\.com$")]
    private static partial System.Text.RegularExpressions.Regex GoogleChromiumHost();

    /// <summary>Base64url (padding tolerated) that decodes to exactly <paramref name="length"/> bytes.</summary>
    public static bool IsKey(string? value, int length, byte? firstByte = null)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 200) return false;
        var trimmed = value.Trim().TrimEnd('=');
        if (!Base64Url.IsValid(trimmed, out var decoded) || decoded != length) return false;
        if (firstByte is null) return true;
        Span<byte> bytes = stackalloc byte[length];
        return Base64Url.TryDecodeFromChars(trimmed, bytes, out _) && bytes[0] == firstByte;
    }

    /// <summary>"Your sheet is ready": the same words the open tab uses (<c>web-site/assets/notify.js</c> message()).</summary>
    public static WebPushNotification Ready(string jobId, string? name)
        => new(
            "Your sheet is ready",
            Clip(string.IsNullOrWhiteSpace(name) ? "Open it in NoteFusion." : $"“{name.Trim()}” is written out. Open it in NoteFusion."),
            Tag(jobId), Url(jobId), "ready");

    /// <summary>"Transcription didn't finish", with the plain sentence the phone's push carries.</summary>
    public static WebPushNotification Failed(string jobId, string? name, string reason)
        => new(
            "Transcription didn't finish",
            Clip(string.IsNullOrWhiteSpace(name) ? reason : $"“{name.Trim()}”: {reason}"),
            Tag(jobId), Url(jobId), "failed");

    /// <summary>One notification per job: the tab's and the push's share it, so the second replaces the first.</summary>
    public static string Tag(string jobId) => "nf-job-" + jobId;

    /// <summary>Where a click goes: the web app opens a job by its id (<c>/app?job=…</c>).</summary>
    public static string Url(string jobId) => "/app?job=" + Uri.EscapeDataString(jobId);

    /// <summary>
    /// What a job is called on screen: a linked song's title, else the uploaded file's name without its
    /// extension (as notify.js nameOf()); a take has none.
    /// </summary>
    public static string? NameOf(string? songTitle, string? fileName)
    {
        if (!string.IsNullOrWhiteSpace(songTitle)) return songTitle.Trim();
        if (string.IsNullOrWhiteSpace(fileName)) return null;
        var name = Path.GetFileNameWithoutExtension(fileName.Trim()).Trim();
        return name.Length == 0 ? null : name;
    }

    private static string Clip(string text) => text.Length <= MaxBodyLength ? text : text[..(MaxBodyLength - 1)] + "…";
}
