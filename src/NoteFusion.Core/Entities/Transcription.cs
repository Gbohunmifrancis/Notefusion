using NoteFusion.Core.Enums;
using NoteFusion.Core.Notation;
using NoteFusion.Core.Seedwork;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A saved transcription in a user's library (F-08). Holds the structured note list
/// (source of truth for editing and the solfa view) plus the MusicXML used for staff
/// engraving and export. Owned by a <see cref="User"/>; the ML job it came from is retained
/// for traceability.
/// </summary>
public class Transcription : BaseEntity
{
    private readonly List<NoteEvent> _notes = [];

    private Transcription() { } // persistence

    public Transcription(
        Guid userId,
        string title,
        MusicalKey key,
        int tempoBpm,
        string timeSignature,
        string musicXml,
        IEnumerable<NoteEvent> notes,
        double overallConfidence,
        string? sourceJobId = null)
    {
        UserId = Guard.AgainstEmpty(userId);
        Title = Guard.NotNullOrWhiteSpace(title);
        Key = Guard.NotNull(key);
        TempoBpm = Guard.InRange(tempoBpm, 20, 300);
        TimeSignature = Guard.NotNullOrWhiteSpace(timeSignature);
        MusicXml = Guard.NotNull(musicXml);
        OverallConfidence = Guard.InRange(overallConfidence, 0.0, 1.0);
        SourceJobId = sourceJobId;
        _notes.AddRange(notes);
        CreatedAtUtc = DateTime.UtcNow;
    }

    public Guid UserId { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }
    public MusicalKey Key { get; private set; } = new(0, KeyMode.Major);
    public int TempoBpm { get; private set; }
    public string TimeSignature { get; private set; } = "4/4";
    public string MusicXml { get; private set; } = string.Empty;
    public double OverallConfidence { get; private set; }
    public string? SourceJobId { get; private set; }
    public TranscriptionStatus Status { get; private set; } = TranscriptionStatus.Done;

    /// <summary>The words, as typed; clients syllabify them under the solfa.</summary>
    public string Lyrics { get; private set; } = string.Empty;

    /// <summary>
    /// The four-part harmony keyed soprano/alto/tenor/bass, when the result carried one (Pro).
    /// Stored as pitches only, like <see cref="Notes"/>: solfa is derived on every read.
    /// </summary>
    public Dictionary<string, List<NoteEvent>>? Parts { get; private set; }

    /// <summary>The four parts engraved as one score; null when there are no parts.</summary>
    public string? PartsMusicXml { get; private set; }

    /// <summary>The public link's token; null while the sheet is private.</summary>
    public string? ShareToken { get; private set; }
    public DateTime? SharedAtUtc { get; private set; }

    public IReadOnlyList<NoteEvent> Notes => _notes.AsReadOnly();

    public void SetLyrics(string lyrics) => Lyrics = Guard.NotNull(lyrics).Trim();

    public void SetParts(Dictionary<string, List<NoteEvent>>? parts, string? partsMusicXml)
    {
        Parts = parts is { Count: > 0 } ? parts : null;
        PartsMusicXml = Parts is null ? null : (string.IsNullOrWhiteSpace(partsMusicXml) ? null : partsMusicXml);
    }

    public void Share(string token, DateTime nowUtc)
    {
        ShareToken = Guard.NotNullOrWhiteSpace(token);
        SharedAtUtc = nowUtc;
    }

    public void Unshare()
    {
        ShareToken = null;
        SharedAtUtc = null;
    }

    /// <summary>
    /// Transpose for a choir's range: the one edit that moves the notes. Every pitch — melody and
    /// parts — shifts by <paramref name="semitones"/>, the key moves with them, and both engraved
    /// scores are respelled for the new key so the staff still matches the note list. Solfa is
    /// untouched by design: in movable-do only Doh moves.
    /// </summary>
    public void Transpose(int semitones)
    {
        Guard.InRange(semitones, -12, 12);
        if (semitones == 0) return;
        Key = new MusicalKey(((Key.TonicPitchClass + semitones) % 12 + 12) % 12, Key.Mode, Key.Confidence);
        for (int i = 0; i < _notes.Count; i++)
            _notes[i] = Shift(_notes[i], semitones);
        Parts = Parts?.ToDictionary(kv => kv.Key, kv => kv.Value.Select(n => Shift(n, semitones)).ToList());
        MusicXml = MusicXmlTransposer.Transpose(MusicXml, semitones, Key);
        if (PartsMusicXml is not null)
            PartsMusicXml = MusicXmlTransposer.Transpose(PartsMusicXml, semitones, Key);
    }

    private static NoteEvent Shift(NoteEvent n, int semitones)
        => n with { PitchMidi = Math.Clamp(n.PitchMidi + semitones, 0, 127) };

    public void Rename(string title) => Title = Guard.NotNullOrWhiteSpace(title);

    /// <summary>
    /// User key override (F-03). A pure re-labelling: solfa is re-derived from the note
    /// list on next render; the notes themselves never change.
    /// </summary>
    public void OverrideKey(MusicalKey key) => Key = Guard.NotNull(key);

    public void SetTempo(int tempoBpm) => TempoBpm = Guard.InRange(tempoBpm, 20, 300);

    public void SetTimeSignature(string timeSignature) => TimeSignature = Guard.NotNullOrWhiteSpace(timeSignature);

    /// <summary>Tap-to-correct (F-07): replace a note; both notation views re-derive from the list.</summary>
    public void ReplaceNote(int index, NoteEvent corrected)
    {
        Guard.InRange(index, 0, _notes.Count - 1);
        _notes[index] = Guard.NotNull(corrected);
    }

    /// <summary>
    /// Tap-to-correct (F-07): replaces the whole note list with the user's corrected one and
    /// recomputes <see cref="OverallConfidence"/> from it. Both notation views re-derive from
    /// the list, and solfa is not touched here because it is never stored.
    /// </summary>
    /// <remarks>
    /// Whole-list rather than per-note because a correction can *delete* a note, which shifts
    /// every later index — <see cref="ReplaceNote"/> cannot express that. The client edits a
    /// copy of the full list and sends the finished version, so there is nothing to merge.
    /// <para>
    /// Confidence becomes the mean of the notes' own confidences, the same formula the Python
    /// worker uses when it first reports the score, so a corrected transcription stays
    /// comparable with an untouched one instead of keeping a figure the notes no longer support.
    /// </para>
    /// </remarks>
    public void ReplaceNotes(IEnumerable<NoteEvent> notes)
    {
        List<NoteEvent> corrected = [.. Guard.NotNull(notes)];
        if (corrected.Count == 0)
            throw new ArgumentException("A transcription must keep at least one note.", nameof(notes));

        _notes.Clear();
        _notes.AddRange(corrected);
        OverallConfidence = Math.Round(corrected.Average(n => n.Confidence), 3);
    }
}
