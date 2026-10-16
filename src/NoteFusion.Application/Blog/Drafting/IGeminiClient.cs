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
/// Why a call failed, with what the drafter needs to decide what to do next: the HTTP status (null for no
/// answer at all, or a 200 whose content was refused), how long the API asked us to wait, and whether our own
/// circuit breaker refused the call unsent.
/// </summary>
public sealed record GeminiFailure(Error Error, int? Status = null, TimeSpan? RetryAfter = null, bool BreakerOpen = false)
{
    /// <summary>Worth trying again after a pause: a rate limit, a server error ("high demand" 503s), or no answer.</summary>
    public bool Retryable => !BreakerOpen && (Status is null ? Error.Type == ErrorType.Network : Status == 429 || Status >= 500);

    /// <summary>
    /// Worth trying another model for once the retries are spent: still overloaded or rate-limited, or a model id
    /// that is gone (404). A refused key (401/403), a bad request, a blocked prompt or no answer at all never is.
    /// </summary>
    public bool ModelUnavailable => !BreakerOpen && Status is 429 or 404 or >= 500;
}

/// <summary>A reply, or why there is none.</summary>
public sealed record GeminiResponse(GeminiReply? Reply, GeminiFailure? Failure)
{
    public static GeminiResponse Ok(GeminiReply reply) => new(reply, null);
    public static GeminiResponse Fail(GeminiFailure failure) => new(null, failure);
    public static GeminiResponse Fail(Error error, int? status = null, TimeSpan? retryAfter = null) => new(null, new GeminiFailure(error, status, retryAfter));
}

/// <summary>
/// The Gemini API's generateContent (Infrastructure: <c>GeminiClient</c>, through OutboundResilience). One call,
/// one answer: the retries, the pauses and the fallback models are the drafter's (<see cref="BlogDraftWriter"/>).
/// </summary>
public interface IGeminiClient
{
    /// <summary>False when <c>Gemini__ApiKey</c> is not set: nothing can be drafted.</summary>
    bool IsConfigured { get; }

    Task<GeminiResponse> GenerateAsync(GeminiRequest request, CancellationToken ct);
}

public static class GeminiErrors
{
    public static readonly Error NotConfigured = Error.Failure(
        "GEMINI_NOT_CONFIGURED", "Drafting is off: set Gemini__ApiKey on the API (see docs/BLOG.md).");

    /// <summary>Our own breaker is refusing calls after repeated failures; the batch stops rather than spin.</summary>
    public static readonly Error BreakerOpen = Error.Network(
        "GEMINI_UNAVAILABLE",
        "Gemini has failed repeatedly in the last few minutes, so the API has stopped calling it for a short while. The batch stopped here; try again in a few minutes.");
}
