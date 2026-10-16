using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Blog;
using NoteFusion.Application.Blog.Commands;
using NoteFusion.Application.Blog.Drafting;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Blog;
using NoteFusion.Infrastructure.Http;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Blog;

/// <summary>
/// The drafter on a bad day, through the real Gemini client over a scripted socket: retries with backoff
/// (Retry-After winning), the fallback models, what never falls back, the revision staying with the model
/// that wrote the draft, and the circuit breaker — which "high demand" 503s must not open, and which, when
/// it does open, stops the batch with a sentence in its row.
/// </summary>
public class GeminiRetryTests
{
    private static readonly DraftTopic Topic = new(null, "how-to-teach-a-choir-a-new-song", "teach a choir a new song", "How-to", "An angle", []);

    private static HttpResponseMessage Ok(object draft)
    {
        var text = JsonSerializer.Serialize(draft);
        var body = JsonSerializer.Serialize(new
        {
            candidates = new[] { new { content = new { role = "model", parts = new[] { new { text } } }, finishReason = "STOP" } },
            usageMetadata = new { promptTokenCount = 100, candidatesTokenCount = 200, thoughtsTokenCount = 50, totalTokenCount = 350 },
        });
        return StubHttpMessageHandler.Respond(HttpStatusCode.OK, body);
    }

