using System.Net;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Api.Controllers;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Hymns.Commands;
using NoteFusion.Application.Hymns.Dtos;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Infrastructure.Api;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Hymns;

/// <summary>
/// "Hum to find a hymn": the API forwards the clip to the worker and hands back the hymn, in its own plain
/// sentences when anything goes wrong, spending nothing and storing nothing; and the anonymous route is
/// throttled per address and per device, by the minute and by the day.
/// </summary>
public class IdentifyHymnTests
{
    private const string Found = """
        {"match":{"slug":"amazing-grace","title":"Amazing Grace","tune":"NEW BRITAIN","url":"https://notefusion.studio/hymns/amazing-grace",
                  "kind":"hymn","confidence":0.32,"firstLine":"Amazing grace! how sweet the sound"},
         "notesHeard":16,"tooShort":false,"secondsHeard":15.0}
        """;

    // ── Forwarding ───────────────────────────────────────────────────────────

    [Fact]
    public async Task The_clip_goes_to_the_worker_and_the_hymn_comes_back()
    {
        var stub = StubHttpMessageHandler.Returning(HttpStatusCode.OK, Found);

        var result = await Client(stub).IdentifyHymnAsync(new MemoryStream([1, 2, 3]), "hum.webm");

        Assert.True(result.IsSuccess);
        Assert.Equal(
            new IdentifiedHymnDto("amazing-grace", "Amazing Grace", "NEW BRITAIN", "https://notefusion.studio/hymns/amazing-grace",
                "hymn", 0.32, "Amazing grace! how sweet the sound"),
            result.Value.Match);
        Assert.Equal(16, result.Value.NotesHeard);
        Assert.False(result.Value.TooShort);
        var sent = Assert.Single(stub.Requests);
        Assert.Equal(HttpMethod.Post, sent.Method);
        Assert.Equal("http://worker/v1/identify", sent.Uri!.ToString());
        Assert.Contains("name=audio", sent.Body);
        Assert.Contains("filename=hum.webm", sent.Body);
    }

