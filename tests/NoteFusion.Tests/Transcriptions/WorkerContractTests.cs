using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Api;

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
