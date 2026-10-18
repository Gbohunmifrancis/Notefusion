namespace NoteFusion.Application.Common.Interfaces;

/// <summary>A push notification payload.</summary>
/// <param name="Sound">
/// "default" plays the phone's notification sound on iOS; null leaves it silent there. Android takes its sound
/// from the channel (<paramref name="ChannelId"/>), not from the message.
/// </param>
/// <param name="ChannelId">The Android notification channel; null is the app's default ("Transcriptions").</param>
/// <param name="TimeToLiveSeconds">How long the push service may hold it for an offline phone; null is its default.</param>
/// <param name="CategoryId">
/// The notification category the app registered for its action buttons (a payment alert's "View payment" and
/// "Mute 1 hour"); null for none.
/// </param>
public sealed record PushMessage(
    string Title,
    string Body,
    IReadOnlyDictionary<string, string>? Data = null,
    string? Sound = null,
    string? ChannelId = null,
    int? TimeToLiveSeconds = null,
    string? CategoryId = null);

/// <summary>
/// How one send to a set of devices went. <see cref="Error"/> is null when the push service accepted it for at
/// least one device; <see cref="NotAttempted"/> is true when the open breaker refused it unsent (not a failed try).
/// </summary>
public sealed record PushDelivery(int Accepted, int Refused, string? Error, bool NotAttempted = false)
{
    public bool Delivered => Error is null;

    public static PushDelivery Ok(int accepted, int refused = 0) => new(accepted, refused, null);
    public static PushDelivery Failed(string error, int refused = 0) => new(0, refused, error);
    public static PushDelivery Unavailable(string reason) => new(0, 0, reason, NotAttempted: true);
}

/// <summary>
/// Delivers push notifications to recipients identified by their user id. The default implementation
/// logs only; the real sender (Expo push) activates once configured. Swapping providers is a single
/// DI change — nothing else in the pipeline changes.
/// </summary>
public interface IPushSender
{
    Task SendAsync(IReadOnlyList<Guid> recipientUserIds, PushMessage message, CancellationToken ct = default);

    /// <summary>
    /// Sends to exactly these device tokens and says how it went, for a batch that keeps a claim per send and
    /// retries a failure (the practice reminders). Never throws for the provider's failure, only for the caller's
    /// own cancellation.
    /// </summary>
    Task<PushDelivery> SendToDevicesAsync(IReadOnlyList<string> tokens, PushMessage message, CancellationToken ct = default);
}
