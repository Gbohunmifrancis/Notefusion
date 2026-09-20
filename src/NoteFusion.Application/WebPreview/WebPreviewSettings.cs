namespace NoteFusion.Application.WebPreview;

/// <summary>Server-side limits for the anonymous web proof funnel.</summary>
public sealed class WebPreviewSettings
{
    public const string SectionName = "WebPreview";

    public bool Enabled { get; set; } = false;
    public int MaxUploadBytes { get; set; } = 10 * 1024 * 1024;
    public double MaxClipSeconds { get; set; } = 30;
    public int DailyAllowance { get; set; } = 1;
    public int RetentionHours { get; set; } = 24;
    public int MaxEventMetadataBytes { get; set; } = 2048;
}

public static class ProductEventNames
{
    public const string LandingView = "landing_view";
    public const string IntentSelected = "intent_selected";
    public const string UploadStarted = "upload_started";
    public const string UploadRejected = "upload_rejected";
    public const string JobCreated = "job_created";
    public const string PreviewReady = "preview_ready";
    public const string PreviewPlayed = "preview_played";
    public const string AccountVerified = "account_verified";
    public const string PreviewClaimed = "preview_claimed";
    public const string MobileOpened = "mobile_opened";
    public const string JobReopened = "job_reopened";
    public const string PracticeStarted = "practice_started";
    public const string ShareCreated = "share_created";
    public const string ShareOpened = "share_opened";
    public const string QuotaHit = "quota_hit";
    public const string UpgradeViewed = "upgrade_viewed";
    public const string CheckoutStarted = "checkout_started";
    public const string SubscriptionStarted = "subscription_started";

    public static readonly IReadOnlySet<string> Allowed = new HashSet<string>(StringComparer.Ordinal)
    {
        LandingView, IntentSelected, UploadStarted, UploadRejected, JobCreated,
        PreviewReady, PreviewPlayed, AccountVerified, PreviewClaimed, MobileOpened, JobReopened,
        PracticeStarted, ShareCreated, ShareOpened, QuotaHit, UpgradeViewed,
        CheckoutStarted, SubscriptionStarted
    };
}
