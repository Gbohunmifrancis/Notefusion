using System.Net.Http.Json;

using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Api;

/// <summary>
/// HTTP client for the transcription API (TRD §6). Network failures are returned as
/// <see cref="ErrorType.Network"/> results — connectivity drops are an expected condition
/// in the target market, not an exceptional one.
/// </summary>
internal sealed class TranscriptionApiClient(HttpClient http, Microsoft.Extensions.Configuration.IConfiguration config) : ITranscriptionApi
{
    public async Task<Result<string>> SubmitAsync(
        Stream audio,
        string fileName,
        TranscribeOptions options,
        CancellationToken cancellationToken = default)
    {
        try
        {
            using var form = new MultipartFormDataContent();
            var audioContent = new StreamContent(audio);
            var safeName = string.IsNullOrWhiteSpace(fileName) || !Path.HasExtension(fileName) ? "clip.m4a" : fileName;
            var ext = Path.GetExtension(safeName).ToLowerInvariant();
            var contentType = ext switch
            {
                ".mp3" => "audio/mpeg",
                ".wav" => "audio/wav",
                ".ogg" => "audio/ogg",
                ".flac" => "audio/flac",
                _ => "audio/m4a"
            };
            audioContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
            form.Add(audioContent, "audio", safeName);

            AddOptions(form, options, withMode: true);

            using var response = await http.PostAsync("v1/transcribe", form, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var errText = await response.Content.ReadAsStringAsync(cancellationToken);
                return Error.Failure("Api.Submit", $"Transcription service returned {(int)response.StatusCode}: {errText}");
            }

            var payload = await response.Content.ReadFromJsonAsync(
                ApiJsonContext.Default.SubmitResponse, cancellationToken);

            return payload is null
                ? Error.Failure("Api.Submit", "Transcription service returned an empty response.")
                : payload.JobId;
        }
        catch (HttpRequestException ex)
        {
            return Error.Network("Api.Submit", $"Could not reach the transcription service: {ex.Message}");
        }
    }

    public async Task<Result<string>> SubmitScoreAsync(
        Stream score,
        string fileName,
        TranscribeOptions options,
        CancellationToken cancellationToken = default)
    {
        try
        {
            using var form = new MultipartFormDataContent();
            var scoreContent = new StreamContent(score);
            var safeName = string.IsNullOrWhiteSpace(fileName) || !Path.HasExtension(fileName) ? "score.musicxml" : fileName;
            var ext = Path.GetExtension(safeName).ToLowerInvariant();
            var contentType = ext switch
            {
                ".mid" or ".midi" => "audio/midi",
                ".xml" or ".musicxml" => "application/xml",
                ".mxl" => "application/vnd.recordare.musicxml",
                ".abc" => "text/plain",
                _ => "application/octet-stream"
            };
            scoreContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
            form.Add(scoreContent, "score", safeName);

            AddOptions(form, options, withMode: false);

            using var response = await http.PostAsync("v1/transcribe/score", form, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var errText = await response.Content.ReadAsStringAsync(cancellationToken);
                return Error.Failure("Api.SubmitScore", $"Transcription service returned {(int)response.StatusCode}: {errText}");
            }

            var payload = await response.Content.ReadFromJsonAsync(
                ApiJsonContext.Default.SubmitResponse, cancellationToken);

            return payload is null
                ? Error.Failure("Api.SubmitScore", "Transcription service returned an empty response.")
                : payload.JobId;
        }
        catch (HttpRequestException ex)
        {
            return Error.Network("Api.SubmitScore", $"Could not reach the transcription service: {ex.Message}");
        }
    }