    private static HttpResponseMessage Status(HttpStatusCode status, int? retryAfterSeconds = null)
    {
        var r = StubHttpMessageHandler.Respond(status, """{"error":{"message":"This model is currently experiencing high demand."}}""");
        if (retryAfterSeconds is { } s)
            r.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromSeconds(s));
        return r;
    }

    /// <summary>The model a request went to, from its URL.</summary>
    private static string ModelOf(StubHttpMessageHandler.CapturedRequest r)
        => r.Uri!.AbsolutePath.Split("/models/")[1].Split(':')[0];

    private sealed class Rig
    {
        public Rig(Func<HttpRequestMessage, int, HttpResponseMessage> respond, BlogSettings? settings = null, HttpClient? http = null, IProviderHealth? health = null)
        {
            Socket = new StubHttpMessageHandler(respond);
            Settings = settings ?? new BlogSettings();
            Client = new GeminiClient(http ?? new HttpClient(Socket), new GeminiSettings { ApiKey = "k" }, NullLogger<GeminiClient>.Instance);
            Writer = new BlogDraftWriter(Client, Settings, NullLogger<BlogDraftWriter>.Instance, health)
            {
                Delay = (wait, _) => { Waits.Add(wait); return Task.CompletedTask; },
            };
        }

        public StubHttpMessageHandler Socket { get; }
        public BlogSettings Settings { get; }
        public GeminiClient Client { get; }
        public BlogDraftWriter Writer { get; }
        public List<TimeSpan> Waits { get; } = [];
        public List<string> Models => Socket.Requests.Select(ModelOf).ToList();

        public Task<DraftOutcome> Write() => Writer.WriteAsync(Topic, FakeCatalogue.Site, [], new HashSet<string>(), default);
    }

    private static TimeSpan S(int seconds) => TimeSpan.FromSeconds(seconds);

    [Fact]
    public async Task High_demand_503s_are_tried_five_times_15_30_60_60_seconds_apart()
    {
        var rig = new Rig((_, n) => n < 5 ? Status(HttpStatusCode.ServiceUnavailable) : Ok(BlogSamples.GoodDraft()));

        var outcome = await rig.Write();

        Assert.Null(outcome.Error);
        Assert.NotNull(outcome.Draft);
        Assert.Equal(Enumerable.Repeat("gemini-3.8-flash", 5), rig.Models);
        Assert.Equal([S(15), S(30), S(60), S(60)], rig.Waits);
        Assert.Equal("gemini-3.8-flash", outcome.Model);
    }

    [Fact]
    public async Task A_Retry_After_from_the_API_wins_but_never_past_a_minute()
    {
        var rig = new Rig((_, n) => n switch
        {
            1 => Status(HttpStatusCode.TooManyRequests, retryAfterSeconds: 7),
            2 => Status(HttpStatusCode.ServiceUnavailable, retryAfterSeconds: 600),
            _ => Ok(BlogSamples.GoodDraft()),
        });

        await rig.Write();

        Assert.Equal([S(7), S(60)], rig.Waits);
    }

    [Fact]
    public async Task A_model_still_overloaded_hands_the_draft_to_the_fallbacks_two_tries_each_and_the_revision_stays_with_it()
    {
        var weak = new { title = "Too short", description = "Short.", slug = "x", tags = new[] { "choir" }, faq = Array.Empty<object>(), body = "## One\n\nToo short." };
        var rig = new Rig((req, n) => req.RequestUri!.AbsolutePath.Contains("/gemini-flash-lite-latest:")
            ? Ok(n == 8 ? weak : BlogSamples.GoodDraft()) // the draft fails the checks; the revision passes
            : Status(HttpStatusCode.ServiceUnavailable));

        var outcome = await rig.Write();

        Assert.Equal(
            [
                "gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.8-flash",
                "gemini-flash-latest", "gemini-flash-latest",
                "gemini-flash-lite-latest", // the draft
                "gemini-flash-lite-latest", // its revision, from the same model
            ],
            rig.Models);
        Assert.Equal([S(15), S(30), S(60), S(60), S(15)], rig.Waits);
        Assert.Null(outcome.Error);
        Assert.Empty(outcome.Problems);
        Assert.Equal("gemini-flash-lite-latest", outcome.Model);
        Assert.Equal(["Draft", "Revision"], outcome.Usage.Select(u => u.Call));
    }

    [Fact]
    public async Task A_model_id_that_is_gone_falls_back_at_once()
    {
        var rig = new Rig((_, n) => n == 1 ? Status(HttpStatusCode.NotFound) : Ok(BlogSamples.GoodDraft()));

        var outcome = await rig.Write();

        Assert.Equal(["gemini-3.8-flash", "gemini-flash-latest"], rig.Models);
        Assert.Empty(rig.Waits);
        Assert.Equal("gemini-flash-latest", outcome.Model);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, "Gemini__ApiKey")]
    [InlineData(HttpStatusCode.Forbidden, "Gemini__ApiKey")]
    [InlineData(HttpStatusCode.BadRequest, "Gemini__Model")]
    public async Task A_refused_key_or_a_bad_request_never_retries_or_falls_back(HttpStatusCode status, string hint)
    {
        var rig = new Rig((_, _) => Status(status));

        var outcome = await rig.Write();

        Assert.Single(rig.Socket.Requests);
        Assert.Null(outcome.Draft);
        Assert.Contains(hint, outcome.Error!.Message);
    }

    [Fact]
    public async Task A_blocked_prompt_never_falls_back()
    {
        var rig = new Rig((_, _) => StubHttpMessageHandler.Respond(HttpStatusCode.OK, """{"promptFeedback":{"blockReason":"SAFETY"}}"""));

        var outcome = await rig.Write();

        Assert.Single(rig.Socket.Requests);
        Assert.Equal("GEMINI_BLOCKED", outcome.Error!.Code);
    }

    [Fact]
    public async Task Every_model_overloaded_ends_with_the_last_error_after_nine_calls()
    {
        var rig = new Rig((_, _) => Status(HttpStatusCode.ServiceUnavailable));

        var outcome = await rig.Write();

        Assert.Equal(9, rig.Socket.Requests.Count); // 5 + 2 + 2
        Assert.Equal("GEMINI_SERVER_ERROR", outcome.Error!.Code);
        Assert.Equal("gemini-flash-lite-latest", outcome.Model);
    }

    [Fact]
    public async Task The_fallback_list_is_configurable_and_can_be_off()
    {
        var none = new Rig((_, _) => Status(HttpStatusCode.ServiceUnavailable), new BlogSettings { GeminiFallbackModels = [] });
        await none.Write();
        Assert.Equal(Enumerable.Repeat("gemini-3.8-flash", 5), none.Models);

        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Gemini:Model"] = "gemini-x",
            ["Gemini:FallbackModels"] = "gemini-y, gemini-z",
        }).Build();
        var settings = BlogDependencyInjection.ResolveSettings(config);
        Assert.Equal(["gemini-y", "gemini-z"], settings.GeminiFallbackModels);
        var custom = new Rig((_, _) => Status(HttpStatusCode.NotFound), settings);
        await custom.Write();
        Assert.Equal(["gemini-x", "gemini-y", "gemini-z"], custom.Models);

        var off = BlogDependencyInjection.ResolveSettings(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Gemini:FallbackModels"] = "none" }).Build());
        Assert.Empty(off.GeminiFallbackModels);
        var defaults = BlogDependencyInjection.ResolveSettings(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Gemini:FallbackModels"] = "" }).Build());
        Assert.Equal(["gemini-flash-latest", "gemini-flash-lite-latest"], defaults.GeminiFallbackModels);
    }

    // ── The circuit breaker, through the real pipeline ──────────────────────────────────────

    private sealed class Pipeline : IDisposable
    {
        private readonly ServiceProvider _services;

        public Pipeline(HttpMessageHandler socket)
        {
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddHttpClient("gemini").ConfigurePrimaryHttpMessageHandler(() => socket).AddOutboundResilience(OutboundResilience.Gemini);
            _services = services.BuildServiceProvider();
            Http = _services.GetRequiredService<IHttpClientFactory>().CreateClient("gemini");
            Health = _services.GetRequiredService<IProviderHealth>();
        }

        public HttpClient Http { get; }
        public IProviderHealth Health { get; }
        public bool Open => Health.IsUnavailable(OutboundProviders.Gemini);

        public void Dispose() => _services.Dispose();
    }

    [Fact]
    public async Task A_spell_of_high_demand_503s_does_not_open_the_breaker()
    {
        var socket = new StubHttpMessageHandler((_, _) => Status(HttpStatusCode.ServiceUnavailable));
        using var pipeline = new Pipeline(socket);
        var rig = new Rig((_, _) => throw new InvalidOperationException(), http: pipeline.Http, health: pipeline.Health);

        var outcome = await rig.Write();

        Assert.Equal(9, socket.Requests.Count); // every try went out: none was refused by the breaker
        Assert.False(pipeline.Open);
        Assert.Equal("GEMINI_SERVER_ERROR", outcome.Error!.Code);
    }

    [Fact]
    public async Task When_real_failures_open_the_breaker_the_batch_stops_and_says_why_in_its_row()
    {
        var socket = new StubHttpMessageHandler((_, _) => StubHttpMessageHandler.Respond(HttpStatusCode.InternalServerError, "{}"));
        using var pipeline = new Pipeline(socket);
        var rig = new Rig((_, _) => throw new InvalidOperationException(), http: pipeline.Http, health: pipeline.Health);

        using var h = new TestHarness(new DateTime(2026, 10, 16, 9, 0, 0, DateTimeKind.Utc));
        foreach (var (slug, position) in new[] { ("first-topic", 10), ("second-topic", 20) })
        {
            await new CreateBlogTopicCommandHandler(h.Db, h.Clock).Handle(
                new CreateBlogTopicCommand(new BlogTopicInput(slug, slug.Replace('-', ' '), null, null, null, position, null)), default);
        }
        h.Db.BlogGenerationRuns.Add(BlogGenerationRun.Queue(BlogGenerationTrigger.Admin, 2, null, null, null, h.Clock.UtcNow));
        h.Db.SaveChanges();
        var runner = new BlogGenerationRunner(h.Db, rig.Client, new FakeCatalogue(), rig.Writer, rig.Settings, h.Clock,
            NullLogger<BlogGenerationRunner>.Instance, pipeline.Health);

        await runner.RunNextAsync(default);

        Assert.True(pipeline.Open);
        var run = h.Db.BlogGenerationRuns.Single();
        Assert.Equal(BlogGenerationStatus.Failed, run.Status);
        var item = Assert.Single(run.Items); // the second topic was never tried
        Assert.Equal("first-topic", item.Slug);
        Assert.Contains("stopped calling it", run.Error);
        Assert.True(socket.Requests.Count < 9, $"{socket.Requests.Count} calls went out after the breaker opened");
    }
}
