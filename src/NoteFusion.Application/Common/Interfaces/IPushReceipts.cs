namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// What became of one push after Expo took it: Google's or Apple's answer. <see cref="ErrorCode"/> is null when the
/// phone's push service took it, else Expo's code for why not (<see cref="PushProblems"/>).
/// </summary>
public sealed record PushReceipt(string? ErrorCode, string? Message)
{
    public bool Delivered => ErrorCode is null;
}

/// <summary>
/// The receipts read in the last day (since the API started, if that was sooner): how many, how many Google or Apple
/// refused, and the latest refusal's code.
/// </summary>
public sealed record PushReceiptStats(int Checked, int Refused, string? LastErrorCode, DateTime? LastErrorAtUtc)
{
    public static readonly PushReceiptStats None = new(0, 0, null, null);
}

/// <summary>
/// Expo's receipts. A ticket only says Expo took a push; Google (FCM) or Apple answer later, and a push they refuse
/// (no FCM key on Expo, a phone that uninstalled the app) is lost without a word unless its receipt is read. The
/// receipt worker reads every ticket's; the test alert waits for its own.
/// </summary>
public interface IPushReceipts
{
    /// <summary>Waits up to <paramref name="within"/> for one push's receipt; null when it has none by then.</summary>
    Task<PushReceipt?> WaitAsync(string ticketId, TimeSpan within, CancellationToken ct = default);

    PushReceiptStats Stats(DateTime utcNow);
}

/// <summary>For the logging sender: there are no tickets, so there are no receipts.</summary>
public sealed class NoPushReceipts : IPushReceipts
{
    public Task<PushReceipt?> WaitAsync(string ticketId, TimeSpan within, CancellationToken ct = default)
        => Task.FromResult<PushReceipt?>(null);

    public PushReceiptStats Stats(DateTime utcNow) => PushReceiptStats.None;
}

/// <summary>
/// Expo's error codes, and what each means for the admin reading it: in the test alert's answer and on System Health.
/// Our own sentences, never Expo's text.
/// </summary>
public static class PushProblems
{
    /// <summary>The phone uninstalled the app or its registration expired: its token is dropped.</summary>
    public const string DeviceNotRegistered = "DeviceNotRegistered";

    /// <summary>Expo has no working FCM V1 key for the app (Android), or no APNs key (iOS).</summary>
    public const string InvalidCredentials = "InvalidCredentials";

    /// <summary>The FCM key on Expo belongs to another Firebase project than the app's google-services.json.</summary>
    public const string MismatchSenderId = "MismatchSenderId";

    public const string MessageTooBig = "MessageTooBig";
    public const string MessageRateExceeded = "MessageRateExceeded";

    /// <summary>Ours, for Expo's 401: enhanced push security is on and the API sends no access token.</summary>
    public const string Unauthorized = "Unauthorized";

    /// <summary>Codes that stop every push to a platform, not one phone's: logged as errors (Sentry).</summary>
    public static bool StopsEveryPush(string code)
        => code is InvalidCredentials or MismatchSenderId or Unauthorized;

    /// <summary>
    /// The plain sentence for <paramref name="code"/>. <paramref name="thisPhone"/> for the test alert, which names the
    /// phone it was sent from.
    /// </summary>
    public static string Describe(string code, bool thisPhone = false) => code switch
    {
        InvalidCredentials =>
            "Google refused it: Expo has no push key for the app. Upload the FCM V1 service account key at "
            + "expo.dev › NoteFusion › Credentials › Android.",
        MismatchSenderId =>
            "Google refused it: the push key on Expo is for a different Firebase project from the app's. Upload the "
            + "key for the app's own project at expo.dev › NoteFusion › Credentials › Android.",
        Unauthorized =>
            "Expo refused it: enhanced push security is on for the project. Set Push__ExpoAccessToken on the API, or "
            + "turn it off at expo.dev › NoteFusion › Credentials.",
        DeviceNotRegistered => thisPhone
            ? "This phone's push registration has expired. Turn notifications off and on in Profile › Notifications, "
              + "then try again."
            : "A phone had uninstalled the app or its registration had expired; it was dropped.",
        MessageRateExceeded => thisPhone
            ? "Google is holding back pushes to this phone: too many at once. Try again in a minute."
            : "Google held back pushes to one phone: too many at once.",
        MessageTooBig => "A push was too large to send.",
        _ => $"Google or Apple refused it ({code}).",
    };
}
