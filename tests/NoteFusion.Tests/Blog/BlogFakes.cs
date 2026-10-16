using System.Text.Json;
using NoteFusion.Application.Blog;
using NoteFusion.Application.Blog.Commands;
using NoteFusion.Application.Blog.Drafting;
using NoteFusion.Application.Blog.Dtos;
using NoteFusion.Application.Blog.Publishing;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Tests.Blog;

/// <summary>The site's catalogue as a fixed answer (or no answer at all).</summary>
public sealed class FakeCatalogue : IBlogSiteCatalogue
{
    public static readonly BlogCatalogue Site = new(
        [
            new CatalogueHymn("amazing-grace", "Amazing Grace", null, "G major", "Doh is G", "3/4", 16,
                new CatalogueLine(5, "| s, - | d - - - m d | m - - - r - | d - - - l, - | s, - - - s, - |", "A- mazing grace! how sweet the sound")),
        ],
        ["/", "/app", "/blog", "/hymns", "/hymns/amazing-grace", "/blog/how-to-read-tonic-solfa", "/blog/author/francis", "/privacy"],
        ["francis"]);

    public bool Down { get; set; }

    public Task<Result<BlogCatalogue>> GetAsync(CancellationToken ct)
        => Task.FromResult(Down
            ? Result.Failure<BlogCatalogue>(Error.Network("BLOG_CATALOGUE_UNAVAILABLE", "down"))
            : Result.Success(Site));
}

/// <summary>GitHub, recording each dispatch and answering as the test says.</summary>
public sealed class FakeGitHub : IGitHubActions
{
    public bool IsConfigured { get; set; } = true;
    public string Target => "owner/repo · deploy-web.yml on main";
    public int Dispatches { get; private set; }
    public Error? FailWith { get; set; }

    public Task<Result> DispatchSiteDeployAsync(CancellationToken ct)
    {
        Dispatches++;
        return Task.FromResult(FailWith is { } e ? Result.Failure(e) : Result.Success());
    }

    public Task<Result<SiteDeployRun?>> LatestSiteDeployAsync(CancellationToken ct)
        => Task.FromResult(Result.Success<SiteDeployRun?>(new SiteDeployRun("completed", "success", "https://github.com/x", DateTime.UtcNow, "workflow_dispatch")));
}

/// <summary>Gemini, answering from a script; records every request.</summary>
public sealed class FakeGemini : IGeminiClient
{
    private readonly Queue<GeminiResponse> _answers = new();

    public bool IsConfigured { get; set; } = true;
    public List<GeminiRequest> Requests { get; } = [];

    public FakeGemini Answer(object post, int prompt = 1000, int output = 2000, int thinking = 500)
    {
        var json = JsonSerializer.Serialize(post);
        _answers.Enqueue(GeminiResponse.Ok(new GeminiReply(json, new GeminiUsage(prompt, output, thinking, 0, prompt + output + thinking), "gemini-test-001",
            new GeminiTurn("model", JsonSerializer.Serialize(new[] { new { text = json } })))));
        return this;
    }

    public FakeGemini Fail(Error error, int? status = null)
    {
        _answers.Enqueue(GeminiResponse.Fail(error, status));
        return this;
    }

    public Task<GeminiResponse> GenerateAsync(GeminiRequest request, CancellationToken ct)
    {
        Requests.Add(request);
        return Task.FromResult(_answers.Count > 0 ? _answers.Dequeue() : GeminiResponse.Fail(Error.Failure("NO_SCRIPT", "No answer scripted.")));
    }
}

/// <summary>Posts that pass, or fail, the checks.</summary>
public static class BlogSamples
{
    private const string Sentence = "A steady rehearsal plan helps every section of the choir hear its part against the others before Sunday. ";

    /// <summary>A body of about 1,450 words in five sections, linking to /app and to <paramref name="links"/>.</summary>
    public static string GoodBody(params string[] links)
    {
        var section = string.Concat(Enumerable.Repeat(Sentence, 16));
        var extra = string.Join(" ", links.Select(l => $"See [this page]({l}) for more."));
        return $"""
Learning a new song quickly is the job of every choir director. This guide sets out a plan.

## Start with the sound

{section}

## Teach the tune

{section} {extra}

## Add the parts

{section}

## Put it together

{section}

## Keep it fresh

{section} When you have a recording, [NoteFusion](/app) writes it out for you.
""";
    }

    public static object GoodDraft(string slug = "how-to-teach-a-choir-a-new-song", string title = "How to Teach a Choir a New Song Before Sunday", params string[] links) => new
    {
        title,
        description = "A practical rehearsal plan for choir directors: find the doh, teach the tune by phrase, add the parts and send recordings home for practice.",
        slug,
        tags = new[] { "choir", "rehearsal" },
        faq = new[]
        {
            new { question = "How long does it take to teach a new song?", answer = "Most choirs can learn a simple hymn tune in one rehearsal when it is taught phrase by phrase." },
            new { question = "Should I teach the tune or the parts first?", answer = "Teach the tune to everyone first, then let each section learn its own part against it." },
            new { question = "Do recordings help choristers practise?", answer = "Yes, a short recording of each part lets singers practise at home between rehearsals." },
        },
        body = GoodBody(links),
    };

    public static BlogPostInput Input(string slug = "a-new-post", string title = "A New Post About Choirs", string? body = null) => new(
        slug, title, null,
        "A practical rehearsal plan for choir directors: find the doh, teach the tune by phrase, add the parts and send recordings home.",
        body ?? GoodBody(), ["choir"], "choir rehearsal", null,
        [new BlogFaqDto("Is this a question?", "Yes, and this answer is long enough to count as a full sentence for the checks.")],
        null, null, null);
}
