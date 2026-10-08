using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Api;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// The worker's JSON as pydantic spells it, read by the source-generated context. Case matters:
/// <c>parts_musicxml</c> comes over as <c>partsMusicxml</c> (lower x), which the camelCase policy would
/// never derive, so the field is named by hand and this pins it.
/// </summary>
public class WorkerContractTests
{
    [Fact]
    public void A_job_result_keeps_the_four_part_score_and_the_parts()
    {
        const string payload = """
            {"status":"done","progress":1.0,"stage":null,"source":null,"error":null,
             "result":{"key":"C major","keyConfidence":0.9,"tempo":100,"timeSignature":"4/4","musicxml":"<s/>","midiBase64":"",
                       "notes":[{"pitchMidi":60,"startBeat":0.0,"durBeats":1.0,"degree":1,"solfa":"d","octaveMark":"","conf":0.9}],
                       "solfaLines":["Doh is C"],"overallConfidence":0.9,
                       "parts":{"alto":{"notes":[{"pitchMidi":55,"startBeat":0.0,"durBeats":1.0,"degree":5,"solfa":"s","octaveMark":"","conf":1.0}],"solfaLines":["Doh is C","| s |"]}},
                       "partsMusicxml":"<satb/>"}}
            """;

        var job = JsonSerializer.Deserialize(payload, ApiJsonContext.Default.JobResponse)!;

        Assert.Equal("<satb/>", job.Result!.PartsMusicXml);
        Assert.Equal(55, job.Result.Parts!["alto"].Notes[0].PitchMidi);
        Assert.Equal("<s/>", job.Result.MusicXml);
    }

    [Fact]
    public void A_choir_result_says_its_parts_were_heard()
    {
        const string payload = """
            {"status":"done","result":{"key":"C major","keyConfidence":0.9,"tempo":84,"timeSignature":"4/4","musicxml":"<s/>","midiBase64":"",
             "notes":[],"solfaLines":[],"overallConfidence":0.9,"partsSource":"heard"}}
            """;

        var job = JsonSerializer.Deserialize(payload, ApiJsonContext.Default.JobResponse)!;

        Assert.Equal("heard", job.Result!.PartsSource);
    }

    [Fact]
    public async Task Choir_mode_reaches_the_worker_as_choir()
    {
        var handler = new CapturingHandler();
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://worker/") };
        var client = new TranscriptionApiClient(http, new ConfigurationBuilder().Build(), NullLogger<TranscriptionApiClient>.Instance);

        await client.SubmitAsync(new MemoryStream([1, 2, 3]), "choir.wav", new TranscribeOptions { Mode = TranscriptionMode.Choir });

        Assert.Contains("name=mode", handler.Body);
        Assert.Contains("choir", handler.Body);
        Assert.DoesNotContain("melody", handler.Body);
    }

    [Fact]
    public async Task A_job_results_chords_come_through_as_the_worker_named_them()
    {
        const string payload = """
            {"status":"done","progress":1.0,
             "result":{"key":"A major","keyConfidence":0.8,"tempo":96,"timeSignature":"4/4","musicxml":"<s/>","midiBase64":"",
                       "notes":[],"solfaLines":[],"overallConfidence":0.8,
                       "chords":[{"startBeat":0.0,"durBeats":4.0,"root":6,"quality":"min","bass":null,"symbol":"F#m","solfa":"l"},
                                 {"startBeat":4.0,"durBeats":2.0,"root":11,"quality":"maj","bass":3,"symbol":"B/D#","solfa":"r"}],
                       "chordsSource":"heard"}}
            """;
        var client = Client(StubHttpMessageHandler.Returning(HttpStatusCode.OK, payload));

        var job = await client.GetJobAsync("j1");

        var result = job.Value.Result!;
        Assert.Equal("heard", result.ChordsSource);
        Assert.Equal(
            [new ChordSymbolDto(0, 4, 6, "min", null, "F#m", "l"), new ChordSymbolDto(4, 2, 11, "maj", 3, "B/D#", "r")],
            result.Chords!);
    }

    [Fact]
    public async Task A_result_without_chords_says_so()
    {
        const string payload = """
            {"status":"done","result":{"key":"C major","keyConfidence":0.9,"tempo":84,"timeSignature":"4/4","musicxml":"<s/>","midiBase64":"",
             "notes":[],"solfaLines":[],"overallConfidence":0.9}}
            """;

        var job = await Client(StubHttpMessageHandler.Returning(HttpStatusCode.OK, payload)).GetJobAsync("j1");

        Assert.Null(job.Value.Result!.Chords);
        Assert.Null(job.Value.Result.ChordsSource);
    }

