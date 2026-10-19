using System.Net;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Blog;
using NoteFusion.Application.Blog.Drafting;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Blog;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Blog;

/// <summary>
/// The checks ported from tools/blog/lib/quality.mjs and the build's own validation, the solfa blocks, and the
/// Gemini and GitHub clients' handling of what comes back.
/// </summary>
public class BlogChecksTests
{
    private static readonly BlogCheckContext Ctx = new(FakeCatalogue.Site, [new LivePost("how-to-read-tonic-solfa", "How to Read Tonic Solfa", "d", ["tonic-solfa"])], []);

    private static BlogCheckInput Post(string body, string title = "How to Teach a Choir a New Song Before Sunday", IReadOnlyList<string>? tags = null) => new(
        "how-to-teach", title,
        "A practical rehearsal plan for choir directors: find the doh, teach the tune by phrase, add the parts and send recordings home.",
        null, tags ?? ["choir"],
        [
            new BlogFaqItem("How long does it take to teach a new song?", "Most choirs can learn a simple hymn tune in one rehearsal when it is taught phrase by phrase."),
            new BlogFaqItem("Should I teach the tune or the parts first?", "Teach the tune to everyone first, then let each section learn its own part against it."),
            new BlogFaqItem("Do recordings help choristers practise?", "Yes, a short recording of each part lets singers practise at home between rehearsals."),
        ],
        body, "francis", null, null, null, null);

    [Fact]
    public void A_good_post_has_no_blockers_and_no_advice()
    {
        var r = BlogChecks.Check(Post(BlogSamples.GoodBody("/hymns/amazing-grace") + "\n```solfa\nhymn: amazing-grace\nbars: 1-5  # the first line\n```\n\n```solfa\nscale: A minor\nharmonic: true\n```\n"), Ctx);
        Assert.Empty(r.Blockers);
        Assert.Empty(r.Advice);
    }

    [Theory]
    [InlineData("hymn: no-such-hymn", "no published hymn \"no-such-hymn\"")]
    [InlineData("hymn: amazing-grace\nbars: 3-40", "Amazing Grace has bars 1-16")]
    [InlineData("hymn: amazing-grace\nbars: 3", "bars must look like 1-4")]
    [InlineData("hymn: amazing-grace\ncolour: red", "unknown field \"colour\"")]
    [InlineData("scale: H major", "not a key")]
    [InlineData("scale: G major\nharmonic: true", "only a minor key has a harmonic minor scale")]
    [InlineData("words: false", "give a `hymn:` or a `scale:`")]
    public void A_solfa_block_the_build_could_not_render_blocks_publishing(string block, string expected)
    {
        var r = BlogChecks.Check(Post(BlogSamples.GoodBody() + $"\n```solfa\n{block}\n```\n"), Ctx);
        Assert.Contains(r.Blockers, b => b.Contains(expected));
    }

    [Fact]
    public void Without_the_catalogue_only_the_form_of_a_block_is_checked()
    {
        var r = BlogChecks.Check(Post(BlogSamples.GoodBody() + "\n```solfa\nhymn: some-new-hymn\n```\n[x](/somewhere/new)\n"), Ctx with { Catalogue = null });
        Assert.Empty(r.Blockers);
    }

    [Fact]
    public void What_stops_the_build_is_a_blocker()
    {
        var r = BlogChecks.Check(Post("# A second title\n\n![a picture](/assets/x.jpg)\n\n<script>alert(1)</script>\n\nSee [a page](/blog/not-there).", tags: ["Not A Tag"]), Ctx);
        Assert.Contains(r.Blockers, b => b.Contains("top-level heading"));
        Assert.Contains(r.Blockers, b => b.Contains("give its size as the title"));
        Assert.Contains(r.Blockers, b => b.Contains("raw HTML"));
        Assert.Contains(r.Blockers, b => b.Contains("The link /blog/not-there goes to a page that does not exist."));
        Assert.Contains(r.Blockers, b => b.Contains("lowercase-hyphenated"));

        var dup = BlogChecks.Check(Post(BlogSamples.GoodBody(), title: "How to read Tonic Solfa"), Ctx);
        Assert.Contains("A post titled \"How to read Tonic Solfa\" already exists.", dup.Blockers);
    }

