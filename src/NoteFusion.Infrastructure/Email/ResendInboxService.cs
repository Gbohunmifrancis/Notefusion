using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Email;

// ── Resend wire shapes (internal — never leave this file) ────────────────────────────────────────

internal sealed record ResendInboxListResponse(
    [property: JsonPropertyName("data")] IReadOnlyList<ResendInboxItemWire> Data,
    [property: JsonPropertyName("has_more")] bool HasMore);

internal sealed record ResendInboxItemWire(
    [property: JsonPropertyName("id")]              string Id,
    [property: JsonPropertyName("subject")]         string? Subject,
    [property: JsonPropertyName("from")]            string? From,
    [property: JsonPropertyName("to")]              IReadOnlyList<string>? To,
    [property: JsonPropertyName("created_at")]      string CreatedAt,
    [property: JsonPropertyName("attachments")]     IReadOnlyList<ResendAttachmentSummaryWire>? Attachments);

internal sealed record ResendAttachmentSummaryWire(
    [property: JsonPropertyName("id")]              string Id,
    [property: JsonPropertyName("filename")]        string? Filename,
    [property: JsonPropertyName("content_type")]    string? ContentType);

internal sealed record ResendInboxDetailWire(
    [property: JsonPropertyName("id")]              string Id,
    [property: JsonPropertyName("subject")]         string? Subject,
    [property: JsonPropertyName("from")]            string? From,
    [property: JsonPropertyName("to")]              IReadOnlyList<string>? To,
    [property: JsonPropertyName("created_at")]      string CreatedAt,
    [property: JsonPropertyName("html")]            string? Html,
    [property: JsonPropertyName("text")]            string? Text,
    [property: JsonPropertyName("attachments")]     IReadOnlyList<ResendAttachmentSummaryWire>? Attachments);

internal sealed record ResendAttachmentListResponse(
    [property: JsonPropertyName("data")] IReadOnlyList<ResendAttachmentDetailWire> Data);

internal sealed record ResendAttachmentDetailWire(
    [property: JsonPropertyName("id")]              string Id,
    [property: JsonPropertyName("filename")]        string? Filename,
    [property: JsonPropertyName("content_type")]    string? ContentType,
    [property: JsonPropertyName("size")]            long? Size,
    [property: JsonPropertyName("download_url")]    string? DownloadUrl);

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(ResendInboxListResponse))]
[JsonSerializable(typeof(ResendInboxDetailWire))]
[JsonSerializable(typeof(ResendAttachmentListResponse))]
[JsonSerializable(typeof(ResendAttachmentDetailWire))]
internal sealed partial class ResendInboxJsonContext : JsonSerializerContext;

// ── Service ──────────────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Proxies Resend's inbound-email REST endpoints (https://api.resend.com/emails/receiving).
/// The Resend API key used for sending also covers inbound reads.
/// </summary>
public sealed class ResendInboxService : IResendInboxService
{
    private const string BaseUrl = "https://api.resend.com/emails/receiving";

    private readonly EmailSettings _settings;
    private readonly HttpClient _http;
    private readonly ILogger<ResendInboxService> _logger;

    public ResendInboxService(
        EmailSettings settings,
        HttpClient http,
        ILogger<ResendInboxService> logger)
    {
        _settings = settings;
        _http = http;
        _logger = logger;
    }

    public async Task<ResendInboxPage> ListAsync(int page, int pageSize, CancellationToken ct = default)
    {
        var limit = Math.Clamp(pageSize, 1, 100);
        var targetPage = Math.Max(1, page);
        var url = $"{BaseUrl}?limit={limit}";

        // Resend uses cursor pagination (after=:id). For page > 1, walk forward.
        for (var i = 1; i < targetPage; i++)
        {
            var intermediate = await FetchListAsync(url, ct);
            if (intermediate is null || intermediate.Data.Count == 0 || !intermediate.HasMore)
                return new ResendInboxPage([], false, 0);

            var lastId = intermediate.Data[^1].Id;
            url = $"{BaseUrl}?limit={limit}&after={lastId}";
        }

        var response = await FetchListAsync(url, ct);
        if (response is null) return new ResendInboxPage([], false, 0);

        var items = response.Data.Select(MapSummary).ToList();
        var total = response.HasMore ? targetPage * limit + 1 : (targetPage - 1) * limit + items.Count;
        return new ResendInboxPage(items, response.HasMore, total);
    }

