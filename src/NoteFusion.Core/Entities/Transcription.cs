using NoteFusion.Core.Enums;
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

    public IReadOnlyList<NoteEvent> Notes => _notes.AsReadOnly();

    public void Rename(string title) => Title = Guard.NotNullOrWhiteSpace(title);

    /// <summary>
    /// User key override (F-03). A pure re-labelling: solfa is re-derived from the note
    /// list on next render; the notes themselves never change.
    /// </summary>
    public void OverrideKey(MusicalKey key) => Key = Guard.NotNull(key);

    public void SetTempo(int tempoBpm) => TempoBpm = Guard.InRange(tempoBpm, 20, 300);

    /// <summary>Tap-to-correct (F-07): replace a note; both notation views re-derive from the list.</summary>
    public void ReplaceNote(int index, NoteEvent corrected)
    {
        Guard.InRange(index, 0, _notes.Count - 1);
        _notes[index] = Guard.NotNull(corrected);
    }
}