    [Theory]
    [InlineData("<img src=x onerror=alert(1)>")]
    [InlineData("<a href=\"https://example.com\">here</a>")]
    [InlineData("<details open>")]
    [InlineData("<!-- a comment -->")]
    [InlineData("[more](javascript:alert(1))")]
    [InlineData("[more](JavaScript:alert(1))")]
    public void Markup_that_could_run_a_script_is_a_blocker_in_the_body_and_in_an_faq_answer(string payload)
    {
        var inBody = BlogChecks.Check(Post(BlogSamples.GoodBody() + "\n\n" + payload + "\n"), Ctx);
        Assert.NotEmpty(inBody.Blockers);

        var good = Post(BlogSamples.GoodBody());
        var inFaq = BlogChecks.Check(good with { Faq = [.. good.Faq.Take(2), new BlogFaqItem("Is this safe?", "Yes. " + payload)] }, Ctx);
        Assert.NotEmpty(inFaq.Blockers);
    }

    [Fact]
    public void Prose_comparisons_and_markdown_autolinks_are_not_raw_html()
    {
        var r = BlogChecks.Check(Post(BlogSamples.GoodBody() + "\n\nA third is < a fifth. Write to <hello@notefusion.studio> or see <https://notefusion.studio>.\n"), Ctx);
        Assert.DoesNotContain(r.Blockers, b => b.Contains("raw HTML"));
    }

    [Fact]
    public void Invented_facts_stock_phrases_and_hand_written_solfa_are_flagged_as_in_quality_mjs()
    {
        var body = BlogSamples.GoodBody() + """

Research shows that 75% of singers improve. "Solfa changed everything for our choir," says a director.
We delve into it. TODO: finish. Sing s m r d t, l, s, now. The bare scale d r m f s l t d' is fine.
Visit https://example.com for more.
""";
        var r = BlogChecks.Check(Post(body), Ctx);
        Assert.Empty(r.Blockers);
        Assert.Contains("Remove a percentage (\"75%\"): no statistics, studies, quotes or testimonials may be invented.", r.Advice);
        Assert.Contains(r.Advice, a => a.StartsWith("Remove an appeal to studies, research or experts"));
        Assert.Contains(r.Advice, a => a.StartsWith("Remove a quotation attributed to someone"));
        Assert.Contains(@"Remove the stock phrase matching /\bdelve\b/i — write it plainly.", r.Advice);
        Assert.Contains(@"There is placeholder text (/\bTODO\b/); every sentence must be finished.", r.Advice);
        Assert.Contains(r.Advice, a => a.StartsWith("Solfa written by hand (\"s m r d t, l, s,"));
        Assert.Contains("Remove the external link https://example.com; link only to pages on notefusion.studio.", r.Advice);
    }

    [Fact]
    public void The_bare_scale_alone_is_not_hand_written_solfa()
    {
        var r = BlogChecks.Check(Post(BlogSamples.GoodBody() + "\nThe scale is d r m f s l t d' and that is all.\n"), Ctx);
        Assert.DoesNotContain(r.Advice, a => a.StartsWith("Solfa written by hand"));
    }

    [Fact]
    public void Length_sections_faq_and_links_are_advice()
    {
        var input = Post("## Only\n\nShort.") with { Faq = [new BlogFaqItem("No question mark", "Too short.")] };
        var r = BlogChecks.Check(input, Ctx with { RequiredLinks = ["/hymns"] });
        Assert.Contains("The body is 2 words; it must be 800–2200 (not counting solfa blocks).", r.Advice);
        Assert.Contains("The body has 1 sections (## headings); it needs at least 4.", r.Advice);
        Assert.Contains("The FAQ has 1 questions; it needs 3–8.", r.Advice);
        Assert.Contains("FAQ 1: the question must end with a question mark.", r.Advice);
        Assert.Contains("FAQ 1: the answer must be at least one full sentence (12+ words).", r.Advice);
        Assert.Contains("Link to /hymns somewhere in the body.", r.Advice);
        Assert.Contains("Link to /app (the NoteFusion web app) once, where it helps the reader.", r.Advice);
    }