    public async Task<Result<GradeResultDto>> GradeAsync(
        Stream audio,
        string fileName,
        GradeTargetDto target,
        CancellationToken cancellationToken = default)
    {
        try
        {
            using var form = new MultipartFormDataContent();
            var audioContent = new StreamContent(audio);
            var safeName = string.IsNullOrWhiteSpace(fileName) || !Path.HasExtension(fileName) ? "take.m4a" : fileName;
            audioContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
            form.Add(audioContent, "audio", safeName);
            var wireTarget = new GradeTarget(
                target.Notes.Select(n => new GradeTargetNote(n.PitchMidi, n.StartBeat, n.DurBeats)).ToList(),
                target.TempoBpm, target.LeadInSec);
            form.Add(new StringContent(System.Text.Json.JsonSerializer.Serialize(wireTarget, ApiJsonContext.Default.GradeTarget)), "target");

            using var response = await http.PostAsync("v1/grade", form, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var errText = await response.Content.ReadAsStringAsync(cancellationToken);
                return Error.Failure("Api.Grade", $"Transcription service returned {(int)response.StatusCode}: {errText}");
            }
            var payload = await response.Content.ReadFromJsonAsync(ApiJsonContext.Default.GradeResponse, cancellationToken);
            if (payload is null)
                return Error.Failure("Api.Grade", "Transcription service returned an empty response.");
            return new GradeResultDto(
                payload.Score, payload.Hits, payload.Near, payload.Wrong, payload.Missed, payload.TuningCents,
                payload.OffsetSec, payload.OctaveShift, payload.Summary,
                payload.Notes.Select(n => new GradeNoteDto(n.Index, n.TargetMidi, n.SungMidi, n.Cents, n.Status)).ToList());
        }
        catch (HttpRequestException ex)
        {
            return Error.Network("Api.Grade", $"Could not reach the transcription service: {ex.Message}");
        }
    }

    public async Task<Result<string>> SubmitLinkAsync(
        string url,
        TranscribeOptions options,
        CancellationToken cancellationToken = default)
    {
        try
        {
            using var form = new MultipartFormDataContent();
            form.Add(new StringContent(url), "url");
            AddOptions(form, options, withMode: true);
            if (options.MaxSeconds is { } cap)
                form.Add(new StringContent(cap.ToString(System.Globalization.CultureInfo.InvariantCulture)), "max_seconds");

            using var response = await http.PostAsync("v1/transcribe/link", form, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var errText = await response.Content.ReadAsStringAsync(cancellationToken);
                return Error.Failure("Api.SubmitLink", $"Transcription service returned {(int)response.StatusCode}: {errText}");
            }

            var payload = await response.Content.ReadFromJsonAsync(
                ApiJsonContext.Default.SubmitResponse, cancellationToken);

            return payload is null
                ? Error.Failure("Api.SubmitLink", "Transcription service returned an empty response.")
                : payload.JobId;
        }
        catch (HttpRequestException ex)
        {
            return Error.Network("Api.SubmitLink", $"Could not reach the transcription service: {ex.Message}");
        }
    }

    /// <summary>The form fields every submit shares: options, lane, and the completion callback.</summary>
    private void AddOptions(MultipartFormDataContent form, TranscribeOptions options, bool withMode)
    {
        if (withMode)
            form.Add(new StringContent(options.Mode == TranscriptionMode.Poly ? "poly" : "melody"), "mode");
        if (!string.IsNullOrWhiteSpace(options.Key) && !options.Key.Equals("Auto", StringComparison.OrdinalIgnoreCase))
            form.Add(new StringContent(options.Key), "key");
        if (options.Tempo is not null)
            form.Add(new StringContent(options.Tempo.Value.ToString()), "tempo");
        if (!string.IsNullOrWhiteSpace(options.TimeSignature) && !options.TimeSignature.Equals("Auto", StringComparison.OrdinalIgnoreCase))
            form.Add(new StringContent(options.TimeSignature), "time_signature");
        form.Add(new StringContent(options.Priority == TranscribePriority.High ? "high" : "normal"), "priority");
        if (options.Separate)
            form.Add(new StringContent("true"), "separate");
        if (!options.AudioPreview)
            form.Add(new StringContent("false"), "audio_preview");
        if (withMode && options.MaxSeconds is { } cap)
            form.Add(new StringContent(cap.ToString(System.Globalization.CultureInfo.InvariantCulture)), "max_seconds");

        var baseUrl = config["TranscriptionApi:WebhookBaseUrl"] ?? "http://api:8080";
        var callbackUrl = $"{baseUrl.TrimEnd('/')}/api/internal/webhooks/transcription/{{job_id}}";
        form.Add(new StringContent(callbackUrl), "callback_url");
    }

