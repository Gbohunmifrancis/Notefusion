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
            form.Add(new StreamContent(audio), "audio", fileName);
            form.Add(new StringContent(options.Mode == TranscriptionMode.Poly ? "poly" : "melody"), "mode");
            if (!string.IsNullOrWhiteSpace(options.Key) && !options.Key.Equals("Auto", StringComparison.OrdinalIgnoreCase))
                form.Add(new StringContent(options.Key), "key");
            if (options.Tempo is not null)
                form.Add(new StringContent(options.Tempo.Value.ToString()), "tempo");

            using var response = await http.PostAsync("v1/transcribe", form, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return Error.Failure("Api.Submit", $"Transcription service returned {(int)response.StatusCode}.");

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
