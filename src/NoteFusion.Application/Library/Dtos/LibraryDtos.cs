using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Application.Library.Dtos;

/// <summary>A saved transcription as exposed to clients (library list + detail).</summary>
public sealed record SavedTranscriptionDto(
    Guid Id,
    string Title,
    string Key,
    int TempoBpm,
    string TimeSignature,
    double OverallConfidence,
    DateTime CreatedAtUtc,
    IReadOnlyList<NoteEventDto>? Notes);

public static class SavedTranscriptionMapper
{
    public static SavedTranscriptionDto ToDto(Transcription t, bool includeNotes)
        => new(
            t.Id,
            t.Title,
            t.Key.ToString(),
            t.TempoBpm,
            t.TimeSignature,
            t.OverallConfidence,
            t.CreatedAtUtc,
            includeNotes
                ? t.Notes.Select(n => new NoteEventDto(n.PitchMidi, n.StartBeat, n.DurationBeats, 0, string.Empty, string.Empty, n.Confidence)).ToList()
                : null);
}
