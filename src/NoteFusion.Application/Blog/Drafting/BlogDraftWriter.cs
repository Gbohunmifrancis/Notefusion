using System.Text.Json;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
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

/// <summary>
/// How one draft came out: the post's fields (null when no answer came), what still fails, the calls' tokens, the
/// model that wrote it (or the last one tried), and the error that stopped it, if any.
/// </summary>
public sealed record DraftOutcome(DraftFields? Draft, IReadOnlyList<string> Problems, IReadOnlyList<BlogTokenUsage> Usage, string Model, Error? Error);

/// <summary>
/// Drafts one post, as <c>tools/blog/draft.mjs</c> did: the system instruction and the topic's prompt, the model's
/// JSON, the checks, and — if anything fails — one revision with the list of problems. A call has no side effects,
/// only a cost, so the drafter paces its own retries (the HTTP pipeline repeats nothing):
/// <list type="bullet">
///   <item>a 429, a 5xx or a dropped connection is tried up to <see cref="BlogSettings.GeminiAttempts"/> times,
///   <see cref="BlogSettings.GeminiRetryDelays"/> apart (15/30/60/60 s), a <c>Retry-After</c> winning;</item>
///   <item>a model still unavailable after that (429, 5xx, or a 404 for an id that is gone) hands the draft to the
///   next of <see cref="BlogSettings.GeminiFallbackModels"/>, <see cref="BlogSettings.GeminiFallbackAttempts"/>
///   tries each; a refused key, a bad request or a blocked prompt never falls back;</item>
///   <item>the revision goes to the model that wrote the draft (it continues that model's turn);</item>
///   <item>our own breaker open (<see cref="IProviderHealth"/>) stops at once, with a sentence that says so.</item>
/// </list>
/// </summary>
public sealed class BlogDraftWriter
{
    private readonly IGeminiClient _gemini;
    private readonly BlogSettings _settings;
    private readonly IProviderHealth _health;
    private readonly ILogger<BlogDraftWriter> _logger;

    public BlogDraftWriter(IGeminiClient gemini, BlogSettings settings, ILogger<BlogDraftWriter> logger, IProviderHealth? health = null)
    {
        _gemini = gemini;
        _settings = settings;
        _logger = logger;
        _health = health ?? ProviderHealth.AlwaysAvailable;
    }

    /// <summary>How a pause is waited out; tests replace it to record the pauses instead.</summary>
    public Func<TimeSpan, CancellationToken, Task> Delay { get; set; } = Task.Delay;

    /// <summary>The chosen model, then the fallbacks, each once.</summary>
    public IReadOnlyList<string> Models
        => new[] { _settings.GeminiModel }.Concat(_settings.GeminiFallbackModels)
            .Where(m => !string.IsNullOrWhiteSpace(m)).Select(m => m.Trim()).Distinct(StringComparer.Ordinal).ToList();

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

        var first = await CallAsync(contents, "Draft", Models, usage, ct);
        if (first.Reply is null)
            return new DraftOutcome(null, [], usage, first.Model, first.Failure!.Error);
        var model = first.Model;
        var (draft, problems) = Assess(first.Reply, topic, ctx, takenSlugs);

        if (problems.Count > 0)
        {
            _logger.LogInformation("Blog draft {Slug} needs fixing ({Count} problems); asking {Model} for one revision.", topic.Slug, problems.Count, model);
            contents.Add(first.Reply.ModelTurn);
            contents.Add(GeminiTurn.User(BlogPrompt.Revision(problems)));
            var second = await CallAsync(contents, "Revision", [model], usage, ct);
            if (second.Reply is null)
                return new DraftOutcome(draft, problems, usage, model, second.Failure!.Error);
            (draft, problems) = Assess(second.Reply, topic, ctx, takenSlugs);
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

    private sealed record Call(GeminiReply? Reply, GeminiFailure? Failure, string Model);

    /// <summary>The first of <paramref name="models"/> that answers, with the retries and pauses above.</summary>
    private async Task<Call> CallAsync(
        List<GeminiTurn> contents, string label, IReadOnlyList<string> models, List<BlogTokenUsage> usage, CancellationToken ct)
    {
        GeminiFailure? failure = null;
        for (var m = 0; m < models.Count; m++)
        {
            var model = models[m];
            var attempts = Math.Max(1, m == 0 ? _settings.GeminiAttempts : _settings.GeminiFallbackAttempts);
            var request = new GeminiRequest(model, BlogPrompt.System, contents.ToList(), BlogPrompt.DraftSchemaJson,
                _settings.GeminiTemperature, _settings.GeminiMaxOutputTokens);
            for (var attempt = 1; attempt <= attempts; attempt++)
            {
                if (_health.IsUnavailable(OutboundProviders.Gemini))
                    return new Call(null, new GeminiFailure(GeminiErrors.BreakerOpen, BreakerOpen: true), model);

                var response = await _gemini.GenerateAsync(request, ct);
                if (response.Reply is { } reply)
                {
                    var u = reply.Usage;
                    usage.Add(new BlogTokenUsage(label, u.Prompt, u.Output, u.Thinking, u.Cached, u.Total));
                    _logger.LogInformation(
                        "Gemini usage ({Call}, {Model}): prompt {Prompt} (cached {Cached}), output {Output}, thinking {Thinking}, total {Total}",
                        label, model, u.Prompt, u.Cached, u.Output, u.Thinking, u.Total);
                    return new Call(reply, null, model);
                }

                failure = response.Failure!;
                if (!failure.Retryable || attempt == attempts)
                    break;
                var delays = _settings.GeminiRetryDelays;
                var wait = failure.RetryAfter ?? (delays.Count == 0 ? TimeSpan.Zero : delays[Math.Min(attempt - 1, delays.Count - 1)]);
                if (wait > _settings.GeminiMaxRetryWait)
                    wait = _settings.GeminiMaxRetryWait;
                _logger.LogWarning("Gemini ({Model}): {Message} Trying again in {Seconds} s (attempt {Next} of {Attempts}).",
                    model, failure.Error.Message, (int)wait.TotalSeconds, attempt + 1, attempts);
                await Delay(wait, ct);
            }

            if (failure is null || !failure.ModelUnavailable || m == models.Count - 1)
                return new Call(null, failure, model);
            _logger.LogWarning("Gemini: {Model} is unavailable ({Message}); trying {Next}.", model, failure.Error.Message, models[m + 1]);
        }
        return new Call(null, failure ?? new GeminiFailure(GeminiErrors.NotConfigured), models.LastOrDefault() ?? _settings.GeminiModel);
    }
}