    [Fact]
    public void Links_are_collected_as_the_renderer_would()
    {
        var links = BlogChecks.Links("""
[a](/app) and [b](https://notefusion.studio/hymns "t") and ![img](/assets/x.jpg "1x1") and <https://x.org>
`[not](/code)` www.example.com
[ref]: /blog/how-to-read-tonic-solfa
```
[fenced](/fenced)
```
""");
        Assert.Equal(["/app", "/hymns", "/blog/how-to-read-tonic-solfa", "https://x.org", "www.example.com"], links);
    }

    [Fact]
    public void Slugs_and_slugify_follow_the_site()
    {
        Assert.Equal("how-to-read-solfa", BlogPost.Slugify("How to Read Solfa!"));
        Assert.Equal("dont-panic", BlogPost.Slugify("Don’t panic"));
        Assert.True(BlogPost.IsSlug("a-b-c"));
        Assert.False(BlogPost.IsSlug("a--b"));
        Assert.False(BlogPost.IsSlug("A-b"));
    }

    [Fact]
    public void Gemini_replies_are_read_without_thought_parts_and_with_their_usage()
    {
        var json = JsonNode.Parse("""
{"candidates":[{"content":{"role":"model","parts":[{"text":"thinking…","thought":true},{"text":"{\"title\":"},{"text":"\"x\"}"}]},"finishReason":"STOP"}],
 "usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":20,"thoughtsTokenCount":5,"cachedContentTokenCount":2,"totalTokenCount":35},
 "modelVersion":"gemini-3.8-flash-001"}
""")!;
        var r = GeminiClient.Read(json, "gemini-3.8-flash");
        Assert.True(r.IsSuccess);
        Assert.Equal("{\"title\":\"x\"}", r.Value.Json);
        Assert.Equal(new GeminiUsage(10, 20, 5, 2, 35), r.Value.Usage);
        Assert.Equal("gemini-3.8-flash-001", r.Value.ModelVersion);
        Assert.Contains("\"thought\":true", r.Value.ModelTurn.PartsJson); // sent back exactly for the revision

        var cut = GeminiClient.Read(JsonNode.Parse("""{"candidates":[{"content":{"parts":[{"text":"{"}]},"finishReason":"MAX_TOKENS"}]}""")!, "m");
        Assert.Equal("GEMINI_STOPPED", cut.Error.Code);
        Assert.Contains("Gemini__MaxOutputTokens", cut.Error.Message);
    }

