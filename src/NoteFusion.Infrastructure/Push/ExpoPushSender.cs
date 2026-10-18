using System.Net.Http.Headers;
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
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Ttl = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? CategoryId = null)
{
    public static ExpoPushMessage From(string token, PushMessage m) => new(
        token, m.Title, m.Body, m.Data, m.Sound, m.ChannelId,
        // A message with a channel or a time to live is one the caller wants on time: FCM's high priority is
        // what gets it through Android's Doze when it is due rather than at the next maintenance window.
        m.ChannelId is not null || m.TimeToLiveSeconds is not null ? "high" : null,
        m.TimeToLiveSeconds,
        m.CategoryId);
}

/// <summary>
/// One ticket (the send's answer) or one receipt (Google's or Apple's, read later). <see cref="Details"/> is an object
/// whose <c>error</c> names the failure; read loosely, so a field Expo adds cannot make the whole answer unreadable.
/// </summary>
internal sealed record ExpoPushTicket(
    string Status,
    string? Id = null,
    string? Message = null,
    JsonElement? Details = null)
{
    /// <summary>The <c>details.error</c> code (DeviceNotRegistered, InvalidCredentials, …); null when it names none.</summary>
    public string? ErrorCode => Status != "ok"
        && Details is { ValueKind: JsonValueKind.Object } d
        && d.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String
            ? e.GetString()
            : null;
}

internal sealed record ExpoPushResponse(
    IReadOnlyList<ExpoPushTicket>? Data);

internal sealed record ExpoReceiptsRequest(IReadOnlyList<string> Ids);

internal sealed record ExpoReceiptsResponse(
    Dictionary<string, ExpoPushTicket>? Data);

/// <summary><c>Push__ExpoAccessToken</c>: needed only once enhanced push security is on for the Expo project.</summary>
public sealed class ExpoPushSettings
{
    public string? ExpoAccessToken { get; set; }

    internal void Authorize(HttpRequestMessage request)
    {
        if (!string.IsNullOrWhiteSpace(ExpoAccessToken))
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ExpoAccessToken.Trim());
    }
}

/// <summary>
/// Sends notifications through the Expo push service (PRD §push). Delivery is best-effort: individual
/// device failures (e.g. an expired token) are logged, never thrown — a broken device must not take down
/// the job-completion pipeline.
/// </summary>
/// <remarks>
/// Expo taking a push is only half of it: each message it took has a ticket, and Google or Apple answer in the ticket's
/// receipt, which <see cref="PushTicketLog"/> keeps for the receipt worker. A dead phone's token is kept there too and
/// dropped by the worker in a scope of its own, never inside a caller's unit of work.
/// </remarks>
public sealed class ExpoPushSender : IPushSender
{
    private const string ExpoPushUrl = "https://exp.host/--/api/v2/push/send";

    /// <summary>The push API accepts a batch of up to 100 messages per request.</summary>
    internal const int MaxPerRequest = 100;

    private static long _unauthorizedLoggedAtTicks;

    private readonly IDeviceTokenService _deviceTokens;
    private readonly ILogger<ExpoPushSender> _logger;
    private readonly HttpClient _http;
    private readonly PushTicketLog? _tickets;
    private readonly ExpoPushSettings _settings;

