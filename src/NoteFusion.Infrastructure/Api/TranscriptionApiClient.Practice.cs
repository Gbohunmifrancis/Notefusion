using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Infrastructure.Http;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Api;

/// <summary>
/// The worker's practice graders, on the transcription client's own HttpClient (and so its key, correlation id,
/// timeouts and breaker): a take and a target posted as a form, the answer mapped to the Application's shapes.
/// Failures read as <see cref="ITranscriptionApi.GradeAsync"/>'s do: a plain sentence, never the worker's text.
/// </summary>
internal sealed partial class TranscriptionApiClient : IPracticeAudioApi
{
    public async Task<Result<GradeResultDto>> GradeNotesAsync(
        Stream audio, string fileName, GradeTargetDto target, double maxTakeSeconds, double? offsetSearchSeconds = null,
        CancellationToken cancellationToken = default)
    {
        var wire = new GradeTarget(
            target.Notes.Select(n => new GradeTargetNote(n.PitchMidi, n.StartBeat, n.DurBeats)).ToList(),
            target.TempoBpm, target.LeadInSec, maxTakeSeconds, offsetSearchSeconds);
        var answer = await PostTakeAsync(
            "Api.Grade", "v1/grade", audio, fileName, JsonSerializer.Serialize(wire, ApiJsonContext.Default.GradeTarget),
            ApiJsonContext.Default.GradeResponse, cancellationToken);
        if (answer.IsFailure)
            return answer.Error;
        var p = answer.Value;
        return new GradeResultDto(
            p.Score, p.Hits, p.Near, p.Wrong, p.Missed, p.TuningCents, p.OffsetSec, p.OctaveShift, p.Summary,
            p.Notes.Select(n => new GradeNoteDto(n.Index, n.TargetMidi, n.SungMidi, n.Cents, n.Status)).ToList());
    }

    public async Task<Result<RunGradeDto>> GradeRunAsync(
        Stream audio, string fileName, GradeTargetDto target, double maxTakeSeconds, CancellationToken cancellationToken = default)
    {
        var wire = new GradeTarget(
            target.Notes.Select(n => new GradeTargetNote(n.PitchMidi, n.StartBeat, n.DurBeats)).ToList(),
            target.TempoBpm, target.LeadInSec, maxTakeSeconds);
        var answer = await PostTakeAsync(
            "Api.GradeRun", "v1/grade/run", audio, fileName, JsonSerializer.Serialize(wire, ApiJsonContext.Default.GradeTarget),
            ApiJsonContext.Default.RunGradeResponse, cancellationToken);
        if (answer.IsFailure)
            return answer.Error;
        var p = answer.Value;
        return new RunGradeDto(
            p.Score, p.Followed, p.RunNotes, p.LandingStatus, p.LandingCents, p.LandingMidi, p.OffsetSec, p.OctaveShift, p.Summary,
            p.Notes.Select(n => new RunNoteMarkDto(n.Index, n.TargetMidi, n.Followed, n.Status)).ToList(),
            p.Trace.Select(t => new TracePointDto(t.T, t.Midi)).ToList());
    }

    public async Task<Result<RhythmGradeDto>> GradeRhythmAsync(
        Stream audio, string fileName, IReadOnlyList<double> beats, double tempoBpm, double leadInSec, double maxTakeSeconds,
        CancellationToken cancellationToken = default)
    {
        var wire = new RhythmTarget(beats, tempoBpm, leadInSec, maxTakeSeconds);
        var answer = await PostTakeAsync(
            "Api.GradeRhythm", "v1/grade/rhythm", audio, fileName, JsonSerializer.Serialize(wire, ApiJsonContext.Default.RhythmTarget),
            ApiJsonContext.Default.RhythmGradeResponse, cancellationToken);
        if (answer.IsFailure)
            return answer.Error;
        var p = answer.Value;
        return new RhythmGradeDto(
            p.Score, p.Hits, p.Near, p.Missed, p.Extra, p.OffsetSec, p.TempoRatio, p.Summary,
            p.Claps.Select(c => new ClapMarkDto(c.Index, c.Beat, c.ErrorMs, c.Status)).ToList());
    }

    public async Task<Result<RangeReadingDto>> ReadRangeAsync(Stream audio, string fileName, CancellationToken cancellationToken = default)
    {
        var answer = await PostTakeAsync("Api.Range", "v1/range", audio, fileName, null, ApiJsonContext.Default.RangeResponse, cancellationToken);
        if (answer.IsFailure)
            return answer.Error;
        var p = answer.Value;
        static HeldNoteReading? Held(WireHold? h) => h is null ? null : new HeldNoteReading(h.Midi, h.Cents, h.Seconds);
        return new RangeReadingDto(Held(p.Lowest), Held(p.Highest), p.Holds.Count, p.SecondsHeard);
    }

    /// <summary>A take (and its target, as JSON, when there is one) posted to the worker; its answer read as <typeparamref name="T"/>.</summary>
    private async Task<Result<T>> PostTakeAsync<T>(
        string code, string path, Stream audio, string fileName, string? targetJson, JsonTypeInfo<T> answerType, CancellationToken ct)
        where T : class
    {
        try
        {
            using var form = new MultipartFormDataContent();
            var audioContent = new StreamContent(audio);
            var safeName = string.IsNullOrWhiteSpace(fileName) || !Path.HasExtension(fileName) ? "take.m4a" : Path.GetFileName(fileName);
            audioContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
            form.Add(audioContent, "audio", safeName);
            if (targetJson is not null)
                form.Add(new StringContent(targetJson), "target");

            using var response = await http.PostAsync(path, form, ct);
            if (!response.IsSuccessStatusCode)
                return await RejectedAsync(code, response, ct);
            var payload = await response.Content.ReadFromJsonAsync(answerType, ct);
            if (payload is null)
                return Error.Failure(code, "Transcription service returned an empty response.");
            return payload;
        }
        catch (HttpRequestException ex)
        {
            return Unreachable(code, ex);
        }
        catch (JsonException ex)
        {
            return Unreachable(code, ex);
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, ct))
        {
            return Unreachable(code, ex);
        }
    }
}
