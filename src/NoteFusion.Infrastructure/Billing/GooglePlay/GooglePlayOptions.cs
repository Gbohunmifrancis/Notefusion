using System.Text;

namespace NoteFusion.Infrastructure.Billing.GooglePlay;

/// <summary>
/// Google Play Billing (section <c>GooglePlay</c>): the Android app's package, the service account the server reads
/// purchases with, and who may push Google's real-time notifications. Without a service account nothing is granted:
/// every purchase answers "try again" and stays safe with Google until the account is set.
/// </summary>
public sealed class GooglePlayOptions
{
    public string PackageName { get; init; } = "com.notefusion.com";

    /// <summary>
    /// The service account's JSON key, as downloaded or base64-encoded (a deploy secret holds one line). Its account
    /// needs Play Console access to "View financial data" and "Manage orders and subscriptions".
    /// </summary>
    public string? ServiceAccountJson { get; init; }

    /// <summary>
    /// The audience Pub/Sub signs its push token for: the notification endpoint's own URL, as set on the push
    /// subscription (e.g. <c>https://api.notefusion.studio/api/billing/google-play/notifications</c>).
    /// </summary>
    public string? PushAudience { get; init; }

    /// <summary>The service account the Pub/Sub push subscription authenticates as; its email is in every push token.</summary>
    public string? PushServiceAccount { get; init; }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ServiceAccountJson);

    public bool CanVerifyPushes => !string.IsNullOrWhiteSpace(PushAudience) && !string.IsNullOrWhiteSpace(PushServiceAccount);

    /// <summary>The key as JSON, whether it was given raw or base64-encoded.</summary>
    public string ServiceAccountJsonText()
    {
        var value = ServiceAccountJson?.Trim() ?? string.Empty;
        if (value.StartsWith('{'))
            return value;
        try
        {
            return Encoding.UTF8.GetString(Convert.FromBase64String(value));
        }
        catch (FormatException)
        {
            return value;
        }
    }
}
