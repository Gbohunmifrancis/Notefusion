using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Blog.Drafting;

/// <summary>One turn of the conversation: its role ("user" or "model") and its parts as raw JSON, sent back exactly.</summary>
public sealed record GeminiTurn(string Role, string PartsJson)
{
    public static GeminiTurn User(string text)
        => new("user", System.Text.Json.JsonSerializer.Serialize(new[] { new { text } }));
}

/// <summary>A generateContent call asking for JSON that matches a schema.</summary>
public sealed record GeminiRequest(
    string Model,
    string System,
    IReadOnlyList<GeminiTurn> Contents,
    string ResponseSchemaJson,
    double Temperature,
    int MaxOutputTokens);

/// <summary>The call's token counts (<c>usageMetadata</c>).</summary>
public sealed record GeminiUsage(int Prompt, int Output, int Thinking, int Cached, int Total);

/// <summary>
/// The model's answer: its JSON text (thought parts left out), the tokens, the model version that answered,
/// and its turn exactly as returned, to append when asking for a revision.
/// </summary>
public sealed record GeminiReply(string Json, GeminiUsage Usage, string ModelVersion, GeminiTurn ModelTurn);

/// <summary>
/// The Gemini API's generateContent (Infrastructure: <c>GeminiClient</c>, through OutboundResilience). Failures
/// are plain sentences for the admin console; a rate limit, a server error or no answer is a Network error
/// (worth one more try), an open breaker is <see cref="Common.Errors.ProviderErrors.Unavailable"/>.
/// </summary>
public interface IGeminiClient
{
    /// <summary>False when <c>Gemini__ApiKey</c> is not set: nothing can be drafted.</summary>
    bool IsConfigured { get; }

    Task<Result<GeminiReply>> GenerateAsync(GeminiRequest request, CancellationToken ct);
}

public static class GeminiErrors
{
    public static readonly Error NotConfigured = Error.Failure(
        "GEMINI_NOT_CONFIGURED", "Drafting is off: set Gemini__ApiKey on the API (see docs/BLOG.md).");
}
