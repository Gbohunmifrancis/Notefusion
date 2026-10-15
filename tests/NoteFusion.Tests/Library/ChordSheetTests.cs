using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Library.Queries;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Library;

/// <summary>
/// Chords on a saved sheet. They are kept as pitch classes, like the parts are kept as pitches, and
/// named from the key on every read: transposing respells the symbols (F major's Dm is A major's F#m)
/// while the solfa reads as before, and a key override re-labels the solfa without moving a chord.
/// </summary>
public class ChordSheetTests
{
    private const string Score = """
        <score-partwise version="4.0"><part id="P1"><measure number="1">
        <attributes><divisions>1</divisions><key><fifths>-1</fifths><mode>major</mode></key></attributes>
        <harmony print-frame="no"><root><root-step>D</root-step></root><kind text="m">minor</kind></harmony>
        <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
        </measure></part></score-partwise>
        """;

    private static readonly IReadOnlyList<NoteEventDto> Tune =
    [
        new(65, 0.0, 1.0, 0, "", "", 0.99), // F
        new(69, 1.0, 1.0, 0, "", "", 0.98), // A
        new(72, 2.0, 1.0, 0, "", "", 0.97)  // C
    ];

    // The symbol and solfa sent are deliberately wrong: the server names chords itself.
    private static readonly IReadOnlyList<ChordSymbolDto> Chords =
    [
        new(0, 4, 2, "min", null, "?", "?"),   // Dm
        new(4, 4, 10, "maj", null, "?", "?"),  // Bb
        new(8, 4, 7, "maj", 11, "?", "?"),     // G/B
        new(12, 4, 7, "maj", 7, "?", "?"),     // G, its bass on the root
        new(16, 4, 0, "7", null, "?", "?")     // C7
    ];

    [Fact]
    public async Task Saving_keeps_the_chords_and_names_them_for_the_key()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);

        var saved = await Save(h, userId, Chords);

        Assert.Equal(["Dm", "Bb", "G/B", "G", "C7"], saved.Chords!.Select(c => c.Symbol));
        Assert.Equal(["l", "f", "r", "r", "s"], saved.Chords!.Select(c => c.Solfa));
        Assert.Equal([0.0, 4, 8, 12, 16], saved.Chords!.Select(c => c.StartBeat));
        Assert.Equal([null, null, 11, null, null], saved.Chords!.Select(c => c.Bass));

        // And it stuck: a fresh read, from the stored JSON and not the tracked entity, names them the same
        // way; the list view carries none of them.
        h.Db.ChangeTracker.Clear();
        var reread = await new GetTranscriptionQueryHandler(h.Db, new StubCurrentUser(userId)).Handle(new GetTranscriptionQuery(saved.Id), default);
        Assert.Equal(saved.Chords, reread.Value.Chords);
        var list = await new GetLibraryQueryHandler(h.Db, new StubCurrentUser(userId)).Handle(new GetLibraryQuery(), default);
        Assert.Null(list.Value.Single().Chords);
    }

    [Fact]
    public async Task A_sheet_without_chords_reads_back_without_them()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);

        var saved = await Save(h, userId, null);

        Assert.Null(saved.Chords);
        Assert.Null(h.Db.Transcriptions.Single().Chords);
    }

    [Fact]
    public async Task Transposing_moves_every_chord_and_respells_it_but_keeps_its_solfa()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        var saved = await Save(h, userId, Chords);

        var result = await new TransposeTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId))
            .Handle(new TransposeTranscriptionCommand(saved.Id, 4), default); // F -> A

        Assert.True(result.IsSuccess);
        var t = result.Value;
        Assert.Equal("A major", t.Key);
        Assert.Equal(["F#m", "D", "B/D#", "B", "E7"], t.Chords!.Select(c => c.Symbol));
        Assert.Equal([6, 2, 11, 11, 4], t.Chords!.Select(c => c.Root));
        Assert.Equal(saved.Chords!.Select(c => c.Solfa), t.Chords!.Select(c => c.Solfa));
        // The engraved chord symbol moved with them.
        Assert.Contains("<root-step>F</root-step><root-alter>1</root-alter>", t.MusicXml);

        var reread = await new GetTranscriptionQueryHandler(h.Db, new StubCurrentUser(userId)).Handle(new GetTranscriptionQuery(saved.Id), default);
        Assert.Equal(["F#m", "D", "B/D#", "B", "E7"], reread.Value.Chords!.Select(c => c.Symbol));
    }

    [Fact]
    public async Task A_key_override_relabels_the_chords_solfa_without_moving_them()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        var saved = await Save(h, userId, Chords);

        var result = await new UpdateTranscriptionKeyCommandHandler(h.Db, new StubCurrentUser(userId))
            .Handle(new UpdateTranscriptionKeyCommand(saved.Id, "Bb"), default);

        Assert.True(result.IsSuccess);
        Assert.Equal([2, 10, 7, 7, 0], result.Value.Chords!.Select(c => c.Root));
        Assert.Equal(["m", "d", "l", "l", "r"], result.Value.Chords!.Select(c => c.Solfa));
    }

    [Fact]
    public async Task A_shared_sheet_shows_its_chords()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        var saved = await Save(h, userId, Chords);
        var token = (await new ShareTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId), h.Clock)
            .Handle(new ShareTranscriptionCommand(saved.Id), default)).Value.Token;

        var open = await new GetSharedTranscriptionQueryHandler(h.Db).Handle(new GetSharedTranscriptionQuery(token), default);

        Assert.Equal(["Dm", "Bb", "G/B", "G", "C7"], open.Value.Chords!.Select(c => c.Symbol));
    }

    [Fact]
    public async Task Transposing_a_sheet_that_is_not_saved_moves_its_chords_too()
    {
        var result = await new TransposeSheetCommandHandler()
            .Handle(new TransposeSheetCommand("F", 4, Tune, Score, Chords: Chords), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(["F#m", "D", "B/D#", "B", "E7"], result.Value.Chords!.Select(c => c.Symbol));
        Assert.Equal(["l", "f", "r", "r", "s"], result.Value.Chords!.Select(c => c.Solfa));
    }

    [Fact]
    public void A_chord_the_server_cannot_read_is_refused_in_plain_words()
    {
        var validator = new SaveTranscriptionCommandValidator();
        IReadOnlyList<ChordSymbolDto> bad = [new(0, 4, 12, "maj", null, "", ""), new(4, 4, 0, "power", null, "", "")];

        var outcome = validator.Validate(Command(bad));

        Assert.False(outcome.IsValid);
        Assert.All(outcome.Errors, e => Assert.Equal(
            "One of the chords on this sheet could not be read. Please transcribe the song again.", e.ErrorMessage));
        Assert.True(validator.Validate(Command(Chords)).IsValid);
    }

    private static SaveTranscriptionCommand Command(IReadOnlyList<ChordSymbolDto>? chords)
        => new("My Song", "F", 100, "4/4", Score, Tune, 0.95, SourceJobId: null, Chords: chords);

    private static async Task<Application.Library.Dtos.SavedTranscriptionDto> Save(
        TestHarness h, Guid userId, IReadOnlyList<ChordSymbolDto>? chords)
    {
        var result = await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId), h.QuotaGate).Handle(Command(chords), default);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : "");
        return result.Value;
    }

    private static async Task<Guid> SeedUser(TestHarness h)
    {
        var user = User.Create("Test User", "user@example.com", h.Hasher.Hash("password123"), h.Clock.UtcNow);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user.Id;
    }
}