    [Fact]
    public async Task The_Gemini_client_sends_the_key_in_a_header_and_turns_refusals_into_plain_errors()
    {
        var stub = new StubHttpMessageHandler((_, n) => n == 1
            ? StubHttpMessageHandler.Respond(HttpStatusCode.TooManyRequests, """{"error":{"message":"Quota exceeded"}}""")
            : StubHttpMessageHandler.Respond(HttpStatusCode.NotFound, """{"error":{"message":"models/x is not found"}}"""));
        var client = new GeminiClient(new HttpClient(stub), new GeminiSettings { ApiKey = "secret-key" }, NullLogger<GeminiClient>.Instance);
        var request = new GeminiRequest("x", "sys", [GeminiTurn.User("hi")], BlogPrompt.DraftSchemaJson, 0.7, 100);

        var limited = await client.GenerateAsync(request, default);
        Assert.Equal("GEMINI_RATE_LIMITED", limited.Failure!.Error.Code);
        Assert.Equal(429, limited.Failure.Status);
        Assert.True(limited.Failure.Retryable);
        var missing = await client.GenerateAsync(request, default);
        Assert.Contains("is Gemini__Model \"x\" a current model id?", missing.Failure!.Error.Message);
        Assert.False(missing.Failure.Retryable);
        Assert.True(missing.Failure.ModelUnavailable);

        var sent = stub.Requests[0];
        Assert.Equal("secret-key", sent.Headers["x-goog-api-key"]);
        Assert.EndsWith("/v1beta/models/x:generateContent", sent.Uri!.AbsoluteUri);
        var body = JsonNode.Parse(sent.Body!)!;
        Assert.Equal("application/json", body["generationConfig"]!["responseMimeType"]!.GetValue<string>());
        Assert.Equal("OBJECT", body["generationConfig"]!["responseSchema"]!["type"]!.GetValue<string>());
        Assert.Equal("hi", body["contents"]![0]!["parts"]![0]!["text"]!.GetValue<string>());
        Assert.DoesNotContain("secret-key", sent.Body);
    }

    [Fact]
    public async Task The_GitHub_client_dispatches_the_deploy_workflow_on_its_branch()
    {
        var stub = StubHttpMessageHandler.Returning(HttpStatusCode.NoContent, "");
        var client = new GitHubActionsClient(new HttpClient(stub), new GitHubSettings { Token = "ghp_x", Repo = "owner/repo" }, NullLogger<GitHubActionsClient>.Instance);

        var r = await client.DispatchSiteDeployAsync(default);

        Assert.True(r.IsSuccess);
        var sent = Assert.Single(stub.Requests);
        Assert.Equal(HttpMethod.Post, sent.Method);
        Assert.Equal("https://api.github.com/repos/owner/repo/actions/workflows/deploy-web.yml/dispatches", sent.Uri!.AbsoluteUri);
        Assert.Equal("Bearer ghp_x", sent.Headers["Authorization"]);
        Assert.Equal("""{"ref":"main"}""", sent.Body);

        var refused = new GitHubActionsClient(new HttpClient(StubHttpMessageHandler.Returning(HttpStatusCode.Forbidden, """{"message":"Resource not accessible"}""")),
            new GitHubSettings { Token = "ghp_x", Repo = "owner/repo" }, NullLogger<GitHubActionsClient>.Instance);
        var no = await refused.DispatchSiteDeployAsync(default);
        Assert.Contains("Resource not accessible", no.Error.Message);
        Assert.Contains("GitHub__Token", no.Error.Message);
    }

