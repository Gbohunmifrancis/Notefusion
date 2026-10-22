using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure.Http;

namespace NoteFusion.Infrastructure.Email;

// ── Resend wire shapes (internal — never leave this file) ────────────────────────────────────────

internal sealed record ResendSentListResponse(
    [property: JsonPropertyName("data")] IReadOnlyList<ResendSentItemWire> Data,
    [property: JsonPropertyName("has_more")] bool HasMore);

internal sealed record ResendSentItemWire(
    [property: JsonPropertyName("id")]         string Id,
    [property: JsonPropertyName("subject")]    string? Subject,
    [property: JsonPropertyName("from")]       string? From,
    [property: JsonPropertyName("to")]         IReadOnlyList<string>? To,
    [property: JsonPropertyName("created_at")] string? CreatedAt,
    [property: JsonPropertyName("last_event")] string? LastEvent,
    [property: JsonPropertyName("html")]       string? Html = null,
    [property: JsonPropertyName("text")]       string? Text = null);

[JsonSerializable(typeof(ResendSentListResponse))]
[JsonSerializable(typeof(ResendSentItemWire))]
internal sealed partial class ResendSentJsonContext : JsonSerializerContext;

// ── Service ──────────────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Reads Resend's log of the email this account sent (https://api.resend.com/emails), for the console's Sent mail.
/// The key that sends reads it too, as it reads the inbound mail (<see cref="ResendInboxService"/>).
/// </summary>
public sealed class ResendSentMailService : ISentMailService
{
    private const string BaseUrl = "https://api.resend.com/emails";

    private readonly EmailSettings _settings;
    private readonly HttpClient _http;
    private readonly ILogger<ResendSentMailService> _logger;

    public ResendSentMailService(EmailSettings settings, HttpClient http, ILogger<ResendSentMailService> logger)
    {
        _settings = settings;
        _http = http;
        _logger = logger;
    }

    public async Task<SentMailPage?> ListAsync(int page, int pageSize, CancellationToken ct = default)
    {
        var limit = Math.Clamp(pageSize, 1, 100);
        var targetPage = Math.Max(1, page);
        var url = $"{BaseUrl}?limit={limit}";

        // Resend pages by cursor (after=:id): a later page walks forward from the first.
        for (var i = 1; i < targetPage; i++)
        {
            var walked = await GetAsync(url, ResendSentJsonContext.Default.ResendSentListResponse, ct);
            if (walked is null)
                return null;
            if (walked.Data.Count == 0 || !walked.HasMore)
                return new SentMailPage([], false, (i - 1) * limit + walked.Data.Count);
            url = $"{BaseUrl}?limit={limit}&after={Uri.EscapeDataString(walked.Data[^1].Id)}";
        }

        var response = await GetAsync(url, ResendSentJsonContext.Default.ResendSentListResponse, ct);
        if (response is null)
            return null;

        var items = response.Data
            .Where(w => Guid.TryParse(w.Id, out _))
            .Select(w => new SentMailSummary(Guid.Parse(w.Id), SubjectOf(w), w.From ?? string.Empty, ToOf(w), At(w.CreatedAt), w.LastEvent))
            .ToList();
        var total = response.HasMore ? targetPage * limit + 1 : (targetPage - 1) * limit + items.Count;
        return new SentMailPage(items, response.HasMore, total);
    }

    public async Task<SentMail?> GetAsync(Guid emailId, CancellationToken ct = default)
    {
        var w = await GetAsync($"{BaseUrl}/{emailId}", ResendSentJsonContext.Default.ResendSentItemWire, ct);
        if (w is null || !Guid.TryParse(w.Id, out var id))
            return null;
        return new SentMail(id, SubjectOf(w), w.From ?? string.Empty, ToOf(w), At(w.CreatedAt), w.LastEvent, w.Html, w.Text);
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────

    private static string SubjectOf(ResendSentItemWire w) => string.IsNullOrWhiteSpace(w.Subject) ? "(No subject)" : w.Subject;

    private static string ToOf(ResendSentItemWire w) => w.To is { Count: > 0 } ? string.Join(", ", w.To) : string.Empty;

    /// <summary>Resend writes Postgres's form ("2026-04-03 22:13:42.674981+00"), which .NET reads once the offset has minutes.</summary>
    internal static DateTime At(string? createdAt)
    {
        if (string.IsNullOrWhiteSpace(createdAt))
            return DateTime.UnixEpoch;
        var text = createdAt.Trim();
        if (System.Text.RegularExpressions.Regex.IsMatch(text, @"[+-]\d{2}$"))
            text += ":00";
        return DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var at)
            ? at.UtcDateTime
            : DateTime.UnixEpoch;
    }

    private async Task<T?> GetAsync<T>(
        string url, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo, CancellationToken ct)
        where T : class
    {
        if (string.IsNullOrWhiteSpace(_settings.ApiKey))
            return null;

        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _settings.ApiKey);

        try
        {
            using var resp = await _http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                // Only the status: the body of a refused read can echo the address or the subject asked for.
                _logger.LogWarning("Resend sent mail returned {StatusCode} for {Path}.", (int)resp.StatusCode, new Uri(url).AbsolutePath);
                return null;
            }
            return await resp.Content.ReadFromJsonAsync(typeInfo, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or System.Text.Json.JsonException || OutboundFailure.IsUnanswered(ex, ct))
        {
            _logger.LogWarning(ex, "Resend sent mail could not be read.");
            return null;
        }
    }
}
