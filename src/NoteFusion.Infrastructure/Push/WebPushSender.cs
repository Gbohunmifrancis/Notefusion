using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Push;
using NoteFusion.Core.Entities;
using NoteFusion.Infrastructure.Http;
using LibPushMessage = Lib.Net.Http.WebPush.PushMessage;

namespace NoteFusion.Infrastructure.Push;

/// <summary>
/// Sends web pushes (RFC 8030) to an account's subscribed browsers: the payload encrypted to each browser
/// (RFC 8291, aes128gcm) and signed with our VAPID key (RFC 8292) by Lib.Net.Http.WebPush, over the
/// <see cref="HttpClient"/> this typed client is given — so every send goes through
/// <see cref="OutboundResilience.WebPush"/> (timeouts, a breaker per push service, no retry of the POST).
/// </summary>
/// <remarks>
/// Best effort, like <see cref="ExpoPushSender"/>: it runs at the end of job completion, so nothing a push
/// service does may throw out of it. A subscription the service says is gone (404/410) is deleted; one it
/// refuses otherwise counts a failure and is dropped after <see cref="WebPushSubscription.MaxFailures"/>;
/// one it never answered (timeout, network, open breaker) is left alone — that is the service, not the row.
/// </remarks>
public sealed class WebPushSender : IWebPushSender
{
    /// <summary>A "your sheet is ready" a day late is still worth having; older than that it is noise.</summary>
    private const int TimeToLiveSeconds = 24 * 60 * 60;

    private readonly HttpClient _http;
    private readonly IApplicationDbContext _db;
    private readonly VapidKeys _keys;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<WebPushSender> _logger;

    public WebPushSender(
        HttpClient http, IApplicationDbContext db, VapidKeys keys, IDateTimeProvider clock, ILogger<WebPushSender> logger)
    {
        _http = http;
        _db = db;
        _keys = keys;
        _clock = clock;
        _logger = logger;
    }

    private enum Outcome { Delivered, Gone, Refused, Unanswered }

    public async Task SendAsync(Guid userId, WebPushNotification notification, CancellationToken ct = default, string audience = WebPushSubscription.AppAudience)
    {
        if (!_keys.IsOn)
            return;

        List<WebPushSubscription> subscriptions;
        try
        {
            subscriptions = await _db.WebPushSubscriptions
                .Where(s => s.UserId == userId && s.Audience == audience)
                .OrderByDescending(s => s.UpdatedAtUtc)
                .Take(WebPush.MaxSubscriptionsPerUser)
                .ToListAsync(ct);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            _logger.LogWarning(ex, "Could not read the web push subscriptions; web push not sent.");
            return;
        }

        if (subscriptions.Count == 0)
            return;

        var payload = JsonSerializer.Serialize(
            new WebPushPayload(notification.Title, notification.Body, notification.Tag, notification.Url, notification.Kind),
            WebPushJsonContext.Default.WebPushPayload);

        // In parallel, each bounded by the pipeline's timeouts: the slowest browser sets the wait, not the sum.
        var outcomes = await Task.WhenAll(subscriptions.Select(s => DeliverAsync(s, payload, ct)));

        var now = _clock.UtcNow;
        for (var i = 0; i < subscriptions.Count; i++)
        {
            var subscription = subscriptions[i];
            switch (outcomes[i])
            {
                case Outcome.Delivered:
                    subscription.RecordSuccess(now);
                    break;
                case Outcome.Gone:
                    _db.WebPushSubscriptions.Remove(subscription);
                    break;
                case Outcome.Refused when subscription.RecordFailure():
                    _logger.LogInformation(
                        "Web push subscription {SubscriptionId} failed {Count} times in a row; dropped.",
                        subscription.Id, subscription.FailureCount);
                    _db.WebPushSubscriptions.Remove(subscription);
                    break;
            }
        }

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            // The browser unsubscribed (or another account took the endpoint) while we were sending.
            _logger.LogInformation(ex, "Web push bookkeeping was overtaken by another change; left as it is.");
        }
    }

    private async Task<Outcome> DeliverAsync(WebPushSubscription row, string payload, CancellationToken ct)
    {
        try
        {
            var subscription = new PushSubscription { Endpoint = row.Endpoint };
            subscription.SetKey(PushEncryptionKeyName.P256DH, row.P256dh);
            subscription.SetKey(PushEncryptionKeyName.Auth, row.Auth);

            // One client and one VAPID signer per send: they are cheap and keep the parallel sends apart.
            using var vapid = new VapidAuthentication(_keys.PublicKey!, _keys.PrivateKey!) { Subject = _keys.Subject };
            var client = new PushServiceClient(_http)
            {
                // A 429's Retry-After would be the library re-POSTing: the pipeline owns retries, and a push is not repeated.
                AutoRetryAfter = false,
            };

            await client.RequestPushMessageDeliveryAsync(
                subscription,
                new LibPushMessage(payload) { TimeToLive = TimeToLiveSeconds, Urgency = PushMessageUrgency.High },
                vapid,
                VapidAuthenticationScheme.Vapid,
                ct);
            return Outcome.Delivered;
        }
        catch (PushServiceClientException ex) when (ex.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
        {
            // The browser unsubscribed, or its subscription expired: it will never accept another.
            _logger.LogInformation("Web push subscription {SubscriptionId} is gone ({Status}); removed.", row.Id, (int)ex.StatusCode);
            return Outcome.Gone;
        }
        catch (PushServiceClientException ex) when (ex.StatusCode == HttpStatusCode.TooManyRequests || (int)ex.StatusCode >= 500)
        {
            // The service busy or broken says nothing about this browser.
            _logger.LogWarning("The push service answered {Status} for subscription {SubscriptionId}; push not sent.", (int)ex.StatusCode, row.Id);
            return Outcome.Unanswered;
        }
        catch (PushServiceClientException ex)
        {
            // 400/413 (a bad request), 401/403 (a key the subscription was not made with): counted.
            _logger.LogWarning("Web push to subscription {SubscriptionId} was refused ({Status}).", row.Id, (int)ex.StatusCode);
            return Outcome.Refused;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "Could not reach the push service for subscription {SubscriptionId}.", row.Id);
            return Outcome.Unanswered;
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, ct))
        {
            // Polly's: the open breaker refused it unsent, or the pipeline's timeout ran out.
            _logger.LogWarning(ex, OutboundFailure.IsBreakerOpen(ex)
                ? "The push service for subscription {SubscriptionId} is unavailable; push not sent."
                : "The push service for subscription {SubscriptionId} did not answer in time.", row.Id);
            return Outcome.Unanswered;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            // Keys the library cannot use (a malformed row): the same as a refusal, so it is dropped in time.
            _logger.LogWarning(ex, "Web push to subscription {SubscriptionId} could not be sent.", row.Id);
            return Outcome.Refused;
        }
    }
}

/// <summary>What <c>web-site/sw.js</c> reads from a push.</summary>
internal sealed record WebPushPayload(string Title, string Body, string Tag, string Url, string Kind);

/// <summary>Source-generated context — keeps the client trim-safe (trimming is enabled repo-wide).</summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(WebPushPayload))]
internal sealed partial class WebPushJsonContext : JsonSerializerContext;
