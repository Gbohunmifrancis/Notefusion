using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A browser's web push subscription (the Push API's endpoint and its two keys) for one account, so a
/// transcription that finishes after the tab was closed can still say so. Kept apart from
/// <see cref="DeviceToken"/>: those are Expo tokens, sent through Expo and counted as "has the phone app".
/// </summary>
/// <remarks>
/// The endpoint names one browser profile, not a person, so it is unique: a browser that signs into
/// another account moves its subscription there (<see cref="Refresh"/>). A row that the push service
/// says is gone (404/410) is deleted; one that keeps failing is dropped after <see cref="MaxFailures"/>.
/// </remarks>
public class WebPushSubscription : BaseEntity
{
    public const int EndpointMaxLength = 2048;
    public const int KeyMaxLength = 200;
    public const int UserAgentMaxLength = 200;

    /// <summary>Failed sends in a row (not counting an unreachable service) before the row is dropped.</summary>
    public const int MaxFailures = 5;

    /// <summary>The web app's browsers: a transcription ready or failed.</summary>
    public const string AppAudience = "app";

    /// <summary>The admin console's browsers: payments, sign-up waves and transcription floods (an admin's own).</summary>
    public const string ConsoleAudience = "console";

    private WebPushSubscription() { } // EF Core

    public Guid UserId { get; private set; }

    /// <summary>The push service URL the browser handed out; the row's identity.</summary>
    public string Endpoint { get; private set; } = string.Empty;

    /// <summary>The browser's P-256 public key (base64url), what the payload is encrypted to.</summary>
    public string P256dh { get; private set; } = string.Empty;

    /// <summary>The 16-byte auth secret (base64url).</summary>
    public string Auth { get; private set; } = string.Empty;

    /// <summary>The browser that subscribed, as it named itself; only for telling rows apart.</summary>
    public string? UserAgent { get; private set; }

    /// <summary><see cref="AppAudience"/> or <see cref="ConsoleAudience"/>: which pushes this browser takes.</summary>
    public string Audience { get; private set; } = AppAudience;

    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }
    public DateTime? LastSuccessAtUtc { get; private set; }
    public int FailureCount { get; private set; }

    public static WebPushSubscription Create(
        Guid userId, string endpoint, string p256dh, string auth, string? userAgent, DateTime utcNow, string audience = AppAudience)
        => new()
        {
            Audience = audience == ConsoleAudience ? ConsoleAudience : AppAudience,
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            Endpoint = Guard.NotNullOrWhiteSpace(endpoint),
            P256dh = Guard.NotNullOrWhiteSpace(p256dh),
            Auth = Guard.NotNullOrWhiteSpace(auth),
            UserAgent = Clip(userAgent),
            CreatedAtUtc = utcNow,
            UpdatedAtUtc = utcNow
        };

    /// <summary>The browser subscribed again (or another account signed in on it): new owner and keys, a clean slate.</summary>
    public void Refresh(Guid userId, string p256dh, string auth, string? userAgent, DateTime utcNow, string audience = AppAudience)
    {
        Audience = audience == ConsoleAudience ? ConsoleAudience : AppAudience;
        UserId = Guard.AgainstEmpty(userId);
        P256dh = Guard.NotNullOrWhiteSpace(p256dh);
        Auth = Guard.NotNullOrWhiteSpace(auth);
        UserAgent = Clip(userAgent);
        FailureCount = 0;
        UpdatedAtUtc = utcNow;
    }

    public void RecordSuccess(DateTime utcNow)
    {
        LastSuccessAtUtc = utcNow;
        FailureCount = 0;
    }

    /// <summary>Counts a refused send; true when the row has failed often enough to be dropped.</summary>
    public bool RecordFailure()
    {
        FailureCount++;
        return FailureCount >= MaxFailures;
    }

    private static string? Clip(string? value)
    {
        var v = value?.Trim();
        if (string.IsNullOrEmpty(v)) return null;
        return v.Length <= UserAgentMaxLength ? v : v[..UserAgentMaxLength];
    }
}