    public async Task<Result<TranscriptionJobDto>> GetJobAsync(
        string jobId,
        CancellationToken cancellationToken = default)
    {
        try
        {
            using var response = await http.GetAsync($"v1/jobs/{jobId}", cancellationToken);
            // A 404 is the worker not knowing the job at all — it restarted (the queue is in memory) or
            // the job expired — which the caller treats differently from the worker being unwell.
            if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
                return Error.NotFound("Api.Job", "The transcription service no longer has this job.");
            if (!response.IsSuccessStatusCode)
                return Error.Failure("Api.Job", $"Transcription service returned {(int)response.StatusCode}.");

            var payload = await response.Content.ReadFromJsonAsync(
                ApiJsonContext.Default.JobResponse, cancellationToken);

            return payload is null
                ? Error.Failure("Api.Job", "Transcription service returned an empty response.")
                : MapJob(jobId, payload);
        }
        catch (HttpRequestException ex)
        {
            return Error.Network("Api.Job", $"Could not reach the transcription service: {ex.Message}");
        }
    }

    public async Task<Result<int>> PingAsync(CancellationToken cancellationToken = default)
    {
        // Short of the client's 100-second transcription timeout by a wide margin: a health page that
        // hangs for a minute and a half on a dead worker has already failed at its job. The worker either
        // answers this in milliseconds or it is not answering.
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();

        try
        {
            using var response = await http.GetAsync("healthz", timeout.Token);
            return response.IsSuccessStatusCode
                ? (int)stopwatch.ElapsedMilliseconds
                : Error.Failure("Api.Ping", $"Transcription service returned {(int)response.StatusCode}.");
        }
        catch (HttpRequestException ex)
        {
            return Error.Network("Api.Ping", $"Could not reach the transcription service: {ex.Message}");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // Our own five seconds, not the caller giving up. A worker this slow to answer a static
            // handler is one that cannot take a job either, so it is reported as unreachable rather than
            // as a latency figure.
            return Error.Network("Api.Ping", "The transcription service did not answer within 5 seconds.");
        }
    }

    private static Result<TranscriptionJobDto> MapJob(string jobId, JobResponse wire)
    {
        var status = wire.Status.ToLowerInvariant() switch
        {
            "pending" => TranscriptionStatus.Pending,
            "processing" => TranscriptionStatus.Processing,
            "done" => TranscriptionStatus.Done,
            "failed" => TranscriptionStatus.Failed,
            _ => TranscriptionStatus.Failed
        };

        TranscriptionResultDto? result = wire.Result is null ? null : new TranscriptionResultDto(
            wire.Result.Key,
            wire.Result.KeyConfidence,
            wire.Result.Tempo,
            wire.Result.TimeSignature,
            wire.Result.MusicXml,
            wire.Result.MidiBase64,
            wire.Result.Notes
                .Select(n => new NoteEventDto(n.PitchMidi, n.StartBeat, n.DurBeats, n.Degree, n.Solfa, n.OctaveMark, n.Conf))
                .ToList(),
            wire.Result.SolfaLines,
            wire.Result.OverallConfidence,
            wire.Result.AudioPreviewBase64,
            wire.Result.PitchRefined,
            wire.Result.ChromaticSpelling,
            MapSource(wire.Result.Source),
            wire.Result.SongDurationSec,
            wire.Result.Truncated,
            wire.Result.Separated,
            wire.Result.Parts?.ToDictionary(
                kv => kv.Key,
                kv => new PartDto(
                    kv.Value.Notes.Select(n => new NoteEventDto(n.PitchMidi, n.StartBeat, n.DurBeats, n.Degree, n.Solfa, n.OctaveMark, n.Conf)).ToList(),
                    kv.Value.SolfaLines)),
            wire.Result.PartsMusicXml ?? "",
            wire.Result.BeatOriginSec,
            wire.Result.BackingAudioBase64 ?? "");

        return new TranscriptionJobDto(jobId, status, wire.Progress ?? 0, result, wire.Error, wire.Stage, MapSource(wire.Source));
    }

    private static SourceDto? MapSource(WireSource? source)
        => source is null ? null : new SourceDto(source.Provider, source.Url, source.Title, source.Artist, source.ThumbnailUrl);
}
