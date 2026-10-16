using System.Text.Json;
using System.Net.Http.Json;
using Microsoft.Extensions.Logging;

using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Http;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Api;

/// <summary>
/// HTTP client for the transcription API (TRD §6). Network failures are returned as
/// <see cref="ErrorType.Network"/> results — connectivity drops are an expected condition
/// in the target market, not an exceptional one.
/// </summary>
internal sealed class TranscriptionApiClient(
    HttpClient http,
    Microsoft.Extensions.Configuration.IConfiguration config,
    ILogger<TranscriptionApiClient> logger) : ITranscriptionApi
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
                return await RejectedAsync("Api.Submit", response, cancellationToken);
            }

            var payload = await response.Content.ReadFromJsonAsync(
                ApiJsonContext.Default.SubmitResponse, cancellationToken);

            return payload is null
                ? Error.Failure("Api.Submit", "Transcription service returned an empty response.")
                : payload.JobId;
        }
        catch (HttpRequestException ex)
        {
            return Unreachable("Api.Submit", ex);
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, cancellationToken))
        {
            return Unreachable("Api.Submit", ex);
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
                return await RejectedAsync("Api.SubmitScore", response, cancellationToken);
            }

            var payload = await response.Content.ReadFromJsonAsync(
                ApiJsonContext.Default.SubmitResponse, cancellationToken);

            return payload is null
                ? Error.Failure("Api.SubmitScore", "Transcription service returned an empty response.")
                : payload.JobId;
        }
        catch (HttpRequestException ex)
        {
            return Unreachable("Api.SubmitScore", ex);
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, cancellationToken))
        {
            return Unreachable("Api.SubmitScore", ex);
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
                return await RejectedAsync("Api.Grade", response, cancellationToken);
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
            return Unreachable("Api.Grade", ex);
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, cancellationToken))
        {
            return Unreachable("Api.Grade", ex);
        }
    }

    public async Task<Result<HarmonyDto>> HarmoniseAsync(
        string key,
        int tempoBpm,
        string timeSignature,
        IReadOnlyList<NoteEventDto> notes,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var wire = new HarmoniseRequest(
                key, tempoBpm, timeSignature,
                notes.Select(n => new HarmoniseNote(n.PitchMidi, n.StartBeat, n.DurBeats, n.Conf)).ToList());
            using var body = new StringContent(
                System.Text.Json.JsonSerializer.Serialize(wire, ApiJsonContext.Default.HarmoniseRequest),
                System.Text.Encoding.UTF8, "application/json");
            using var response = await http.PostAsync("v1/harmonise", body, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return await RejectedAsync("Api.Harmonise", response, cancellationToken);
            }
            var payload = await response.Content.ReadFromJsonAsync(ApiJsonContext.Default.HarmoniseResponse, cancellationToken);
            if (payload is null)
                return Error.Failure("Api.Harmonise", "Transcription service returned an empty response.");
            return new HarmonyDto(
                payload.Parts?.ToDictionary(
                    kv => kv.Key,
                    kv => new PartDto(
                        kv.Value.Notes.Select(n => new NoteEventDto(n.PitchMidi, n.StartBeat, n.DurBeats, n.Degree, n.Solfa, n.OctaveMark, n.Conf)).ToList(),
                        kv.Value.SolfaLines)),
                payload.PartsMusicXml);
        }
        catch (HttpRequestException ex)
        {
            return Unreachable("Api.Harmonise", ex);
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, cancellationToken))
        {
            return Unreachable("Api.Harmonise", ex);
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
            if (options.StartSeconds is { } start)
                form.Add(new StringContent(start.ToString(System.Globalization.CultureInfo.InvariantCulture)), "start_seconds");
            if (options.EndSeconds is { } end)
                form.Add(new StringContent(end.ToString(System.Globalization.CultureInfo.InvariantCulture)), "end_seconds");

            using var response = await http.PostAsync("v1/transcribe/link", form, cancellationToken);
            // The worker is the authority on which links it can fetch, and it answers 422 for one it cannot.
            // That is the user's link, not a fault on our side, so it is told in this API's own words — by the
            // reason the worker named, or as an invalid link — never in the worker's text.
            if (response.StatusCode == System.Net.HttpStatusCode.UnprocessableEntity)
                return await RefusedLinkAsync(response, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return await RejectedAsync("Api.SubmitLink", response, cancellationToken);
            }

            var payload = await response.Content.ReadFromJsonAsync(
                ApiJsonContext.Default.SubmitResponse, cancellationToken);

            return payload is null
                ? Error.Failure("Api.SubmitLink", "Transcription service returned an empty response.")
                : payload.JobId;
        }
        catch (HttpRequestException ex)
        {
            return Unreachable("Api.SubmitLink", ex);
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, cancellationToken))
        {
            return Unreachable("Api.SubmitLink", ex);
        }
    }

    public async Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken cancellationToken = default)
    {
        // The worker reads a page, or asks yt-dlp for a length, and answers in a few seconds; a client is
        // waiting on this to draw a picker, so a worker that takes much longer is treated as away.
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));

        try
        {
            using var body = new StringContent(
                System.Text.Json.JsonSerializer.Serialize(new ResolveLinkRequest(url), ApiJsonContext.Default.ResolveLinkRequest),
                System.Text.Encoding.UTF8, "application/json");
            using var response = await http.PostAsync("v1/links/resolve", body, timeout.Token);
            // As for a submit: a link the worker cannot read is the user's link, told in our own words.
            if (response.StatusCode == System.Net.HttpStatusCode.UnprocessableEntity)
                return await RefusedLinkAsync(response, timeout.Token);
            if (!response.IsSuccessStatusCode)
                return TranscriptionErrors.ServiceUnavailable;

            // The route's fields are specified in snake_case while the worker's models emit camelCase, so
            // either spelling is read.
            using var doc = await System.Text.Json.JsonDocument.ParseAsync(
                await response.Content.ReadAsStreamAsync(timeout.Token), cancellationToken: timeout.Token);
            var root = doc.RootElement;
            return new SourceDto(
                Text(root, "provider") ?? "",
                Text(root, "url") ?? url,
                Text(root, "title") ?? "",
                Text(root, "artist") ?? "",
                Text(root, "thumbnailUrl", "thumbnail_url"),
                DurationSeconds: Number(root, "durationSeconds", "duration_seconds"));
        }
        catch (HttpRequestException)
        {
            return TranscriptionErrors.ServiceUnavailable;
        }
        catch (System.Text.Json.JsonException)
        {
            return TranscriptionErrors.ServiceUnavailable;
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, cancellationToken))
        {
            // Our own twenty seconds, the pipeline's timeout, or an open breaker.
            logger.LogWarning(ex, "Transcription service did not resolve a link.");
            return TranscriptionErrors.ServiceUnavailable;
        }
    }

    /// <summary>
    /// The worker's 422 for a link it will not use. Its detail is a plain sentence, or an object naming the
    /// reason by code (a live stream, a video over the cap, one that is private or gone); a code this API has
    /// words for is answered in them, anything else as an invalid link. The worker's sentence is never shown.
    /// </summary>
    private static async Task<Error> RefusedLinkAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if (doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Object
                && doc.RootElement.TryGetProperty("detail", out var detail)
                && detail.ValueKind == System.Text.Json.JsonValueKind.Object
                && TranscriptionErrors.ForLink(Text(detail, "code"), Number(detail, "limit_seconds", "limitSeconds")) is { } named)
                return named;
        }
        catch (System.Text.Json.JsonException)
        {
            // Not JSON at all: the plain invalid link below.
        }
        return TranscriptionErrors.InvalidLink;
    }

    private static string? Text(System.Text.Json.JsonElement root, params string[] names)
    {
        foreach (var name in names)
            if (root.TryGetProperty(name, out var value) && value.ValueKind == System.Text.Json.JsonValueKind.String)
                return value.GetString();
        return null;
    }

    private static double? Number(System.Text.Json.JsonElement root, params string[] names)
    {
        foreach (var name in names)
            if (root.TryGetProperty(name, out var value) && value.ValueKind == System.Text.Json.JsonValueKind.Number)
                return value.GetDouble();
        return null;
    }

    /// <summary>The form fields every submit shares: options, lane, and the completion callback.</summary>
    private void AddOptions(MultipartFormDataContent form, TranscribeOptions options, bool withMode)
    {
        if (withMode)
            form.Add(new StringContent(options.Mode switch
            {
                TranscriptionMode.Poly => "poly",
                TranscriptionMode.Choir => "choir",
                TranscriptionMode.Chords => "chords",
                _ => "melody",
            }), "mode");
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
        if (options.Harmony)
            form.Add(new StringContent("true"), "harmony");
        if (withMode && options.MaxSeconds is { } cap)
            form.Add(new StringContent(cap.ToString(System.Globalization.CultureInfo.InvariantCulture)), "max_seconds");
        // Only audio is played on a keyboard; a score file is already written in its own key.
        if (withMode && options.KeyboardTranspose != 0)
            form.Add(new StringContent(options.KeyboardTranspose.ToString(System.Globalization.CultureInfo.InvariantCulture)), "keyboard_transpose");

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
            return Unreachable("Api.Job", ex);
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, cancellationToken))
        {
            return Unreachable("Api.Job", ex);
        }
    }

    /// <summary>
    /// The worker could not be reached. The client gets a plain sentence (host names and DNS text are
    /// not for a screen); the detail goes to the log.
    /// </summary>
    private Error Unreachable(string code, Exception ex)
    {
        // Also an open breaker (the worker failed often enough lately that it is not asked for a while) and
        // a call that ran out of time: to the person waiting, all three are the same "try again shortly".
        logger.LogWarning(ex, "Transcription service unreachable ({Code}).", code);
        return Error.Network(code, "The transcription service is unavailable. Try again shortly.");
    }

    /// <summary>
    /// The worker answered with an error. Its body is the worker's own text — stack traces, file paths,
    /// library messages — so it goes to the log, and the caller gets this API's plain sentence instead.
    /// </summary>
    private async Task<Error> RejectedAsync(string code, HttpResponseMessage response, CancellationToken ct)
    {
        var errText = await response.Content.ReadAsStringAsync(ct);
        logger.LogWarning(
            "Transcription service returned {Status} ({Code}): {Body}", (int)response.StatusCode, code, errText);

        // A refusal of the input itself (too long, unreadable, malformed) will fail the same way every time,
        // so "try again shortly" would be wrong: the worker's own sentence, which it keeps plain, says why.
        // Anything else — 5xx, a full queue — is the service, not the file.
        var status = (int)response.StatusCode;
        if (status is 413 or 415 or 422 && ReadableDetail(errText) is { } sentence)
            return Error.Validation("TRANS_INPUT_REJECTED", sentence);
        return TranscriptionErrors.ServiceUnavailable;
    }

    /// <summary>The worker's <c>detail</c> as one short sentence: a string, or an object's <c>message</c>.</summary>
    private static string? ReadableDetail(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("detail", out var detail)) return null;
            var text = detail.ValueKind switch
            {
                JsonValueKind.String => detail.GetString(),
                JsonValueKind.Object when detail.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String => m.GetString(),
                _ => null,
            };
            return string.IsNullOrWhiteSpace(text) || text.Length > 300 ? null : text.Trim();
        }
        catch (JsonException)
        {
            return null;
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
            return Unreachable("Api.Ping", ex);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // Our own five seconds, not the caller giving up. A worker this slow to answer a static
            // handler is one that cannot take a job either, so it is reported as unreachable rather than
            // as a latency figure.
            return Error.Network("Api.Ping", "The transcription service did not answer within 5 seconds.");
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, cancellationToken))
        {
            return Unreachable("Api.Ping", ex);
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
            wire.Result.BackingAudioBase64 ?? "",
            wire.Result.PartsSource,
            wire.Result.Chords?
                .Select(c => new ChordSymbolDto(c.StartBeat, c.DurBeats, c.Root, c.Quality, c.Bass, c.Symbol, c.Solfa))
                .ToList(),
            wire.Result.ChordsSource,
            wire.Result.KeyAlternatives?.Select(k => new KeyAlternativeDto(k.Key, k.Pitches, k.MusicXml ?? "")).ToList(),
            MapHymnMatch(wire.Result.HymnMatch));

        return new TranscriptionJobDto(jobId, status, wire.Progress ?? 0, result, wire.Error, wire.Stage, MapSource(wire.Source), wire.QueuePosition);
    }

    private static HymnMatchDto? MapHymnMatch(WireHymnMatch? hymn)
        => hymn is null ? null : new HymnMatchDto(
            hymn.Slug, hymn.Title, hymn.Tune ?? "", hymn.Url, hymn.Source, hymn.Licence, hymn.Credit, hymn.Kind, hymn.Confidence,
            hymn.Key, hymn.TimeSignature, hymn.Tempo, hymn.Pickup,
            hymn.Notes?.Select(n => new NoteEventDto(n.PitchMidi, n.StartBeat, n.DurBeats, n.Degree, n.Solfa, n.OctaveMark, n.Conf)).ToList(),
            hymn.SolfaLines, hymn.MusicXml, hymn.Lyrics);

    private static SourceDto? MapSource(WireSource? source)
        => source is null ? null : new SourceDto(
            source.Provider, source.Url, source.Title, source.Artist, source.ThumbnailUrl, source.Preview, source.Notice,
            source.StartSeconds, source.EndSeconds, source.DurationSeconds);
}
