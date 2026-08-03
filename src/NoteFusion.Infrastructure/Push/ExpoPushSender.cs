using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Push;

/// <summary>
/// Expo push API wire contract (https://docs.expo.dev/push-notifications/sending-notifications/).
/// Kept private so the HTTP shape can evolve with Expo without leaking into Application DTOs.
/// </summary>
internal sealed record ExpoPushMessage(
    string To,
    string Title,
    string Body,
    [property: JsonPropertyName("data")] IReadOnlyDictionary<string, string>? Data = null);

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

        // The push API accepts a batch of up to 100 messages per request.
        var payload = tokens
            .Take(100)
            .Select(token => new ExpoPushMessage(token, message.Title, message.Body, message.Data))
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
                return;
            }

            var result = await response.Content.ReadFromJsonAsync(
                ExpoPushJsonContext.Default.ExpoPushResponse, ct);

            foreach (var (receipt, index) in result?.Data.Select((r, i) => (r, i)) ?? [])
            {
                if (receipt.Status == "ok") continue;

                _logger.LogWarning(
                    "Expo push failed for device {Index}: {Status} {Message}",
                    index,
                    receipt.Status,
                    receipt.Message);
            }
        }
        catch (HttpRequestException ex)
        {
            // Network is expected to be flaky; the job-completion pipeline must survive it.
            _logger.LogWarning(ex, "Could not reach the Expo push service.");
        }
    }
}

/// <summary>Source-generated context — keeps the client trim-safe (trimming is enabled repo-wide).</summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(List<ExpoPushMessage>))]
[JsonSerializable(typeof(ExpoPushResponse))]
internal sealed partial class ExpoPushJsonContext : JsonSerializerContext;