    [Fact]
    public async Task A_tune_too_short_to_name_comes_back_as_such_with_no_match()
    {
        var stub = StubHttpMessageHandler.Returning(HttpStatusCode.OK, """{"match":null,"notesHeard":4,"tooShort":true,"secondsHeard":3.2}""");

        var result = await Client(stub).IdentifyHymnAsync(new MemoryStream([1]), "hum.mp4");

        Assert.True(result.IsSuccess);
        Assert.Equal(new HymnIdentificationDto(null, 4, true, 3.2), result.Value);
    }

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable, """{"detail":"The hymn finder is busy right now."}""", "HYMN_FINDER_BUSY")]
    [InlineData(HttpStatusCode.UnprocessableEntity, """{"detail":"ffmpeg: Invalid data found when processing input"}""", "HYMN_UNREADABLE_AUDIO")]
    [InlineData(HttpStatusCode.UnsupportedMediaType, """{"detail":"Unsupported audio format '.exe'."}""", "HYMN_UNREADABLE_AUDIO")]
    [InlineData(HttpStatusCode.RequestEntityTooLarge, """{"detail":"too large"}""", "HYMN_RECORDING_TOO_LARGE")]
    [InlineData(HttpStatusCode.InternalServerError, "Traceback (most recent call last): File \"/app/routes.py\"", "HYMN_FINDER_UNAVAILABLE")]
    [InlineData(HttpStatusCode.Unauthorized, """{"detail":"Invalid or missing API key."}""", "HYMN_FINDER_UNAVAILABLE")]
    public async Task A_refusal_is_the_apis_own_plain_sentence_never_the_workers_text(HttpStatusCode status, string body, string code)
    {
        var result = await Client(StubHttpMessageHandler.Returning(status, body)).IdentifyHymnAsync(new MemoryStream([1]), "hum.webm");

        Assert.True(result.IsFailure);
        Assert.Equal(code, result.Error.Code);
        Assert.DoesNotContain("ffmpeg", result.Error.Message);
        Assert.DoesNotContain("Traceback", result.Error.Message);
        Assert.DoesNotContain("API key", result.Error.Message);
        Assert.EndsWith(".", result.Error.Message);
    }

    [Fact]
    public async Task A_worker_that_cannot_be_reached_is_unavailable_in_plain_words()
    {
        var stub = StubHttpMessageHandler.Throwing(new HttpRequestException("Name or service not known (transcriber:8000)"));

        var result = await Client(stub).IdentifyHymnAsync(new MemoryStream([1]), "hum.webm");

        Assert.Equal(HymnErrors.Unavailable, result.Error);
    }

    [Fact]
    public async Task The_handler_forwards_and_keeps_only_the_finders_own_errors()
    {
        var found = new HymnIdentificationDto(null, 12, false, 14.0);
        var api = new RecordingApi(Result<HymnIdentificationDto>.Success(found));
        var ok = await new IdentifyHymnCommandHandler(api).Handle(new IdentifyHymnCommand(new MemoryStream([1, 2]), "hum.webm"), default);
        Assert.Equal(found, ok.Value);
        Assert.Equal("hum.webm", api.LastFileName);

        // Anything not the finder's own (say a transcription sentence) is not for this page.
        var other = new RecordingApi(Result.Failure<HymnIdentificationDto>(TranscriptionErrors.ServiceUnavailable));
        var failed = await new IdentifyHymnCommandHandler(other).Handle(new IdentifyHymnCommand(new MemoryStream([1]), "hum.webm"), default);
        Assert.Equal(HymnErrors.Unavailable, failed.Error);

        var busy = new RecordingApi(Result.Failure<HymnIdentificationDto>(HymnErrors.Busy));
        Assert.Equal(HymnErrors.Busy, (await new IdentifyHymnCommandHandler(busy).Handle(new IdentifyHymnCommand(new MemoryStream([1]), "hum.webm"), default)).Error);
    }

    [Fact]
    public async Task No_audio_never_reaches_the_worker()
    {
        var api = new RecordingApi(Result<HymnIdentificationDto>.Success(new HymnIdentificationDto(null, 0, true, 0)));

        var result = await new IdentifyHymnCommandHandler(api).Handle(new IdentifyHymnCommand(new MemoryStream(), "hum.webm"), default);

        Assert.Equal(HymnErrors.NoAudio, result.Error);
        Assert.Null(api.LastFileName);
    }

    // ── The route ────────────────────────────────────────────────────────────

    [Fact]
    public void The_route_is_anonymous_and_throttled_before_the_upload_is_read()
    {
        var action = typeof(HymnsController).GetMethod(nameof(HymnsController.Identify))!;

        Assert.NotNull(typeof(HymnsController).GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.NotNull(action.GetCustomAttribute<HymnIdentifyRateLimitAttribute>());
        Assert.IsAssignableFrom<IAsyncResourceFilter>(action.GetCustomAttribute<HymnIdentifyRateLimitAttribute>());
        Assert.Equal("identify", action.GetCustomAttribute<HttpPostAttribute>()!.Template);
    }

    // ── Rate limits ──────────────────────────────────────────────────────────

    [Fact]
    public void An_address_gets_a_few_tries_a_minute_whatever_device_it_claims()
    {
        using var limiter = new HymnIdentifyLimiter(Settings());

        for (var i = 0; i < 5; i++)
            Assert.True(Try(limiter, "1.2.3.4", $"device-number-{i}"));
        Assert.False(Try(limiter, "1.2.3.4", "a-brand-new-device"));
        Assert.False(Try(limiter, "1.2.3.4", null));
        Assert.True(Try(limiter, "5.6.7.8", null)); // another address has its own bucket
    }

    [Fact]
    public void A_device_gets_a_few_tries_a_minute_whatever_address_it_comes_from()
    {
        using var limiter = new HymnIdentifyLimiter(Settings());

        for (var i = 0; i < 5; i++)
            Assert.True(Try(limiter, $"10.0.0.{i}", "the-same-phone-1234"));
        Assert.False(Try(limiter, "10.0.0.99", "the-same-phone-1234"));
        Assert.True(Try(limiter, "10.0.0.99", "another-phone-5678"));
    }

    [Fact]
    public void A_day_has_a_ceiling_of_its_own()
    {
        using var limiter = new HymnIdentifyLimiter(Settings(perMinute: 100, perDay: 3));

        for (var i = 0; i < 3; i++)
            Assert.True(Try(limiter, "1.2.3.4", "browser-abcdefgh"));
        Assert.False(Try(limiter, "1.2.3.4", "browser-abcdefgh"));
        Assert.False(Try(limiter, "9.9.9.9", "browser-abcdefgh")); // the device's day too
    }

    [Fact]
    public void Switching_rate_limiting_off_lifts_these_limits_too()
    {
        using var limiter = new HymnIdentifyLimiter(
            new RateLimitSettings { Enabled = false, TrustedProxyHops = 0, HymnIdentifyPermits = 1, HymnIdentifyDailyPermits = 1 }.Disabled());

        for (var i = 0; i < 50; i++)
            Assert.True(Try(limiter, "1.2.3.4", "browser-abcdefgh"));
    }

    [Fact]
    public async Task A_refused_try_is_a_429_with_retry_after_in_the_usual_envelope_and_the_action_never_runs()
    {
        using var limiter = new HymnIdentifyLimiter(Settings(perMinute: 1));
        var services = new ServiceCollection().AddSingleton(limiter).BuildServiceProvider();
        var filter = new HymnIdentifyRateLimitAttribute();

        var first = Context(services, "1.2.3.4");
        var ran = 0;
        await filter.OnResourceExecutionAsync(first, () => { ran++; return Task.FromResult<ResourceExecutedContext>(null!); });
        Assert.Equal(1, ran);

        var second = Context(services, "1.2.3.4");
        second.HttpContext.Response.Body = new MemoryStream();
        await filter.OnResourceExecutionAsync(second, () => { ran++; return Task.FromResult<ResourceExecutedContext>(null!); });

        Assert.Equal(1, ran);
        Assert.Equal(StatusCodes.Status429TooManyRequests, second.HttpContext.Response.StatusCode);
        Assert.True(int.Parse(second.HttpContext.Response.Headers.RetryAfter.ToString()) > 0);
        second.HttpContext.Response.Body.Position = 0;
        using var body = await JsonDocument.ParseAsync(second.HttpContext.Response.Body);
        Assert.Equal("RATE_LIMITED", body.RootElement.GetProperty("code").GetString());
        Assert.StartsWith("You've tried a lot of tunes", body.RootElement.GetProperty("message").GetString());
    }

    private static RateLimitSettings Settings(int perMinute = 5, int perDay = 20)
        => new() { TrustedProxyHops = 0, HymnIdentifyPermits = perMinute, HymnIdentifyDailyPermits = perDay };

    private static bool Try(HymnIdentifyLimiter limiter, string address, string? device)
    {
        var http = new DefaultHttpContext();
        http.Connection.RemoteIpAddress = IPAddress.Parse(address);
        if (device is not null)
            http.Request.Headers["X-Device-Id"] = device;
        using var lease = limiter.Acquire(http);
        return lease.IsAcquired;
    }

    private static ResourceExecutingContext Context(IServiceProvider services, string address)
    {
        var http = new DefaultHttpContext { RequestServices = services };
        http.Connection.RemoteIpAddress = IPAddress.Parse(address);
        var action = new ActionContext(http, new RouteData(), new ActionDescriptor());
        return new ResourceExecutingContext(action, [], []);
    }

    private static TranscriptionApiClient Client(HttpMessageHandler handler)
        => new(new HttpClient(handler) { BaseAddress = new Uri("http://worker/") }, new ConfigurationBuilder().Build(), NullLogger<TranscriptionApiClient>.Instance);

    private sealed class RecordingApi(Result<HymnIdentificationDto> answer) : ITranscriptionApi
    {
        public string? LastFileName { get; private set; }

        public Task<Result<HymnIdentificationDto>> IdentifyHymnAsync(Stream audio, string fileName, CancellationToken ct = default)
        {
            LastFileName = fileName;
            return Task.FromResult(answer);
        }

        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, double? maxTakeSeconds = null, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<int>> PingAsync(CancellationToken ct = default) => throw new NotSupportedException();
    }
}
