using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using NoteFusion.Infrastructure.Http;

namespace NoteFusion.Infrastructure.Email;

/// <summary>
/// Resend's send-email contract (https://resend.com/docs/api-reference/emails/send-email). Private to
/// the transport so the wire shape can follow Resend without leaking into the app's own types.
/// </summary>
internal sealed record ResendRequest(
    string From,
    IReadOnlyList<string> To,
    string Subject,
    string Html,
    string Text,
    [property: JsonPropertyName("reply_to")] string? ReplyTo,
    IReadOnlyDictionary<string, string>? Headers = null);

internal sealed record ResendResponse(string? Id);

/// <summary>
/// Sends through Resend. One HTTP POST per message — no batching, because these are transactional
/// emails triggered one account event at a time.
/// </summary>
public sealed class ResendEmailTransport : IEmailTransport
{
    private const string SendUrl = "https://api.resend.com/emails";
    internal const string IdempotencyKeyHeader = "Idempotency-Key";

    private readonly EmailSettings _settings;
    private readonly ILogger<ResendEmailTransport> _logger;
    private readonly HttpClient _http;

    public ResendEmailTransport(
        EmailSettings settings, ILogger<ResendEmailTransport> logger, HttpClient http)
    {
        _settings = settings;
        _logger = logger;
        _http = http;
    }

    public async Task SendAsync(EmailMessage message, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_settings.ApiKey))
        {
            // Misconfiguration, not a transient fault: warn once per send and skip. Throwing would
            // turn every registration into a 500 on an environment that is otherwise working.
            _logger.LogWarning(
                "Email:UseResend is on but Email:ApiKey is empty — dropping \"{Subject}\".", message.Subject);
            return;
        }

        var payload = new ResendRequest(
            From: FormatFrom(message),
            To: [FormatTo(message)],
            Subject: message.Subject,
            Html: message.HtmlBody,
            Text: message.TextBody,
            ReplyTo: message.ReplyTo ?? _settings.ReplyTo,
            Headers: message.Headers);

        using var request = new HttpRequestMessage(HttpMethod.Post, SendUrl)
        {
            Content = JsonContent.Create(payload, ResendJsonContext.Default.ResendRequest)
        };
        // Set per-request rather than on the client so a rotated key takes effect on the next send
        // instead of on the next restart.
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _settings.ApiKey);
        // One key per message, so the pipeline may repeat the POST after a timeout or a 5xx: Resend answers a
        // repeat of a key it has seen (for 24 hours) with the first send's result instead of mailing twice.
        request.Headers.Add(IdempotencyKeyHeader, Guid.NewGuid().ToString("N"));

        HttpResponseMessage sent;
        try
        {
            sent = await _http.SendAsync(request, ct);
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, ct))
        {
            // Refused by the open breaker, or out of time: the same failure as any other undelivered message.
            // Refused before anything went out is marked, so a batch can keep the item for a later run; once
            // an attempt has left it may have landed, so it is an ordinary failure.
            var unavailable = OutboundFailure.NothingSent(ex, request);
            throw new EmailDeliveryException(
                unavailable
                    ? $"Resend is unavailable; \"{message.Subject}\" was not sent."
                    : $"Resend did not answer in time for \"{message.Subject}\".",
                ex)
            {
                ProviderUnavailable = unavailable,
            };
        }

        using var response = sent;

        if (!response.IsSuccessStatusCode)
        {
            // Resend explains rejections in the body (unverified domain, invalid address, rate limit),
            // and the status alone is rarely enough to act on. Capped because it is provider-controlled.
            var body = await SafeReadAsync(response, ct);
            throw new EmailDeliveryException(
                $"Resend returned {(int)response.StatusCode} ({response.StatusCode}) for \"{message.Subject}\". {body}");
        }

        var result = await response.Content.ReadFromJsonAsync(ResendJsonContext.Default.ResendResponse, ct);
        _logger.LogInformation(
            "Sent \"{Subject}\" to {Recipient} via Resend (id {MessageId}).",
            message.Subject, message.ToEmail, result?.Id ?? "unknown");
    }

    /// <summary>RFC 5322 display-name form, so inboxes show "NoteFusion", not the raw address.</summary>
    private string FormatFrom(EmailMessage message)
    {
        var name = string.IsNullOrWhiteSpace(message.FromName) ? _settings.FromName : message.FromName;
        return string.IsNullOrWhiteSpace(name)
            ? _settings.FromAddress
            : $"{Quote(name)} <{_settings.FromAddress}>";
    }

    private static string FormatTo(EmailMessage message)
        => string.IsNullOrWhiteSpace(message.ToName)
            ? message.ToEmail
            : $"{Quote(message.ToName!)} <{message.ToEmail}>";

    /// <summary>
    /// A display name containing a quote, backslash, comma or angle bracket would otherwise change how
    /// the header parses — and a name comes from a sign-up form.
    /// </summary>
    private static string Quote(string name)
        => $"\"{name.Replace("\\", "\\\\").Replace("\"", "\\\"")}\"";

    private static async Task<string> SafeReadAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            return body.Length > 400 ? body[..400] : body;
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException or TaskCanceledException)
        {
            return "(response body unavailable)";
        }
    }
}

/// <summary>Raised when a provider rejects a message; the caller decides whether that matters.</summary>
public sealed class EmailDeliveryException : Exception
{
    public EmailDeliveryException(string message) : base(message) { }
    public EmailDeliveryException(string message, Exception inner) : base(message, inner) { }

    /// <summary>The provider's breaker was open, so the message was never handed over.</summary>
    public bool ProviderUnavailable { get; init; }
}

/// <summary>Source-generated context — keeps the client trim-safe (trimming is enabled repo-wide).</summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(ResendRequest))]
[JsonSerializable(typeof(ResendResponse))]
internal sealed partial class ResendJsonContext : JsonSerializerContext;