    public async Task<ResendInboxEmail> GetAsync(Guid emailId, CancellationToken ct = default)
    {
        var wire = await FetchDetailAsync($"{BaseUrl}/{emailId}", ct);

        if (wire is null)
            throw new InvalidOperationException($"Received email {emailId} was not found in Resend.");

        return new ResendInboxEmail(
            Id: Guid.Parse(wire.Id),
            Subject: string.IsNullOrWhiteSpace(wire.Subject) ? "(No subject)" : wire.Subject,
            From: wire.From ?? string.Empty,
            To: wire.To is not null && wire.To.Count > 0 ? string.Join(", ", wire.To) : string.Empty,
            ReceivedAt: DateTime.TryParse(wire.CreatedAt, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt)
                ? dt
                : DateTime.UtcNow,
            HtmlBody: wire.Html,
            TextBody: wire.Text,
            HasAttachments: wire.Attachments?.Count > 0);
    }

    public async Task<IReadOnlyList<ResendInboxAttachment>> ListAttachmentsAsync(
        Guid emailId, CancellationToken ct = default)
    {
        var response = await FetchAttachmentsAsync($"{BaseUrl}/{emailId}/attachments", ct);
        if (response is null) return [];
        return response.Data.Select(MapAttachment).ToList();
    }

    public async Task<string> GetAttachmentDownloadUrlAsync(
        Guid emailId, Guid attachmentId, CancellationToken ct = default)
    {
        var response = await FetchAttachmentAsync(
            $"{BaseUrl}/{emailId}/attachments/{attachmentId}", ct);

        return response?.DownloadUrl
            ?? throw new InvalidOperationException(
                $"Download URL unavailable for attachment {attachmentId} on email {emailId}.");
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────

    private async Task<ResendInboxListResponse?> FetchListAsync(string url, CancellationToken ct)
        => await GetAsync(url, ResendInboxJsonContext.Default.ResendInboxListResponse, ct);

    private async Task<ResendInboxDetailWire?> FetchDetailAsync(string url, CancellationToken ct)
        => await GetAsync(url, ResendInboxJsonContext.Default.ResendInboxDetailWire, ct);

    private async Task<ResendAttachmentListResponse?> FetchAttachmentsAsync(string url, CancellationToken ct)
        => await GetAsync(url, ResendInboxJsonContext.Default.ResendAttachmentListResponse, ct);

    private async Task<ResendAttachmentDetailWire?> FetchAttachmentAsync(string url, CancellationToken ct)
        => await GetAsync(url, ResendInboxJsonContext.Default.ResendAttachmentDetailWire, ct);

    private async Task<T?> GetAsync<T>(
        string url,
        System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo,
        CancellationToken ct)
        where T : class
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _settings.ApiKey);

        using var resp = await _http.SendAsync(req, ct);

        if (!resp.IsSuccessStatusCode)
        {
            var body = await SafeReadAsync(resp, ct);
            _logger.LogWarning(
                "Resend inbox returned {StatusCode} for {Url}: {Body}",
                (int)resp.StatusCode, url, body);
            return null;
        }

        return await resp.Content.ReadFromJsonAsync(typeInfo, ct);
    }

    private static ResendInboxEmailSummary MapSummary(ResendInboxItemWire w) =>
        new(
            Id: Guid.Parse(w.Id),
            Subject: string.IsNullOrWhiteSpace(w.Subject) ? "(No subject)" : w.Subject,
            From: w.From ?? string.Empty,
            To: w.To is not null && w.To.Count > 0 ? string.Join(", ", w.To) : string.Empty,
            ReceivedAt: DateTime.TryParse(w.CreatedAt, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt)
                ? dt
                : DateTime.UtcNow,
            HasAttachments: w.Attachments?.Count > 0);

    private static ResendInboxAttachment MapAttachment(ResendAttachmentDetailWire w) =>
        new(
            Id: Guid.Parse(w.Id),
            Filename: w.Filename ?? "attachment",
            ContentType: w.ContentType ?? "application/octet-stream",
            SizeBytes: w.Size ?? 0,
            DownloadUrl: w.DownloadUrl ?? string.Empty);

    private static async Task<string> SafeReadAsync(HttpResponseMessage resp, CancellationToken ct)
    {
        try
        {
            var body = await resp.Content.ReadAsStringAsync(ct);
            return body.Length > 400 ? body[..400] : body;
        }
        catch
        {
            return "(body unavailable)";
        }
    }
}
