using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Application.Library.Dtos;

/// <summary>A saved transcription as exposed to clients (library list + detail).</summary>
/// <param name="MusicXml">
/// MusicXML for staff engraving and export. Sent on detail reads only — a list of
/// scores would dominate the payload — so it is null wherever Notes is null.
/// </param>
public sealed record SavedTranscriptionDto(
    Guid Id,
    string Title,
    string Key,
    int TempoBpm,
    string TimeSignature,
    double OverallConfidence,
    DateTime CreatedAtUtc,
    IReadOnlyList<NoteEventDto>? Notes,
    string? MusicXml = null);

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
            includeNotes ? MapNotes(t) : null,
            includeNotes ? t.MusicXml : null);

    /// <summary>
    /// Labels the stored notes with solfa for the transcription's current key. Solfa is
    /// never persisted (a key override is a re-label, F-03), so every read derives it —
    /// which is why the octave marks come from the whole note list's reference doh
    /// rather than from each note in isolation.
    /// </summary>
    private static List<NoteEventDto> MapNotes(Transcription t)
    {
        int[] pitches = [.. t.Notes.Select(n => n.PitchMidi)];
        int referenceDoh = SolfaMapper.ReferenceDoh(pitches, t.Key.DohPitchClass);

        return [.. t.Notes.Select(n =>
        {
            var syllable = SolfaMapper.Map(n.PitchMidi, t.Key, referenceDoh);
            return new NoteEventDto(
                n.PitchMidi,
                n.StartBeat,
                n.DurationBeats,
                SolfaMapper.Degree(n.PitchMidi, t.Key),
                syllable.Text,
                syllable.OctaveMark,
                n.Confidence);
        })];
    }
}
