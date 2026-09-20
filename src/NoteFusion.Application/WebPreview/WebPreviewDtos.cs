using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.WebPreview;

public sealed record WebPreviewJobDto(
    string JobId,
    string? PreviewToken,
    TranscriptionStatus Status,
    double Progress,
    DateTime ExpiresAtUtc,
    WebPreviewResultDto? Result = null,
    string? Error = null);

public sealed record WebPreviewResultDto(
    string Key,
    double KeyConfidence,
    int Tempo,
    string TimeSignature,
    IReadOnlyList<NoteEventDto> Notes,
    IReadOnlyList<string> SolfaLines,
    double OverallConfidence,
    bool PitchRefined,
    string ChromaticSpelling);

public sealed record RecordProductEventRequest(
    string Event,
    string? AnonymousId,
    string? JobId,
    string? Surface,
    IReadOnlyDictionary<string, string?>? Metadata);

public sealed record ProductEventDto(string Event, DateTime OccurredAtUtc);
