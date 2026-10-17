using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure.Http;

namespace NoteFusion.Infrastructure.Push;

/// <summary>
/// Expo push API wire contract (https://docs.expo.dev/push-notifications/sending-notifications/).
/// Kept private so the HTTP shape can evolve with Expo without leaking into Application DTOs.
/// </summary>
internal sealed record ExpoPushMessage(
    string To,
    string Title,
    string Body,
    [property: JsonPropertyName("data")] IReadOnlyDictionary<string, string>? Data = null,
    // Left out when null, so a message that sets none of them reads to Expo exactly as before.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Sound = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ChannelId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Priority = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Ttl = null)
{
    public static ExpoPushMessage From(string token, PushMessage m) => new(
        token, m.Title, m.Body, m.Data, m.Sound, m.ChannelId,
        // A message with a channel or a time to live is one the caller wants on time: FCM's high priority is
        // what gets it through Android's Doze when it is due rather than at the next maintenance window.
        m.ChannelId is not null || m.TimeToLiveSeconds is not null ? "high" : null,
        m.TimeToLiveSeconds);
}

internal sealed record ExpoPushReceipt(
    string Status,
    string? Message,
    string? Details);

internal sealed record ExpoPushResponse(
    IReadOnlyList<ExpoPushReceipt> Data);

/// <summary>
/// Sends notifications through the Expo push service (PRD §push). Delivery is best-effort: individual
/// device failures (e.g. an expired token) are logged, never thrown — a broken device must not take down
/// the job-completion pipeline.
/// </summary>
public sealed class ExpoPushSender : IPushSender
{
    private const string ExpoPushUrl = "https://exp.host/--/api/v2/push/send";

    private readonly IDeviceTokenService _deviceTokens;
    private readonly ILogger<ExpoPushSender> _logger;
    private readonly HttpClient _http;

    public ExpoPushSender(
        IDeviceTokenService deviceTokens,
        ILogger<ExpoPushSender> logger,
        HttpClient http)
    {
        _deviceTokens = deviceTokens;
        _logger = logger;
        _http = http;
    }

    public async Task SendAsync(
        IReadOnlyList<Guid> recipientUserIds, PushMessage message, CancellationToken ct = default)
    {
        var tokens = await _deviceTokens.ResolveTokensAsync(recipientUserIds, ct);
        if (tokens.Count == 0)
            return; // no registered devices — nothing to deliver

        await DeliverAsync(tokens, message, ct);
    }

    public Task<PushDelivery> SendToDevicesAsync(
        IReadOnlyList<string> tokens, PushMessage message, CancellationToken ct = default)
        => tokens.Count == 0
            ? Task.FromResult(PushDelivery.Failed("No devices to send to."))
            : DeliverAsync(tokens, message, ct);

    /// <summary>One POST of up to 100 messages, and what Expo said of it; never an exception for Expo's failures.</summary>
    private async Task<PushDelivery> DeliverAsync(IReadOnlyList<string> tokens, PushMessage message, CancellationToken ct)
    {
        // The push API accepts a batch of up to 100 messages per request.
        var payload = tokens
            .Take(100)
            .Select(token => ExpoPushMessage.From(token, message))
            .ToList();

        try
        {
            using var response = await _http.PostAsJsonAsync(
                ExpoPushUrl,
                payload,
                ExpoPushJsonContext.Default.ListExpoPushMessage,
                ct);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Expo push returned {StatusCode} for {Count} device(s).",
                    (int)response.StatusCode,
                    tokens.Count);
                return PushDelivery.Failed($"Expo push returned {(int)response.StatusCode}.");
            }

            var result = await response.Content.ReadFromJsonAsync(
                ExpoPushJsonContext.Default.ExpoPushResponse, ct);

            int accepted = 0, refused = 0;
            string? firstError = null;
            foreach (var (receipt, index) in result?.Data.Select((r, i) => (r, i)) ?? [])
            {
                if (receipt.Status == "ok")
                {
                    accepted++;
                    continue;
                }

                refused++;
                firstError ??= receipt.Message ?? receipt.Status;
                _logger.LogWarning(
                    "Expo push failed for device {Index}: {Status} {Message}",
                    index,
                    receipt.Status,
                    receipt.Message);
            }

            return accepted > 0 || refused == 0
                ? PushDelivery.Ok(accepted, refused)
                : PushDelivery.Failed(firstError ?? "Expo refused every device.", refused);
        }
        catch (HttpRequestException ex)
        {
            // Network is expected to be flaky; the job-completion pipeline must survive it.
            _logger.LogWarning(ex, "Could not reach the Expo push service.");
            return PushDelivery.Failed("Could not reach the Expo push service.");
        }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
        {
            // The client's timeout, not the caller cancelling: a slow Expo is as survivable as an absent one.
            _logger.LogWarning(ex, "The Expo push service did not answer in time.");
            return PushDelivery.Failed("The Expo push service did not answer in time.");
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, ct))
        {
            // Polly's: the open breaker refused it unsent, or the pipeline's timeout ran out.
            var open = OutboundFailure.IsBreakerOpen(ex);
            _logger.LogWarning(ex, open
                ? "The Expo push service is unavailable; push not sent."
                : "The Expo push service did not answer in time.");
            return open
                ? PushDelivery.Unavailable("The Expo push service is unavailable; not sent.")
                : PushDelivery.Failed("The Expo push service did not answer in time.");
        }
        catch (JsonException ex)
        {
            // A 2xx means Expo took the messages; only its receipts could not be read.
            _logger.LogWarning(ex, "The Expo push service answered with something other than its receipts.");
            return PushDelivery.Ok(payload.Count);
        }
    }
}

/// <summary>Source-generated context — keeps the client trim-safe (trimming is enabled repo-wide).</summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(List<ExpoPushMessage>))]
[JsonSerializable(typeof(ExpoPushResponse))]
internal sealed partial class ExpoPushJsonContext : JsonSerializerContext;
