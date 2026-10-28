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

    /// <summary>
    /// The chords heard under the tune, when the result carried them (a chords-mode recording, or a song
    /// with accompaniment). Stored as pitch classes only, like <see cref="Parts"/>: the symbols and solfa
    /// are derived from <see cref="Key"/> on every read.
    /// </summary>
    public List<ChordEvent>? Chords { get; private set; }

    /// <summary>
    /// The hymn this sheet is the hymnbook version of, when the user took it ("Use the hymnbook version"):
    /// its slug on the site's hymn pages, title, link and the credit line its page shows, kept so every
    /// view of the sheet credits the source. All null for a sheet that is a transcription.
    /// </summary>
    public string? HymnSlug { get; private set; }
    public string? HymnTitle { get; private set; }
    public string? HymnUrl { get; private set; }
    public string? HymnCredit { get; private set; }

    public const int HymnCreditMaxLength = 1000;

    public void CreditHymn(string slug, string title, string url, string credit)
    {
        HymnSlug = Guard.NotNullOrWhiteSpace(slug);
        HymnTitle = Guard.NotNullOrWhiteSpace(title);
        HymnUrl = Guard.NotNullOrWhiteSpace(url);
        var text = Guard.NotNullOrWhiteSpace(credit).Trim();
        HymnCredit = text.Length > HymnCreditMaxLength ? text[..HymnCreditMaxLength] : text;
    }

    /// <summary>The public link's token; null while the sheet is private.</summary>
    public string? ShareToken { get; private set; }
    public DateTime? SharedAtUtc { get; private set; }

    /// <summary>How many times the public link has been opened. The share loop's one measure of reach.</summary>
    public int ShareViews { get; private set; }

    public void RecordShareView() => ShareViews++;

    /// <summary>
    /// The choir whose shared library this sheet is in, or null. Set by its owner ("Share with my choir");
    /// cleared when they unshare it, when the director takes it out, or when the owner leaves the choir.
    /// </summary>
    public Guid? ChoirId { get; private set; }

    public void ShareWithChoir(Guid choirId) => ChoirId = Guard.AgainstEmpty(choirId);

    public void UnshareFromChoir() => ChoirId = null;

    /// <summary>
    /// The folder this sheet is filed in ("Sunday choir", "Easter service"), or null when it is not filed.
    /// A folder is nothing more than the name its sheets share, so it needs no row of its own.
    /// </summary>
    public string? Folder { get; private set; }

    public const int FolderMaxLength = 80;

    public void FileIn(string? folder)
    {
        var name = folder?.Trim();
        Folder = string.IsNullOrEmpty(name) ? null : name.Length > FolderMaxLength ? name[..FolderMaxLength].TrimEnd() : name;
    }

    public IReadOnlyList<NoteEvent> Notes => _notes.AsReadOnly();

    /// <summary>
    /// Where beat 0 falls in the recording, in seconds, kept from the job's result: with the tempo it was heard at it
    /// puts the notes on the recording's clock (beat b at BeatOriginSec + b × 60 / tempo). Null on sheets filed before
    /// it was kept.
    /// </summary>
    public double? BeatOriginSec { get; private set; }

    /// <summary>
    /// The audio time, in seconds, of each notated beat (entry i is beat i), when the worker tracked the beats: a
    /// clock that follows a live band's drift, which <see cref="BeatOriginSec"/> and one tempo cannot. A sheet that keeps
    /// a backing always has them (written out from the tempo it was heard at when none were tracked), so editing
    /// <see cref="TempoBpm"/> never moves the notes against the recording. Null otherwise.
    /// </summary>
    public List<double>? BeatTimesSec { get; private set; }

    /// <summary>
    /// The sheet came from a pasted song link (YouTube, Spotify, Apple Music). Such a sheet never keeps the song's
    /// audio, the backing included: it is someone else's recording.
    /// </summary>
    public bool FromLink { get; private set; }

    /// <summary>
    /// The stored backing's name in the file store (an unguessable path, never handed to a client), or null when
    /// the sheet keeps none. Only the owner's own uploads of a song keep one.
    /// </summary>
    public string? BackingKey { get; private set; }

    /// <summary>The song's own instrumental is kept with this sheet, to play under the tune.</summary>
    public bool HasBacking => BackingKey is not null;

    /// <summary>
    /// Semitones "Transpose for my choir" has moved the sheet from the key it was heard in; 0 is as heard, and only
    /// then does the backing still match the notes.
    /// </summary>
    public int TransposedBy { get; private set; }

    public const int BackingKeyMaxLength = 200;

    /// <summary>Keeps the job's beat clock: where beat 0 is, and each beat's time when the worker tracked them.</summary>
    public void KeepTiming(double beatOriginSec, IEnumerable<double>? beatTimesSec)
    {
        BeatOriginSec = beatOriginSec;
        List<double> times = beatTimesSec is null ? [] : [.. beatTimesSec];
        BeatTimesSec = times.Count > 0 ? times : null;
    }

    /// <summary>Marks the sheet as made from a pasted link: it can never keep a backing.</summary>
    public void MarkFromLink()
    {
        if (BackingKey is not null)
            throw new InvalidOperationException("A sheet that keeps a backing cannot be from a pasted link.");
        FromLink = true;
    }

    /// <summary>Keeps the backing stored under <paramref name="key"/> with this sheet (an upload's, never a link's).</summary>
    public void KeepBacking(string key)
    {
        if (FromLink)
            throw new InvalidOperationException("A sheet from a pasted link never keeps the song's audio.");
        var name = Guard.NotNullOrWhiteSpace(key);
        if (name.Length > BackingKeyMaxLength)
            throw new ArgumentException($"A backing key is at most {BackingKeyMaxLength} characters.", nameof(key));
        BackingKey = name;
    }

    /// <summary>The furthest a sheet's running transposition is taken as meaning anything (four octaves either way).</summary>
    public const int MaxTransposedBy = 48;

    /// <summary>
    /// How far, in all, the client moved this sheet's notes from the key the recording was heard in before saving it
    /// (a transpose done without the server); replaces the running total.
    /// </summary>
    public void RecordTransposedBy(int semitones)
        => TransposedBy = Guard.InRange(semitones, -MaxTransposedBy, MaxTransposedBy);

    /// <summary>
    /// Takes over what the copy the server filed for the same job knew of the recording — its beat clock, whether it
    /// came from a link, how far it has been transposed, and its backing, which moves here: the filed copy is about
    /// to be replaced by this one (a Save), and the backing must outlive it.
    /// </summary>
    public void TakePlaybackFrom(Transcription filed)
    {
        Guard.NotNull(filed);
        BeatOriginSec = filed.BeatOriginSec;
        BeatTimesSec = filed.BeatTimesSec is null ? null : [.. filed.BeatTimesSec];
        FromLink = filed.FromLink;
        TransposedBy = filed.TransposedBy;
        BackingKey = filed.BackingKey;
        filed.BackingKey = null;
    }

    public void SetLyrics(string lyrics) => Lyrics = Guard.NotNull(lyrics).Trim();

    public void SetParts(Dictionary<string, List<NoteEvent>>? parts, string? partsMusicXml)
    {
        Parts = parts is { Count: > 0 } ? parts : null;
        PartsMusicXml = Parts is null ? null : (string.IsNullOrWhiteSpace(partsMusicXml) ? null : partsMusicXml);
    }

    public void SetChords(IEnumerable<ChordEvent>? chords)
    {
        List<ChordEvent> list = chords is null ? [] : [.. chords];
        Chords = list.Count > 0 ? list : null;
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
    /// parts — and every chord shifts by <paramref name="semitones"/>, the key moves with them, and both
    /// engraved scores are respelled for the new key so the staff still matches the note list. Solfa is
    /// untouched by design: in movable-do only Doh moves. <see cref="TransposedBy"/> keeps the running total, so a
    /// client can offer the way back to the key the recording (and its backing) is in.
    /// </summary>
    public void Transpose(int semitones)
    {
        Guard.InRange(semitones, -12, 12);
        if (semitones == 0) return;
        TransposedBy += semitones;
        Key = new MusicalKey(((Key.TonicPitchClass + semitones) % 12 + 12) % 12, Key.Mode, Key.Confidence);
        for (int i = 0; i < _notes.Count; i++)
            _notes[i] = Shift(_notes[i], semitones);
        Parts = Parts?.ToDictionary(kv => kv.Key, kv => kv.Value.Select(n => Shift(n, semitones)).ToList());
        Chords = Chords?.Select(c => c.Shift(semitones)).ToList();
        MusicXml = MusicXmlTransposer.Transpose(MusicXml, semitones, Key);
        if (PartsMusicXml is not null)
            PartsMusicXml = MusicXmlTransposer.Transpose(PartsMusicXml, semitones, Key);
    }

    private static NoteEvent Shift(NoteEvent n, int semitones)
        => n with { PitchMidi = Math.Clamp(n.PitchMidi + semitones, 0, 127) };

    /// <summary>A rename is the person's own word on the sheet: it counts as opened (<see cref="OpenedAtUtc"/>).</summary>
    public void Rename(string title)
    {
        Title = Guard.NotNullOrWhiteSpace(title);
        OpenedAtUtc ??= DateTime.UtcNow;
    }

    /// <summary>
    /// True for a sheet the server filed by itself the moment its job finished (or the library sweep kept),
    /// rather than one the person saved. Until it is opened (<see cref="OpenedAtUtc"/>) the clients mark it
    /// "Saved automatically", and analytics do not count it as kept.
    /// </summary>
    public bool SavedAutomatically { get; private set; }

    /// <summary>When the person first opened (or renamed) a sheet saved automatically; null until then.</summary>
    public DateTime? OpenedAtUtc { get; private set; }

    public void MarkSavedAutomatically() => SavedAutomatically = true;

    /// <summary>The person opened it. Idempotent: the first time stands.</summary>
    public void MarkOpened(DateTime utcNow) => OpenedAtUtc ??= utcNow;

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
    /// <param name="musicXml">The staff written from these notes, when the client wrote one; null keeps the stored one.</param>
    public void ReplaceNotes(IEnumerable<NoteEvent> notes, string? musicXml = null)
    {
        List<NoteEvent> corrected = [.. Guard.NotNull(notes)];
        if (corrected.Count == 0)
            throw new ArgumentException("A transcription must keep at least one note.", nameof(notes));

        _notes.Clear();
        _notes.AddRange(corrected);
        OverallConfidence = Math.Round(corrected.Average(n => n.Confidence), 3);
        if (musicXml is not null)
            MusicXml = musicXml;
    }
}