    [Fact]
    public async Task Chords_mode_and_the_keyboards_transpose_reach_the_worker()
    {
        var handler = new CapturingHandler();
        var client = new TranscriptionApiClient(new HttpClient(handler) { BaseAddress = new Uri("http://worker/") }, new ConfigurationBuilder().Build(), NullLogger<TranscriptionApiClient>.Instance);

        await client.SubmitAsync(new MemoryStream([1, 2, 3]), "keys.wav", new TranscribeOptions { Mode = TranscriptionMode.Chords, KeyboardTranspose = -4 });

        Assert.Equal("chords", FormField(handler.Body, "mode"));
        Assert.Equal("-4", FormField(handler.Body, "keyboard_transpose"));

        await client.SubmitLinkAsync("https://youtu.be/dQw4w9WgXcQ", new TranscribeOptions { KeyboardTranspose = 3 });
        Assert.Equal("3", FormField(handler.Body, "keyboard_transpose"));
    }

    [Fact]
    public async Task No_keyboard_transpose_is_sent_when_it_is_off_or_for_a_score()
    {
        var handler = new CapturingHandler();
        var client = new TranscriptionApiClient(new HttpClient(handler) { BaseAddress = new Uri("http://worker/") }, new ConfigurationBuilder().Build(), NullLogger<TranscriptionApiClient>.Instance);

        await client.SubmitAsync(new MemoryStream([1, 2, 3]), "hum.wav", new TranscribeOptions());
        Assert.DoesNotContain("keyboard_transpose", handler.Body);

        await client.SubmitScoreAsync(new MemoryStream([1, 2, 3]), "song.musicxml", new TranscribeOptions { KeyboardTranspose = 2 });
        Assert.DoesNotContain("keyboard_transpose", handler.Body);
    }

    [Fact]
    public async Task A_link_sends_its_length_cap_once()
    {
        var handler = new CapturingHandler();
        var client = new TranscriptionApiClient(new HttpClient(handler) { BaseAddress = new Uri("http://worker/") }, new ConfigurationBuilder().Build(), NullLogger<TranscriptionApiClient>.Instance);

        await client.SubmitLinkAsync("https://youtu.be/dQw4w9WgXcQ", new TranscribeOptions { MaxSeconds = 60 });

        Assert.Single(System.Text.RegularExpressions.Regex.Matches(handler.Body, "name=max_seconds"));
        Assert.Equal("60", FormField(handler.Body, "max_seconds"));
    }

    [Fact]
    public async Task A_link_the_worker_refuses_comes_back_as_a_plain_invalid_link()
    {
        var client = Client(StubHttpMessageHandler.Returning(
            HttpStatusCode.UnprocessableEntity, """{"detail":"url must be a YouTube video, Spotify track or Apple Music song"}"""));

        var result = await client.SubmitLinkAsync("https://spotify.link/qKr2CFxMQwb", new TranscribeOptions());

        Assert.True(result.IsFailure);
        Assert.Equal(TranscriptionErrors.InvalidLink, result.Error);
        Assert.DoesNotContain("422", result.Error.Message);
        Assert.DoesNotContain("detail", result.Error.Message);
    }

    [Theory]
    [InlineData("live", "TRANS_LINK_LIVE")]
    [InlineData("not_found", "TRANS_LINK_NOT_FOUND")]
    [InlineData("unavailable", "TRANS_LINK_UNAVAILABLE")]
    [InlineData("refused", "TRANS_LINK_REFUSED")]
    public async Task A_reason_the_worker_names_by_code_is_told_in_our_own_words(string code, string expected)
    {
        var body = $$$"""{"detail":{"message":"the worker's own sentence","code":"{{{code}}}"}}""";

        var submitted = await Client(StubHttpMessageHandler.Returning(HttpStatusCode.UnprocessableEntity, body))
            .SubmitLinkAsync("https://youtu.be/dQw4w9WgXcQ", new TranscribeOptions());
        var resolved = await Client(StubHttpMessageHandler.Returning(HttpStatusCode.UnprocessableEntity, body))
            .ResolveLinkAsync("https://youtu.be/dQw4w9WgXcQ");

        Assert.Equal(expected, submitted.Error.Code);
        Assert.Equal(expected, resolved.Error.Code);
        Assert.Equal(ErrorType.Validation, submitted.Error.Type);
        Assert.DoesNotContain("worker's own sentence", submitted.Error.Message);
        Assert.DoesNotContain("worker's own sentence", resolved.Error.Message);
    }

