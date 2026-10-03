using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Api;
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
        var client = new TranscriptionApiClient(http, new ConfigurationBuilder().Build());

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
        var client = new TranscriptionApiClient(new HttpClient(handler) { BaseAddress = new Uri("http://worker/") }, new ConfigurationBuilder().Build());

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
        var client = new TranscriptionApiClient(new HttpClient(handler) { BaseAddress = new Uri("http://worker/") }, new ConfigurationBuilder().Build());

        await client.SubmitAsync(new MemoryStream([1, 2, 3]), "hum.wav", new TranscribeOptions());
        Assert.DoesNotContain("keyboard_transpose", handler.Body);

        await client.SubmitScoreAsync(new MemoryStream([1, 2, 3]), "song.musicxml", new TranscribeOptions { KeyboardTranspose = 2 });
        Assert.DoesNotContain("keyboard_transpose", handler.Body);
    }

    [Fact]
    public async Task A_link_sends_its_length_cap_once()
    {
        var handler = new CapturingHandler();
        var client = new TranscriptionApiClient(new HttpClient(handler) { BaseAddress = new Uri("http://worker/") }, new ConfigurationBuilder().Build());

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

    private static TranscriptionApiClient Client(HttpMessageHandler handler)
        => new(new HttpClient(handler) { BaseAddress = new Uri("http://worker/") }, new ConfigurationBuilder().Build());

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
