using System.Text.Json;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Blog.Drafting;

/// <summary>The model's post, as the schema asks for it (fields it left out are empty, and fail the checks).</summary>
public sealed record DraftFields(string Title, string Description, string Slug, IReadOnlyList<string> Tags, IReadOnlyList<BlogFaqItem> Faq, string Body)
{
    public static DraftFields Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        string Str(JsonElement e, string name)
            => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()!.Trim() : string.Empty;
        IEnumerable<JsonElement> Arr(string name)
            => root.ValueKind == JsonValueKind.Object && root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array ? v.EnumerateArray() : [];
        return new DraftFields(
            Str(root, "title"),
            Str(root, "description"),
            Str(root, "slug"),
            Arr("tags").Where(t => t.ValueKind == JsonValueKind.String).Select(t => t.GetString()!.Trim().ToLowerInvariant()).ToList(),
            Arr("faq").Select(f => new BlogFaqItem(Str(f, "question"), Str(f, "answer"))).ToList(),
            Str(root, "body"));
    }
}

/// <summary>How one draft came out: the post's fields (null when no answer came), what still fails, the calls' tokens.</summary>
public sealed record DraftOutcome(DraftFields? Draft, IReadOnlyList<string> Problems, IReadOnlyList<BlogTokenUsage> Usage, string Model, Error? Error);

/// <summary>
/// Drafts one post, as <c>tools/blog/draft.mjs</c> did: the system instruction and the topic's prompt, the model's
/// JSON, the checks, and — if anything fails — one revision with the list of problems. A rate limit, a server
/// error or no answer is tried once more after a pause (the call has no side effects, only a cost).
/// </summary>
public sealed class BlogDraftWriter
{
    private readonly IGeminiClient _gemini;
    private readonly BlogSettings _settings;
    private readonly ILogger<BlogDraftWriter> _logger;

    public BlogDraftWriter(IGeminiClient gemini, BlogSettings settings, ILogger<BlogDraftWriter> logger)
    {
        _gemini = gemini;
        _settings = settings;
        _logger = logger;
    }

    public async Task<DraftOutcome> WriteAsync(
        DraftTopic topic, BlogCatalogue catalogue, IReadOnlyList<LivePost> livePosts, ISet<string> takenSlugs, CancellationToken ct)
    {
        // A required link to a page that is not on the site yet (an earlier topic still a draft) is left out for now.
        var baseCtx = new BlogCheckContext(catalogue, livePosts, []);
        var required = topic.Links.Where(baseCtx.LinkExists).ToList();
        var ctx = baseCtx with { RequiredLinks = required };
        var tags = livePosts.SelectMany(p => p.Tags).Distinct().Order(StringComparer.Ordinal).ToList();
        var user = BlogPrompt.User(topic with { Links = required }, livePosts, catalogue, tags);

        var contents = new List<GeminiTurn> { GeminiTurn.User(user) };
        var usage = new List<BlogTokenUsage>();
        var model = _settings.GeminiModel;

        var first = await CallAsync(contents, "Draft", usage, ct);
        if (first.IsFailure)
            return new DraftOutcome(null, [], usage, model, first.Error);
        model = first.Value.ModelVersion;
        var (draft, problems) = Assess(first.Value, topic, ctx, takenSlugs);

        if (problems.Count > 0)
        {
            _logger.LogInformation("Blog draft {Slug} needs fixing ({Count} problems); asking for one revision.", topic.Slug, problems.Count);
            contents.Add(first.Value.ModelTurn);
            contents.Add(GeminiTurn.User(BlogPrompt.Revision(problems)));
            var second = await CallAsync(contents, "Revision", usage, ct);
            if (second.IsFailure)
                return new DraftOutcome(draft, problems, usage, model, second.Error);
            (draft, problems) = Assess(second.Value, topic, ctx, takenSlugs);
        }

        return new DraftOutcome(draft, problems, usage, model, null);
    }

    private (DraftFields? Draft, IReadOnlyList<string> Problems) Assess(
        GeminiReply reply, DraftTopic topic, BlogCheckContext ctx, ISet<string> takenSlugs)
    {
        DraftFields draft;
        try
        {
            draft = DraftFields.Parse(reply.Json);
        }
        catch (JsonException ex)
        {
            return (null, [$"The answer is not the JSON that was asked for ({ex.Message})."]);
        }
        // The topic's slug is the URL, whatever the model suggests.
        var input = new BlogCheckInput(topic.Slug, draft.Title, draft.Description, null, draft.Tags, draft.Faq, draft.Body,
            BlogPost.DefaultAuthor, null, null, null, null);
        return (draft, BlogChecks.CheckDraft(input, ctx, takenSlugs));
    }

    private async Task<Result<GeminiReply>> CallAsync(List<GeminiTurn> contents, string label, List<BlogTokenUsage> usage, CancellationToken ct)
    {
        var request = new GeminiRequest(_settings.GeminiModel, BlogPrompt.System, contents.ToList(), BlogPrompt.DraftSchemaJson,
            _settings.GeminiTemperature, _settings.GeminiMaxOutputTokens);
        var result = await _gemini.GenerateAsync(request, ct);
        if (result.IsFailure && result.Error.Type == Shared.Results.ErrorType.Network && !ProviderErrors.IsUnavailable(result.Error))
        {
            _logger.LogWarning("Gemini: {Message} Trying once more in {Seconds} s.", result.Error.Message, _settings.GeminiRetryDelay.TotalSeconds);
            await Task.Delay(_settings.GeminiRetryDelay, ct);
            result = await _gemini.GenerateAsync(request, ct);
        }
        if (result.IsSuccess)
        {
            var u = result.Value.Usage;
            usage.Add(new BlogTokenUsage(label, u.Prompt, u.Output, u.Thinking, u.Cached, u.Total));
            _logger.LogInformation("Gemini usage ({Call}): prompt {Prompt} (cached {Cached}), output {Output}, thinking {Thinking}, total {Total}",
                label, u.Prompt, u.Cached, u.Output, u.Thinking, u.Total);
        }
        return result;
    }
}