    [Fact]
    public async Task A_video_over_the_cap_is_told_with_the_cap_and_an_unknown_code_is_an_invalid_link()
    {
        var tooLong = await Client(StubHttpMessageHandler.Returning(HttpStatusCode.UnprocessableEntity,
                """{"detail":{"message":"That video runs 3 hours.","code":"too_long","limit_seconds":7200.0}}"""))
            .ResolveLinkAsync("https://youtu.be/dQw4w9WgXcQ");
        var unknown = await Client(StubHttpMessageHandler.Returning(HttpStatusCode.UnprocessableEntity,
                """{"detail":{"message":"something new","code":"novel"}}"""))
            .SubmitLinkAsync("https://youtu.be/dQw4w9WgXcQ", new TranscribeOptions());

        Assert.Equal("TRANS_LINK_TOO_LONG", tooLong.Error.Code);
        Assert.Contains("up to 2 hours", tooLong.Error.Message);
        Assert.DoesNotContain("3 hours", tooLong.Error.Message);
        Assert.Equal(TranscriptionErrors.InvalidLink, unknown.Error);
    }

    [Fact]
    public async Task A_chosen_section_reaches_the_worker_and_an_unchosen_one_is_not_sent()
    {
        var handler = new CapturingHandler();
        var client = new TranscriptionApiClient(new HttpClient(handler) { BaseAddress = new Uri("http://worker/") }, new ConfigurationBuilder().Build(), NullLogger<TranscriptionApiClient>.Instance);

        await client.SubmitLinkAsync("https://youtu.be/dQw4w9WgXcQ", new TranscribeOptions { MaxSeconds = 360, StartSeconds = 65, EndSeconds = 95.5 });
        Assert.Equal("65", FormField(handler.Body, "start_seconds"));
        Assert.Equal("95.5", FormField(handler.Body, "end_seconds"));
        Assert.Equal("360", FormField(handler.Body, "max_seconds"));

        await client.SubmitLinkAsync("https://youtu.be/dQw4w9WgXcQ", new TranscribeOptions { MaxSeconds = 60 });
        Assert.DoesNotContain("start_seconds", handler.Body);
        Assert.DoesNotContain("end_seconds", handler.Body);
    }

