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
internal sealed class TranscriptionApiClient(HttpClient http) : ITranscriptionApi
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

            form.Add(new StringContent(options.Mode == TranscriptionMode.Poly ? "poly" : "melody"), "mode");
            if (!string.IsNullOrWhiteSpace(options.Key) && !options.Key.Equals("Auto", StringComparison.OrdinalIgnoreCase))
                form.Add(new StringContent(options.Key), "key");
            if (options.Tempo is not null)
                form.Add(new StringContent(options.Tempo.Value.ToString()), "tempo");

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

    public async Task<Result<TranscriptionJobDto>> GetJobAsync(
        string jobId,
        CancellationToken cancellationToken = default)
    {
        try
        {
            using var response = await http.GetAsync($"v1/jobs/{jobId}", cancellationToken);
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
            wire.Result.AudioPreviewBase64);

        return new TranscriptionJobDto(jobId, status, wire.Progress ?? 0, result, wire.Error);
    }
}
