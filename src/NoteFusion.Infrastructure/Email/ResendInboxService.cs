using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Email;

// ── Resend wire shapes (internal — never leave this file) ────────────────────────────────────────

internal sealed record ResendInboxListResponse(
    [property: JsonPropertyName("data")] IReadOnlyList<ResendInboxItemWire> Data,
    [property: JsonPropertyName("total")] int Total);

internal sealed record ResendInboxItemWire(
    [property: JsonPropertyName("id")]              string Id,
    [property: JsonPropertyName("subject")]         string Subject,
    [property: JsonPropertyName("from")]            string From,
    [property: JsonPropertyName("to")]              string To,
    [property: JsonPropertyName("created_at")]      string CreatedAt,
    [property: JsonPropertyName("attachments")]     IReadOnlyList<ResendAttachmentWire>? Attachments);

internal sealed record ResendInboxDetailWire(
    [property: JsonPropertyName("id")]              string Id,
    [property: JsonPropertyName("subject")]         string Subject,
    [property: JsonPropertyName("from")]            string From,
    [property: JsonPropertyName("to")]              string To,
    [property: JsonPropertyName("created_at")]      string CreatedAt,
    [property: JsonPropertyName("html")]            string? Html,
    [property: JsonPropertyName("text")]            string? Text,
    [property: JsonPropertyName("attachments")]     IReadOnlyList<ResendAttachmentWire>? Attachments);

internal sealed record ResendAttachmentListResponse(
    [property: JsonPropertyName("data")] IReadOnlyList<ResendAttachmentWire> Data);

internal sealed record ResendAttachmentWire(
    [property: JsonPropertyName("id")]          string Id,
    [property: JsonPropertyName("filename")]    string Filename,
    [property: JsonPropertyName("content_type")] string ContentType,
    [property: JsonPropertyName("size")]        long Size,
    [property: JsonPropertyName("url")]         string? Url);

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(ResendInboxListResponse))]
[JsonSerializable(typeof(ResendInboxDetailWire))]
[JsonSerializable(typeof(ResendAttachmentListResponse))]
[JsonSerializable(typeof(ResendAttachmentWire))]
internal sealed partial class ResendInboxJsonContext : JsonSerializerContext;

// ── Service ──────────────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Proxies Resend's inbound-email REST endpoints.
/// The Resend API key used for sending also covers inbound reads, so no extra credential is needed.
/// </summary>
public sealed class ResendInboxService : IResendInboxService
{
    private const string BaseUrl = "https://api.resend.com";

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
        // Resend's API uses offset/limit, not page numbers.
        var offset = (Math.Max(1, page) - 1) * pageSize;
        var limit = Math.Clamp(pageSize, 1, 100);

        var response = await FetchListAsync(
            $"{BaseUrl}/received-emails?limit={limit}&offset={offset}", ct);

        if (response is null) return new ResendInboxPage([], 0);

        var items = response.Data.Select(MapSummary).ToList();
        return new ResendInboxPage(items, response.Total);
    }

    public async Task<ResendInboxEmail> GetAsync(Guid emailId, CancellationToken ct = default)
    {
        var wire = await FetchDetailAsync($"{BaseUrl}/received-emails/{emailId}", ct);

        if (wire is null)
            throw new InvalidOperationException($"Received email {emailId} was not found in Resend.");

        return new ResendInboxEmail(
            Id: Guid.Parse(wire.Id),
            Subject: wire.Subject,
            From: wire.From,
            To: wire.To,
            ReceivedAt: DateTime.Parse(wire.CreatedAt, null, System.Globalization.DateTimeStyles.RoundtripKind),
            HtmlBody: wire.Html,
            TextBody: wire.Text,
            HasAttachments: wire.Attachments?.Count > 0);
    }

    public async Task<IReadOnlyList<ResendInboxAttachment>> ListAttachmentsAsync(
        Guid emailId, CancellationToken ct = default)
    {
        var response = await FetchAttachmentsAsync(
            $"{BaseUrl}/received-emails/{emailId}/attachments", ct);

        if (response is null) return [];
        return response.Data.Select(MapAttachment).ToList();
    }

    public async Task<string> GetAttachmentDownloadUrlAsync(
        Guid emailId, Guid attachmentId, CancellationToken ct = default)
    {
        var response = await FetchAttachmentAsync(
            $"{BaseUrl}/received-emails/{emailId}/attachments/{attachmentId}", ct);

        return response?.Url
            ?? throw new InvalidOperationException(
                $"Download URL unavailable for attachment {attachmentId} on email {emailId}.");
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────

    private async Task<ResendInboxListResponse?> FetchListAsync(string url, CancellationToken ct)
        => await GetAsync<ResendInboxListResponse>(url, ResendInboxJsonContext.Default.ResendInboxListResponse, ct);

    private async Task<ResendInboxDetailWire?> FetchDetailAsync(string url, CancellationToken ct)
        => await GetAsync<ResendInboxDetailWire>(url, ResendInboxJsonContext.Default.ResendInboxDetailWire, ct);

    private async Task<ResendAttachmentListResponse?> FetchAttachmentsAsync(string url, CancellationToken ct)
        => await GetAsync<ResendAttachmentListResponse>(url, ResendInboxJsonContext.Default.ResendAttachmentListResponse, ct);

    private async Task<ResendAttachmentWire?> FetchAttachmentAsync(string url, CancellationToken ct)
        => await GetAsync<ResendAttachmentWire>(url, ResendInboxJsonContext.Default.ResendAttachmentWire, ct);

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
            Subject: w.Subject,
            From: w.From,
            To: w.To,
            ReceivedAt: DateTime.Parse(w.CreatedAt, null, System.Globalization.DateTimeStyles.RoundtripKind),
            HasAttachments: w.Attachments?.Count > 0);

    private static ResendInboxAttachment MapAttachment(ResendAttachmentWire w) =>
        new(
            Id: Guid.Parse(w.Id),
            Filename: w.Filename,
            ContentType: w.ContentType,
            SizeBytes: w.Size,
            DownloadUrl: w.Url ?? string.Empty);

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