    [Theory]
    [InlineData("""{"provider":"youtube","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","title":"Way Maker","artist":"Sinach","thumbnail_url":"https://i.ytimg.com/vi/x/hq.jpg","duration_seconds":213.0}""")]
    [InlineData("""{"provider":"youtube","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","title":"Way Maker","artist":"Sinach","thumbnailUrl":"https://i.ytimg.com/vi/x/hq.jpg","durationSeconds":213}""")]
    public async Task A_resolved_link_is_read_in_either_spelling(string payload)
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, payload);

        var source = await Client(handler).ResolveLinkAsync("https://youtu.be/dQw4w9WgXcQ");

        Assert.True(source.IsSuccess);
        Assert.Equal("Way Maker", source.Value.Title);
        Assert.Equal("Sinach", source.Value.Artist);
        Assert.Equal("https://i.ytimg.com/vi/x/hq.jpg", source.Value.ThumbnailUrl);
        Assert.Equal(213, source.Value.DurationSeconds);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("http://worker/v1/links/resolve", request.Uri!.ToString());
        Assert.Equal("""{"url":"https://youtu.be/dQw4w9WgXcQ"}""", request.Body);
    }

    [Fact]
    public async Task A_resolved_link_without_a_length_says_so()
    {
        const string payload = """{"provider":"spotify","url":"https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT","title":"Never Gonna Give You Up","artist":"Rick Astley","thumbnail_url":null,"duration_seconds":null}""";

        var source = await Client(StubHttpMessageHandler.Returning(HttpStatusCode.OK, payload)).ResolveLinkAsync("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT");

        Assert.Null(source.Value.DurationSeconds);
        Assert.Null(source.Value.ThumbnailUrl);
    }

    [Fact]
    public async Task A_link_the_worker_cannot_resolve_is_an_invalid_link_and_a_worker_that_is_away_is_said_so_plainly()
    {
        var refused = await Client(StubHttpMessageHandler.Returning(HttpStatusCode.UnprocessableEntity, """{"detail":"could not read the page"}"""))
            .ResolveLinkAsync("https://spotify.link/qKr2CFxMQwb");
        var broken = await Client(StubHttpMessageHandler.Returning(HttpStatusCode.InternalServerError, "Traceback (most recent call last)"))
            .ResolveLinkAsync("https://youtu.be/dQw4w9WgXcQ");
        var away = await Client(StubHttpMessageHandler.Throwing(new HttpRequestException("Connection refused")))
            .ResolveLinkAsync("https://youtu.be/dQw4w9WgXcQ");

        Assert.Equal(TranscriptionErrors.InvalidLink, refused.Error);
        Assert.Equal(TranscriptionErrors.ServiceUnavailable, broken.Error);
        Assert.Equal(TranscriptionErrors.ServiceUnavailable, away.Error);
        Assert.DoesNotContain("Traceback", broken.Error.Message);
        Assert.DoesNotContain("refused", away.Error.Message);
    }

    [Fact]
    public async Task A_jobs_source_carries_the_section_and_the_songs_length()
    {
        const string payload = """
            {"status":"processing","progress":0.3,"stage":"fetching","queuePosition":null,
             "source":{"provider":"youtube","url":"https://youtu.be/dQw4w9WgXcQ","title":"Way Maker","artist":"Sinach","thumbnailUrl":null,
                       "startSeconds":65.0,"endSeconds":95.0,"durationSeconds":213.0}}
            """;

        var job = await Client(StubHttpMessageHandler.Returning(HttpStatusCode.OK, payload)).GetJobAsync("j1");

        var source = job.Value.Source!;
        Assert.Equal(65, source.StartSeconds);
        Assert.Equal(95, source.EndSeconds);
        Assert.Equal(213, source.DurationSeconds);
        Assert.Null(source.Preview);

        // Written by the client's own DTO serialiser and read back, as the result cache does.
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var json = JsonSerializer.Serialize(source, options);
        Assert.Contains("\"startSeconds\":65", json);
        Assert.Contains("\"durationSeconds\":213", json);
        Assert.Equal(source, JsonSerializer.Deserialize<SourceDto>(json, options));
    }

    [Fact]
    public async Task A_source_from_before_sections_reads_with_none()
    {
        const string payload = """{"status":"processing","source":{"provider":"youtube","url":"https://youtu.be/x","title":"T","artist":"A","thumbnailUrl":null}}""";

        var job = await Client(StubHttpMessageHandler.Returning(HttpStatusCode.OK, payload)).GetJobAsync("j1");

        Assert.Null(job.Value.Source!.StartSeconds);
        Assert.Null(job.Value.Source.EndSeconds);
        Assert.Null(job.Value.Source.DurationSeconds);
    }

    private static TranscriptionApiClient Client(HttpMessageHandler handler)
        => new(new HttpClient(handler) { BaseAddress = new Uri("http://worker/") }, new ConfigurationBuilder().Build(), NullLogger<TranscriptionApiClient>.Instance);

    /// <summary>The value of one multipart form field, as the request body spelled it.</summary>
    private static string? FormField(string body, string name)
    {
        var match = System.Text.RegularExpressions.Regex.Match(
            body, $"name={name}\\r?\\n(?:[^\\r\\n]+\\r?\\n)*\\r?\\n([^\\r\\n]*)");
        return match.Success ? match.Groups[1].Value : null;
    }

    private sealed class CapturingHandler : HttpMessageHandler
    {
        public string Body { get; private set; } = "";

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Body = await request.Content!.ReadAsStringAsync(ct);
            return new HttpResponseMessage(HttpStatusCode.Accepted) { Content = new StringContent("""{"jobId":"j1"}""") };
        }
    }

    [Fact]
    public void A_harmonise_answer_keeps_the_four_part_score()
    {
        const string payload = """{"parts":{"bass":{"notes":[],"solfaLines":[]}},"partsMusicxml":"<satb/>"}""";

        var answer = JsonSerializer.Deserialize(payload, ApiJsonContext.Default.HarmoniseResponse)!;

        Assert.Equal("<satb/>", answer.PartsMusicXml);
        Assert.Equal(["bass"], answer.Parts!.Keys);
    }
}

public sealed class QueuedJobContractTests
{
    [Fact]
    public void A_waiting_job_carries_its_place_in_line()
    {
        const string payload = """{"status":"pending","progress":0.0,"stage":"queued","queuePosition":2}""";
        var job = JsonSerializer.Deserialize(payload, ApiJsonContext.Default.JobResponse)!;
        Assert.Equal("queued", job.Stage);
        Assert.Equal(2, job.QueuePosition);
    }
}

public sealed class UnreachableWorkerTests
{
    [Fact]
    public async Task A_worker_that_cannot_be_reached_is_reported_in_plain_words()
    {
        var handler = new ThrowingHandler(new HttpRequestException("Name or service not known (transcriber:8000)"));
        var client = new TranscriptionApiClient(new HttpClient(handler) { BaseAddress = new Uri("http://worker/") }, new ConfigurationBuilder().Build(), NullLogger<TranscriptionApiClient>.Instance);
        var result = await client.GetJobAsync("job-1");
        Assert.True(result.IsFailure);
        Assert.Equal("The transcription service is unavailable. Try again shortly.", result.Error.Message);
        Assert.DoesNotContain("transcriber", result.Error.Message);
    }

    private sealed class ThrowingHandler(Exception ex) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => throw ex;
    }
}
