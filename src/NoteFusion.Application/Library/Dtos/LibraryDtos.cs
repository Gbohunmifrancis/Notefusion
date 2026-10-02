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
    string? MusicXml = null,
    string Lyrics = "",
    IReadOnlyDictionary<string, PartDto>? Parts = null,
    string? PartsMusicXml = null,
    string? ShareToken = null);

/// <summary>A sheet behind a public link: what a chorister who follows it sees, with no account.</summary>
public sealed record SharedSheetDto(
    string Title,
    string SharedBy,
    string Key,
    int TempoBpm,
    string TimeSignature,
    string Lyrics,
    IReadOnlyList<NoteEventDto> Notes,
    string MusicXml,
    IReadOnlyDictionary<string, PartDto>? Parts,
    string? PartsMusicXml);

/// <summary>The public link for a saved transcription.</summary>
public sealed record ShareLinkDto(string Token);

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
            includeNotes ? SolfaLabels.Label(t.Notes, t.Key) : null,
            includeNotes ? t.MusicXml : null,
            t.Lyrics,
            includeNotes ? SolfaLabels.LabelParts(t.Parts, t.Key, t.Notes) : null,
            includeNotes ? t.PartsMusicXml : null,
            t.ShareToken);

    public static SharedSheetDto ToShared(Transcription t, string sharedBy)
        => new(
            t.Title,
            sharedBy,
            t.Key.ToString(),
            t.TempoBpm,
            t.TimeSignature,
            t.Lyrics,
            SolfaLabels.Label(t.Notes, t.Key),
            t.MusicXml,
            SolfaLabels.LabelParts(t.Parts, t.Key, t.Notes),
            t.PartsMusicXml);
}

/// <summary>
/// Labels stored notes with solfa for a key. Solfa is never persisted (a key override is a
/// re-label, F-03), so every read derives it — which is why the octave marks come from the whole
/// note list's reference doh rather than from each note in isolation, and the chromatic spelling
/// from the whole list's melodic direction.
/// </summary>
public static class SolfaLabels
{
    public static List<NoteEventDto> Label(IReadOnlyList<NoteEvent> notes, MusicalKey key)
        => Label(notes, key, SolfaMapper.ReferenceDoh([.. notes.Select(n => n.PitchMidi)], key.DohPitchClass));

    /// <summary>
    /// The parts, each labelled against the melody's reference doh so a bass "d," sits where the
    /// tune's "d" does — the same convention the worker's harmoniser uses.
    /// </summary>
    public static IReadOnlyDictionary<string, PartDto>? LabelParts(
        IReadOnlyDictionary<string, List<NoteEvent>>? parts, MusicalKey key, IReadOnlyList<NoteEvent> melody)
    {
        if (parts is null || parts.Count == 0) return null;
        int referenceDoh = SolfaMapper.ReferenceDoh([.. melody.Select(n => n.PitchMidi)], key.DohPitchClass);
        return parts.ToDictionary(kv => kv.Key, kv => new PartDto(Label(kv.Value, key, referenceDoh), []));
    }

    private static List<NoteEventDto> Label(IReadOnlyList<NoteEvent> source, MusicalKey key, int referenceDoh)
    {
        NoteEvent[] notes = [.. source];

        // Direction is a property of a note's position in the tune, and this list arrives in
        // whatever order the database returned the owned collection in — not necessarily
        // start-beat order. So the flags are computed over a time-ordered view and scattered
        // back to storage position; the DTO's own order is part of the contract and stays put.
        // OrderBy is stable, so notes sharing a start beat keep their relative order.
        int[] melodic = [.. Enumerable.Range(0, notes.Length).OrderBy(i => notes[i].StartBeat)];
        bool[] inMelodicOrder = SolfaMapper.AscendingFlags([.. melodic.Select(i => notes[i].PitchMidi)]);
        bool[] ascending = new bool[notes.Length];
        for (int k = 0; k < melodic.Length; k++)
            ascending[melodic[k]] = inMelodicOrder[k];

        return [.. notes.Select((n, i) =>
        {
            var syllable = SolfaMapper.Map(
                n.PitchMidi,
                key,
                referenceDoh,
                ascending[i] ? ChromaticSpelling.Ascending : ChromaticSpelling.Descending);
            return new NoteEventDto(
                n.PitchMidi,
                n.StartBeat,
                n.DurationBeats,
                SolfaMapper.Degree(n.PitchMidi, key),
                syllable.Text,
                syllable.OctaveMark,
                n.Confidence);
        })];
    }
}
