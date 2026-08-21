using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Library.Queries;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Library;

/// <summary>
/// Tap-to-correct (F-07) at the persistence boundary. The invariant under test is the same one
/// the key override protects from the other side: the note list is the source of truth and solfa
/// is derived, so a corrected note must come back labelled for the *stored* key regardless of
/// what the client sent in the solfa fields.
/// </summary>
public class UpdateNotesTests
{
    private static readonly IReadOnlyList<NoteEventDto> SampleNotes =
    [
        new(60, 0.0, 1.0, 0, "", "", 0.99), // C
        new(64, 1.0, 1.0, 0, "", "", 0.40), // E — the one the model was unsure about
        new(67, 2.0, 1.0, 0, "", "", 0.97)  // G
    ];

    [Fact]
    public async Task A_corrected_note_replaces_the_stored_one_and_is_relabelled()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        var saved = await Save(h, userId);

        // The user nudges E up a semitone to F, and the client marks it as its own (conf 1.0).
        // It also sends nonsense in the derived fields, which the server must ignore.
        var corrected = Edited(index: 1, new(65, 1.0, 1.0, 99, "nonsense", "!!", 1.0));

        var result = await Handler(h, userId)
            .Handle(new UpdateTranscriptionNotesCommand(saved.Id, corrected), default);

        Assert.True(result.IsSuccess);
        var note = result.Value.Notes![1];
        Assert.Equal(65, note.PitchMidi);
        Assert.Equal("f", note.Solfa);   // derived from the stored key of C, not from the payload
        Assert.Equal(4, note.Degree);
        Assert.Equal(1.0, note.Conf);
    }

    [Fact]
    public async Task A_shorter_list_deletes_the_removed_note_from_the_database()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        var saved = await Save(h, userId);

        // Drop the middle note — a spurious detection the user deleted.
        IReadOnlyList<NoteEventDto> corrected = [SampleNotes[0], SampleNotes[2]];

        await Handler(h, userId).Handle(new UpdateTranscriptionNotesCommand(saved.Id, corrected), default);

        // Read it back untracked so this is a genuine round-trip: the owned rows must be gone,
        // not orphaned with a null owner.
        var reread = await new GetTranscriptionQueryHandler(h.Db, new StubCurrentUser(userId))
            .Handle(new GetTranscriptionQuery(saved.Id), default);

        Assert.Equal([60, 67], reread.Value.Notes!.Select(n => n.PitchMidi));
        // Onsets are absolute, so the survivors keep their positions and beat 1 becomes a rest.
        Assert.Equal([0.0, 2.0], reread.Value.Notes!.Select(n => n.StartBeat));
    }

    [Fact]
    public async Task Overall_confidence_is_recomputed_as_the_mean_of_the_corrected_notes()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        var saved = await Save(h, userId);
        Assert.Equal(0.95, saved.OverallConfidence); // as posted at save time

        var corrected = Edited(index: 1, new(65, 1.0, 1.0, 0, "", "", 1.0));

        var result = await Handler(h, userId)
            .Handle(new UpdateTranscriptionNotesCommand(saved.Id, corrected), default);

        // mean(0.99, 1.0, 0.97) — the same formula the Python worker uses when it first
        // reports the score, so a corrected transcription stays comparable with a fresh one.
        Assert.Equal(0.987, result.Value.OverallConfidence, 3);
    }

    [Fact]
    public void The_validator_rejects_an_empty_note_list()
    {
        var validator = new UpdateTranscriptionNotesCommandValidator();

        var result = validator.Validate(new UpdateTranscriptionNotesCommand(Guid.NewGuid(), []));

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.PropertyName == nameof(UpdateTranscriptionNotesCommand.Notes));
    }

    [Fact]
    public void The_validator_rejects_a_pitch_outside_the_midi_range()
    {
        var validator = new UpdateTranscriptionNotesCommandValidator();

        // Nudging the top note up an octave once too often.
        var result = validator.Validate(new UpdateTranscriptionNotesCommand(
            Guid.NewGuid(), [new(130, 0.0, 1.0, 0, "", "", 1.0)]));

        Assert.False(result.IsValid);
    }

    [Fact]
    public async Task Another_users_transcription_cannot_be_corrected()
    {
        using var h = new TestHarness();
        var ownerId = await SeedUser(h, "owner@example.com");
        var saved = await Save(h, ownerId);

        var intruderId = await SeedUser(h, "intruder@example.com");
        var result = await Handler(h, intruderId)
            .Handle(new UpdateTranscriptionNotesCommand(saved.Id, SampleNotes), default);

        Assert.True(result.IsFailure);
        Assert.Equal("LIBRARY_NOT_OWNED", result.Error.Code);
    }

    [Fact]
    public async Task An_unknown_transcription_is_not_found()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);

        var result = await Handler(h, userId)
            .Handle(new UpdateTranscriptionNotesCommand(Guid.NewGuid(), SampleNotes), default);

        Assert.True(result.IsFailure);
        Assert.Equal("LIBRARY_NOT_FOUND", result.Error.Code);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>The sample list with one note swapped out, as the editor would send it.</summary>
    private static IReadOnlyList<NoteEventDto> Edited(int index, NoteEventDto note)
    {
        var notes = SampleNotes.ToList();
        notes[index] = note;
        return notes;
    }

    private static UpdateTranscriptionNotesCommandHandler Handler(TestHarness h, Guid userId)
        => new(h.Db, new StubCurrentUser(userId));

    private static async Task<Application.Library.Dtos.SavedTranscriptionDto> Save(TestHarness h, Guid userId)
    {
        var result = await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId))
            .Handle(new SaveTranscriptionCommand(
                "My Song", "C", 120, "4/4", "<score/>", SampleNotes, 0.95, SourceJobId: "job-1"), default);
        return result.Value;
    }

    private static async Task<Guid> SeedUser(TestHarness h, string email = "user@example.com")
    {
        var user = User.Create("Test User", email, h.Hasher.Hash("password123"), h.Clock.UtcNow);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user.Id;
    }
}
