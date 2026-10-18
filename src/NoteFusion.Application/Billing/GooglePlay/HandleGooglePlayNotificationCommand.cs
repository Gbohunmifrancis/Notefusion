using System.Text.Json;
using MediatR;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.GooglePlay;

/// <summary>
/// One Google Play real-time developer notification, already authenticated (a Pub/Sub push signed by Google) and
/// decoded from its base64 envelope. The notification only says which token changed; what changed is read from
/// Google (<see cref="GooglePlaySync"/>), so a replayed or reordered notification applies the same, current state.
/// </summary>
/// <remarks>
/// Success tells Pub/Sub to stop delivering it, including for a notification we have nothing to do with (another
/// package, a test, a product we do not sell). Only a failure to reach Google is returned as a failure, so Pub/Sub
/// tries again later.
/// </remarks>
/// <param name="DataJson">The notification itself: the JSON in the push message's <c>data</c>.</param>
public sealed record HandleGooglePlayNotificationCommand(string DataJson) : IRequest<Result>;

public sealed class HandleGooglePlayNotificationCommandHandler : IRequestHandler<HandleGooglePlayNotificationCommand, Result>
{
    /// <summary><c>voidedPurchaseNotification.productType</c> for a subscription (2 is a one-time product).</summary>
    private const int VoidedSubscription = 1;

    private readonly GooglePlaySync _sync;
    private readonly IGooglePlayClient _play;
    private readonly ILogger<HandleGooglePlayNotificationCommandHandler> _logger;

    public HandleGooglePlayNotificationCommandHandler(
        GooglePlaySync sync, IGooglePlayClient play, ILogger<HandleGooglePlayNotificationCommandHandler> logger)
    {
        _sync = sync;
        _play = play;
        _logger = logger;
    }

    public async Task<Result> Handle(HandleGooglePlayNotificationCommand request, CancellationToken ct)
    {
        JsonElement root;
        try
        {
            using var doc = JsonDocument.Parse(request.DataJson);
            root = doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            _logger.LogWarning("Google Play notification was not JSON; dropped.");
            return Result.Success();
        }

        if (root.ValueKind != JsonValueKind.Object
            || !string.Equals(Read(root, "packageName"), _play.PackageName, StringComparison.Ordinal))
        {
            return Result.Success();
        }

        Result<PlaySyncOutcome>? synced = null;
        if (root.TryGetProperty("subscriptionNotification", out var sub) && Read(sub, "purchaseToken") is { } subToken)
        {
            synced = await _sync.SyncSubscriptionAsync(subToken, caller: null, ct);
        }
        else if (root.TryGetProperty("oneTimeProductNotification", out var one)
                 && Read(one, "purchaseToken") is { } oneToken && Read(one, "sku") is { } sku)
        {
            synced = await _sync.SyncOneTimeAsync(sku, oneToken, caller: null, ct);
        }
        else if (root.TryGetProperty("voidedPurchaseNotification", out var voided) && Read(voided, "purchaseToken") is { } voidedToken)
        {
            // A refund or chargeback. For a subscription Google also revokes it, and re-reading the token ends the
            // access it paid for. A one-song purchase is usually spent by then, so nothing is taken back.
            if (voided.TryGetProperty("productType", out var type) && type.TryGetInt32(out var t) && t == VoidedSubscription)
                synced = await _sync.SyncSubscriptionAsync(voidedToken, caller: null, ct);
            else
                _logger.LogInformation("Google Play refunded a one-song purchase; the transcription it bought is kept.");
        }

        // A failure to reach Google is the one thing worth Pub/Sub delivering again; anything else (a token Google
        // does not know, a product we do not sell) would only fail the same way.
        if (synced is { IsFailure: true } failed && failed.Error.Type == ErrorType.Network)
            return failed.Error;
        if (synced is { IsFailure: true } other)
            _logger.LogWarning("Google Play notification not applied: {Code}", other.Error.Code);
        return Result.Success();
    }

    private static string? Read(JsonElement element, string name)
        => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value)
           && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
