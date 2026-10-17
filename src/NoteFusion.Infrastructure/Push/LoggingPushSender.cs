using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Push;

/// <summary>
/// Default <see cref="IPushSender"/> used in development: writes the notification to the log so the
/// pipeline can be exercised end-to-end without an Expo account. The real sender (<see cref="ExpoPushSender"/>)
/// replaces this with a single DI change. Could not be reached; no external calls.
/// </summary>
public sealed class LoggingPushSender : IPushSender
{
    private readonly ILogger<LoggingPushSender> _logger;

    public LoggingPushSender(ILogger<LoggingPushSender> logger) => _logger = logger;

    public Task SendAsync(
        IReadOnlyList<Guid> recipientUserIds, PushMessage message, CancellationToken ct = default)
    {
        _logger.LogInformation(
            "Push notification (dev, not delivered): {Title} — {Body} → {Count} recipient(s)",
            message.Title,
            message.Body,
            recipientUserIds.Count);

        return Task.CompletedTask;
    }

    public Task<PushDelivery> SendToDevicesAsync(
        IReadOnlyList<string> tokens, PushMessage message, CancellationToken ct = default)
    {
        _logger.LogInformation(
            "Push notification (dev, not delivered): {Title} — {Body} → {Count} device(s), channel {Channel}, sound {Sound}",
            message.Title,
            message.Body,
            tokens.Count,
            message.ChannelId ?? "default",
            message.Sound ?? "none");

        return Task.FromResult(PushDelivery.Ok(tokens.Count));
    }
}
