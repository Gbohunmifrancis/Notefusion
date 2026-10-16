using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Blog.Drafting;
using NoteFusion.Infrastructure.Http;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Blog;

/// <summary>The Gemini API key (<c>Gemini__ApiKey</c>). Never logged, never returned.</summary>
public sealed class GeminiSettings
{
    public string ApiKey { get; init; } = string.Empty;
    public string BaseUrl { get; init; } = "https://generativelanguage.googleapis.com/v1beta/";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);
}

/// <summary>
/// generateContent over HttpClient, ported from <c>tools/blog/lib/gemini.mjs</c>: the system instruction, the
/// conversation, JSON matching a schema. The key goes in the <c>x-goog-api-key</c> header. A rate limit, a
/// server error or no answer is a Network error (the drafter tries once more); a refused key or unknown model
/// is a plain failure with a hint; a reply cut short (MAX_TOKENS, safety) fails rather than half-writes.
/// </summary>
internal sealed class GeminiClient : IGeminiClient
{
    private readonly HttpClient _http;
    private readonly GeminiSettings _settings;
    private readonly ILogger<GeminiClient> _logger;

    public GeminiClient(HttpClient http, GeminiSettings settings, ILogger<GeminiClient> logger)
    {
        _http = http;
        _settings = settings;
        _logger = logger;
    }

    public bool IsConfigured => _settings.IsConfigured;

    public async Task<Result<GeminiReply>> GenerateAsync(GeminiRequest request, CancellationToken ct)
    {
        if (!IsConfigured)
            return GeminiErrors.NotConfigured;

        var body = new JsonObject
        {
            ["systemInstruction"] = new JsonObject { ["parts"] = new JsonArray(new JsonObject { ["text"] = request.System }) },
            ["contents"] = new JsonArray(request.Contents.Select(t => (JsonNode)new JsonObject
            {
                ["role"] = t.Role,
                ["parts"] = JsonNode.Parse(t.PartsJson),
            }).ToArray()),
            ["generationConfig"] = new JsonObject
            {
                ["responseMimeType"] = "application/json",
                ["responseSchema"] = JsonNode.Parse(request.ResponseSchemaJson),
                ["temperature"] = request.Temperature,
                ["maxOutputTokens"] = request.MaxOutputTokens,
            },
        };

        var url = new Uri(new Uri(_settings.BaseUrl), $"models/{Uri.EscapeDataString(request.Model)}:generateContent");
        using var message = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        message.Headers.Add("x-goog-api-key", _settings.ApiKey);

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(message, ct);
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, ct))
        {
            _logger.LogWarning("Gemini did not answer: {Kind}.", ex.GetType().Name);
            return OutboundFailure.ToError(ex, "GEMINI_UNAVAILABLE", "The Gemini API");
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning("Could not reach the Gemini API: {Message}", ex.Message);
            return Error.Network("GEMINI_UNAVAILABLE", "Could not reach the Gemini API.");
        }

        using (response)
        {
            var text = await response.Content.ReadAsStringAsync(ct);
            JsonNode? json = null;
            try
            {
                json = JsonNode.Parse(text);
            }
            catch (JsonException)
            {
                // Handled below: a non-JSON body is its own error.
            }

            if (!response.IsSuccessStatusCode)
                return Refusal(response.StatusCode, (json as JsonObject)?["error"]?["message"]?.GetValue<string>() ?? response.ReasonPhrase, request.Model);
            if (json is null)
                return Error.Failure("GEMINI_BAD_RESPONSE", "The Gemini API returned a response that is not JSON.");
            return Read(json, request.Model);
        }
    }

    private static Error Refusal(HttpStatusCode status, string? message, string model)
    {
        var code = (int)status;
        var msg = Short(message ?? status.ToString());
        return code switch
        {
            429 => Error.Network("GEMINI_RATE_LIMITED", $"Gemini API error 429: {msg} (rate limit or quota: try again later)"),
            >= 500 => Error.Network("GEMINI_SERVER_ERROR", $"Gemini API error {code}: {msg}"),
            400 or 404 => Error.Failure("GEMINI_ERROR", $"Gemini API error {code}: {msg} (is Gemini__Model \"{model}\" a current model id?)"),
            401 or 403 => Error.Failure("GEMINI_ERROR", $"Gemini API error {code}: {msg} (check the Gemini__ApiKey secret)"),
            _ => Error.Failure("GEMINI_ERROR", $"Gemini API error {code}: {msg}"),
        };
    }

    internal static Result<GeminiReply> Read(JsonNode json, string model)
    {
        if (json["promptFeedback"]?["blockReason"]?.GetValue<string>() is { } blocked)
            return Error.Failure("GEMINI_BLOCKED", $"Gemini blocked the prompt: {blocked}");
        var cand = json["candidates"]?[0];
        if (cand?["content"]?["parts"] is not JsonArray parts)
            return Error.Failure("GEMINI_NO_CANDIDATE", "Gemini returned no candidate.");
        var finish = cand["finishReason"]?.GetValue<string>();
        if (finish is not null && finish != "STOP")
        {
            var hint = finish == "MAX_TOKENS" ? " — raise Gemini__MaxOutputTokens (thinking tokens count against it)" : string.Empty;
            return Error.Failure("GEMINI_STOPPED", $"Gemini stopped early: {finish}{hint}.");
        }

        var answer = string.Concat(parts
            .Where(p => p?["text"] is JsonValue && p["thought"]?.GetValue<bool>() != true)
            .Select(p => p!["text"]!.GetValue<string>()));
        var u = json["usageMetadata"];
        int N(string name) => u?[name] is JsonValue v && v.TryGetValue<int>(out var n) ? n : 0;
        var usage = new GeminiUsage(N("promptTokenCount"), N("candidatesTokenCount"), N("thoughtsTokenCount"),
            N("cachedContentTokenCount"), N("totalTokenCount"));
        var version = json["modelVersion"]?.GetValue<string>() ?? model;
        return new GeminiReply(answer, usage, version, new GeminiTurn("model", parts.ToJsonString()));
    }

    private static string Short(string s) => s.Length > 300 ? s[..300] + "…" : s;
}