    public ExpoPushSender(
        IDeviceTokenService deviceTokens,
        ILogger<ExpoPushSender> logger,
        HttpClient http,
        PushTicketLog? tickets = null,
        ExpoPushSettings? settings = null)
    {
        _deviceTokens = deviceTokens;
        _logger = logger;
        _http = http;
        _tickets = tickets;
        _settings = settings ?? new ExpoPushSettings();
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

    /// <summary>Every token, a request per 100, and what Expo said of them all; never an exception for Expo's failures.</summary>
    private async Task<PushDelivery> DeliverAsync(IReadOnlyList<string> tokens, PushMessage message, CancellationToken ct)
    {
        int accepted = 0, refused = 0;
        string? error = null, code = null;
        var tickets = new List<string>();
        foreach (var batch in tokens.Chunk(MaxPerRequest))
        {
            var sent = await PostAsync(batch, message, ct);
            accepted += sent.Accepted;
            refused += sent.Refused;
            tickets.AddRange(sent.Tickets);
            if (!sent.Delivered)
            {
                error ??= sent.Error;
                code ??= sent.ErrorCode;
            }
            // The open breaker refuses the rest unsent as well; say so rather than count them as tried.
            if (sent.NotAttempted)
                return accepted > 0 ? PushDelivery.Ok(accepted, refused) with { Tickets = tickets } : sent;
        }

        return accepted > 0 || error is null
            ? PushDelivery.Ok(accepted, refused) with { Tickets = tickets }
            : PushDelivery.Failed(error, refused, code);
    }

    /// <summary>One POST of up to 100 messages, and what Expo said of it.</summary>
    private async Task<PushDelivery> PostAsync(string[] tokens, PushMessage message, CancellationToken ct)
    {
        var payload = tokens
            .Select(token => ExpoPushMessage.From(token, message))
            .ToList();

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, ExpoPushUrl)
            {
                Content = JsonContent.Create(payload, ExpoPushJsonContext.Default.ListExpoPushMessage),
            };
            _settings.Authorize(request);
            using var response = await _http.SendAsync(request, ct);

            if (!response.IsSuccessStatusCode)
            {
                var status = (int)response.StatusCode;
                if (status is 401 or 403)
                {
                    // Every push is refused like this until the token is set: an error, so Sentry shows it, once an
                    // hour (the sender is made per request, so the hour is kept across instances).
                    var now = DateTime.UtcNow.Ticks;
                    var last = Interlocked.Read(ref _unauthorizedLoggedAtTicks);
                    var level = now - last >= TimeSpan.TicksPerHour
                                && Interlocked.CompareExchange(ref _unauthorizedLoggedAtTicks, now, last) == last
                        ? LogLevel.Error
                        : LogLevel.Warning;
                    _logger.Log(level,
                        "Expo push returned {StatusCode}: enhanced push security wants an access token (Push__ExpoAccessToken).",
                        status);
                    _tickets?.Record(PushProblems.Unauthorized);
                    return PushDelivery.Failed($"Expo push returned {status}.", tokens.Length, PushProblems.Unauthorized);
                }

                _logger.LogWarning(
                    "Expo push returned {StatusCode} for {Count} device(s).",
                    status,
                    tokens.Length);
                return PushDelivery.Failed($"Expo push returned {status}.");
            }

            var result = await response.Content.ReadFromJsonAsync(
                ExpoPushJsonContext.Default.ExpoPushResponse, ct);

            int accepted = 0, refused = 0;
            string? firstError = null, firstCode = null;
            var tickets = new List<string>();
            foreach (var (ticket, index) in result?.Data?.Select((t, i) => (t, i)) ?? [])
            {
                // Expo answers in the order the messages were sent.
                var token = index < tokens.Length ? tokens[index] : null;
                if (ticket.Status == "ok")
                {
                    accepted++;
                    if (ticket.Id is { Length: > 0 } id)
                    {
                        tickets.Add(id);
                        if (token is not null)
                            _tickets?.Track(id, token);
                    }
                    continue;
                }

                refused++;
                var errorCode = ticket.ErrorCode;
                firstError ??= ticket.Message ?? ticket.Status;
                firstCode ??= errorCode;
                _tickets?.Record(errorCode ?? "error", token);
                _logger.LogWarning(
                    "Expo push refused device {Index}: {Code}",
                    index,
                    errorCode);
            }

            return accepted > 0 || refused == 0
                ? PushDelivery.Ok(accepted, refused) with { Tickets = tickets }
                : PushDelivery.Failed(firstError ?? "Expo refused every device.", refused, firstCode);
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
            // A 2xx means Expo took the messages; only its tickets could not be read.
            _logger.LogWarning(ex, "The Expo push service answered with something other than its tickets.");
            return PushDelivery.Ok(payload.Count);
        }
    }
}

/// <summary>Source-generated context — keeps the client trim-safe (trimming is enabled repo-wide).</summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(List<ExpoPushMessage>))]
[JsonSerializable(typeof(ExpoPushResponse))]
[JsonSerializable(typeof(ExpoReceiptsRequest))]
[JsonSerializable(typeof(ExpoReceiptsResponse))]
internal sealed partial class ExpoPushJsonContext : JsonSerializerContext;
