namespace NoteFusion.Application.Common.Interfaces;

/// <summary>A push notification payload.</summary>
public sealed record PushMessage(string Title, string Body, IReadOnlyDictionary<string, string>? Data = null);

/// <summary>
/// Delivers push notifications to recipients identified by their user id. The default implementation
/// logs only; the real sender (Expo push) activates once configured. Swapping providers is a single
/// DI change — nothing else in the pipeline changes.
/// </summary>
public interface IPushSender
{
    Task SendAsync(IReadOnlyList<Guid> recipientUserIds, PushMessage message, CancellationToken ct = default);
}