    [Fact]
    public void Settings_read_empty_variables_as_defaults()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Blog:AutoDraftDays"] = "Tue, fri",
            ["Blog:AutoDraftTimeUtc"] = "07:15",
            ["Blog:AutoDraftCount"] = "",
            ["Gemini:Model"] = "",
            ["GitHub:Token"] = "",
        }).Build();
        var s = BlogDependencyInjection.ResolveSettings(config);
        Assert.Equal([DayOfWeek.Tuesday, DayOfWeek.Friday], s.AutoDraftDays);
        Assert.Equal(new TimeOnly(7, 15), s.AutoDraftTimeUtc);
        Assert.Equal(1, s.AutoDraftCount);
        Assert.Equal(BlogSettings.DefaultModel, s.GeminiModel);
        Assert.False(BlogDependencyInjection.ResolveGitHub(config).IsConfigured);
        Assert.False(BlogDependencyInjection.ResolveGemini(config).IsConfigured);
    }
    [Fact]
    public void The_seeded_launch_posts_and_topics_load_and_would_publish()
    {
        var seed = NoteFusion.Infrastructure.Persistence.Seed.BlogSeed.Load();
        Assert.Equal(["how-to-find-the-doh-of-a-song", "how-to-read-tonic-solfa"], seed.Posts.Where(p => !p.Draft).Select(p => p.Slug));
        Assert.Equal(40, seed.Topics.Count);
        var rows = NoteFusion.Infrastructure.Persistence.Seed.BlogSeed.PostRows(seed);
        Assert.Equal(3, rows.GetLength(0));

        // The first Gemini draft (written by the old PR drafter) arrives as a draft for review, never live.
        var draft = Assert.Single(seed.Posts, p => p.Draft);
        Assert.Equal("tonic-solfa-vs-staff-notation", draft.Slug);
        var columns = NoteFusion.Infrastructure.Persistence.Seed.BlogSeed.PostColumns;
        var i = seed.Posts.IndexOf(draft);
        Assert.Equal(nameof(BlogPostStatus.Draft), rows[i, Array.IndexOf(columns, "Status")]);
        Assert.Equal(nameof(BlogPostSource.Gemini), rows[i, Array.IndexOf(columns, "Source")]);
        Assert.Null(rows[i, Array.IndexOf(columns, "PublishedAtUtc")]);
        Assert.Equal("gemini-3.8-flash", rows[i, Array.IndexOf(columns, "GenerationModel")]);

        foreach (var p in seed.Posts.Where(p => !p.Draft))
        {
            var input = new BlogCheckInput(p.Slug, p.Title, p.Description, p.Dek, p.Tags,
                (p.Faq ?? []).Select(f => new BlogFaqItem(f.Question, f.Answer)).ToList(), p.Body, p.Author, null, null, null, null);
            Assert.Empty(BlogChecks.Check(input, new BlogCheckContext(null, [], [])).Blockers);
            Assert.NotEmpty(SolfaBlocks.HymnsCited(p.Body));
        }
    }
    [Fact]
    public void The_prompt_spells_out_only_hand_made_hymns_and_the_ones_the_topic_links_to_but_lists_every_hymn_page()
    {
        CatalogueHymn Hymn(string slug, bool imported) => new(slug, slug, null, "G major", "Doh is G", "4/4", 8,
            new CatalogueLine(2, $"| {slug}-solfa |", "words"), imported);
        var catalogue = new BlogCatalogue(
            [Hymn("amazing-grace", false), Hymn("imported-one", true), Hymn("imported-two", true)],
            ["/", "/app", "/hymns", "/hymns/amazing-grace", "/hymns/imported-one", "/hymns/imported-two"], ["francis"]);
        var topic = new NoteFusion.Application.Blog.Drafting.DraftTopic(null, "a-topic", "kw", "intent", "angle", ["/hymns/imported-two"]);

        var prompt = NoteFusion.Application.Blog.Drafting.BlogPrompt.User(topic, [], catalogue, []);

        Assert.Contains("| amazing-grace-solfa |", prompt);
        Assert.Contains("| imported-two-solfa |", prompt);       // the topic links to it
        Assert.DoesNotContain("| imported-one-solfa |", prompt); // imported, not linked: not spelled out…
        Assert.Contains("- /hymns/imported-one — imported-one in Tonic Solfa", prompt); // …but still linkable
        Assert.Equal(["amazing-grace"], NoteFusion.Application.Blog.Drafting.BlogPrompt.CatalogueHymns(catalogue, []).Select(h => h.Slug));
    }

    [Fact]
    public void The_catalogue_reads_the_imported_flag_and_defaults_it_to_hand_made()
    {
        var json = """{"hymns":[{"slug":"a","title":"A","key":"G major","header":"Doh is G","time":"4/4","bars":4,"firstLine":{"bars":2,"solfa":"| d |","words":"w"},"imported":true},{"slug":"b","title":"B","key":"G major","header":"Doh is G","time":"4/4","bars":4,"firstLine":{"bars":2,"solfa":"| d |","words":"w"}}],"pages":["/"],"authors":["francis"]}""";
        var cat = System.Text.Json.JsonSerializer.Deserialize<BlogCatalogue>(json, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!;
        Assert.True(cat.Hymns[0].Imported);
        Assert.False(cat.Hymns[1].Imported);
    }
}
