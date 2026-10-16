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
/// <param name="Preview">
/// The opening notes, labelled, on every read: enough for a list row to show how the
/// song starts ("d r m f │ s") so a sheet is recognisable at a glance, at a fraction of
/// the full note list.
/// </param>
/// <param name="SharedWithChoir">The sheet is in its owner's choir library ("Share with my choir").</param>
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
    string? ShareToken = null,
    string? Folder = null,
    IReadOnlyList<ChordSymbolDto>? Chords = null,
    IReadOnlyList<NoteEventDto>? Preview = null,
    bool SharedWithChoir = false,
    HymnCreditDto? Hymn = null);

/// <summary>
/// The hymn a sheet is the hymnbook version of: its title, its page and the credit line that page shows
/// (where the melody and words came from, and who wrote them). Null on a sheet that is a transcription.
/// </summary>
public sealed record HymnCreditDto(string Slug, string Title, string Url, string Credit)
{
    public static HymnCreditDto? Of(Transcription t)
        => t.HymnSlug is null ? null : new HymnCreditDto(t.HymnSlug, t.HymnTitle ?? "", t.HymnUrl ?? "", t.HymnCredit ?? "");
}

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
    string? PartsMusicXml,
    IReadOnlyList<ChordSymbolDto>? Chords = null,
    HymnCreditDto? Hymn = null);

/// <summary>The public link for a saved transcription.</summary>
public sealed record ShareLinkDto(string Token);

/// <summary>
/// One song in a shared folder: enough to list it and open it through the folder's link
/// (<c>GET api/shared/folders/{token}/sheets/{id}</c>). <paramref name="Token"/> is the sheet's own public
/// link, present only when the sheet is shared in its own right; the folder never mints one.
/// </summary>
public sealed record SharedFolderItemDto(string Title, string Key, Guid Id, string? Token);

/// <summary>A shared folder as anyone with the link sees it: its name, who shared it, and its songs.</summary>
public sealed record SharedFolderDto(string Folder, string SharedBy, IReadOnlyList<SharedFolderItemDto> Items);

public static class SavedTranscriptionMapper
{
    /// <summary>How many opening notes a list row gets: about two bars of a hymn tune.</summary>
    public const int PreviewNotes = 8;

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
            t.ShareToken,
            t.Folder,
            includeNotes ? ChordLabels.Label(t.Chords, t.Key) : null,
            SolfaLabels.Label(t.Notes.Take(PreviewNotes).ToList(), t.Key),
            t.ChoirId is not null,
            HymnCreditDto.Of(t));

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
            t.PartsMusicXml,
            ChordLabels.Label(t.Chords, t.Key),
            HymnCreditDto.Of(t));
}

/// <summary>
/// Names stored chords for a key. Like the solfa, a chord's symbol and syllable are never persisted:
/// a key override re-labels them and a transpose respells the symbols, with the same rules the worker
/// named them by (<see cref="ChordSpeller"/>).
/// </summary>
public static class ChordLabels
{
    public static List<ChordSymbolDto>? Label(IReadOnlyList<ChordEvent>? chords, MusicalKey key)
    {
        if (chords is null || chords.Count == 0) return null;
        return [.. chords.Select(c =>
        {
            var (symbol, solfa) = ChordSpeller.Label(c.Root, c.Quality, c.Bass, key);
            return new ChordSymbolDto(c.StartBeat, c.DurationBeats, c.Root, c.Quality, c.Bass, symbol, solfa);
        })];
    }
}

/// <summary>
/// Labels stored notes with solfa for a key. Solfa is never persisted (a key override is a
/// re-label, F-03), so every read derives it — which is why the octave marks come from the whole
/// note list's reference doh rather than from each note in isolation, and the chromatic spelling
/// from where each note goes next in the tune.
/// </summary>
public static class SolfaLabels
{
    public static List<NoteEventDto> Label(IReadOnlyList<NoteEvent> notes, MusicalKey key)
        => Label(notes, key, SolfaMapper.ReferenceDoh([.. notes.Select(n => n.PitchMidi)], key.DohPitchClass, key.Mode));

    /// <summary>
    /// The parts, each labelled against the melody's reference doh so a bass "d," sits where the
    /// tune's "d" does — the same convention the worker's harmoniser uses.
    /// </summary>
    public static IReadOnlyDictionary<string, PartDto>? LabelParts(
        IReadOnlyDictionary<string, List<NoteEvent>>? parts, MusicalKey key, IReadOnlyList<NoteEvent> melody)
    {
        if (parts is null || parts.Count == 0) return null;
        int referenceDoh = SolfaMapper.ReferenceDoh([.. melody.Select(n => n.PitchMidi)], key.DohPitchClass, key.Mode);
        return parts.ToDictionary(kv => kv.Key, kv => new PartDto(Label(kv.Value, key, referenceDoh), []));
    }

    private static List<NoteEventDto> Label(IReadOnlyList<NoteEvent> source, MusicalKey key, int referenceDoh)
    {
        NoteEvent[] notes = [.. source];

        // A chromatic's spelling is a property of its position in the tune (the note it moves
        // to), and this list arrives in whatever order the database returned the owned
        // collection in — not necessarily start-beat order. So the flags are computed over a time-ordered view and scattered
        // back to storage position; the DTO's own order is part of the contract and stays put.
        // OrderBy is stable, so notes sharing a start beat keep their relative order.
        int[] melodic = [.. Enumerable.Range(0, notes.Length).OrderBy(i => notes[i].StartBeat)];
        bool[] inMelodicOrder = SolfaMapper.AscendingFlags([.. melodic.Select(i => notes[i].PitchMidi)], key.DohPitchClass);
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
