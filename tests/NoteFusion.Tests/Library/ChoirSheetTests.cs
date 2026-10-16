using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Library.Queries;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Library;

/// <summary>
/// The choir-sheet features on a saved transcription: lyrics, the four parts, transposition and
/// the public link. The invariant worth the most is in the transpose tests — the solfa reads
/// exactly as before, because in movable-do only Doh moves.
/// </summary>
public class ChoirSheetTests
{
    private const string Score = """
        <score-partwise version="4.0"><part id="P1"><measure number="1">
        <attributes><divisions>2</divisions><key><fifths>0</fifths><mode>major</mode></key></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
        </measure></part></score-partwise>
        """;

    private static readonly IReadOnlyList<NoteEventDto> Tune =
    [
        new(60, 0.0, 1.0, 0, "", "", 0.99), // C
        new(64, 1.0, 1.0, 0, "", "", 0.98), // E
        new(67, 2.0, 1.0, 0, "", "", 0.97)  // G
    ];

    private static readonly IReadOnlyDictionary<string, PartDto> Parts = new Dictionary<string, PartDto>
    {
        ["bass"] = new PartDto([new(48, 0.0, 1.0, 0, "x", "?", 1.0), new(43, 1.0, 1.0, 0, "x", "?", 1.0), new(48, 2.0, 1.0, 0, "x", "?", 1.0)], ["ignored"]),
        ["alto"] = new PartDto([new(55, 0.0, 3.0, 0, "x", "?", 1.0)], [])
    };

    [Fact]
    public async Task Saving_keeps_lyrics_and_parts_and_relabels_the_parts_against_the_tunes_doh()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);

        var saved = await Save(h, userId, lyrics: "A-ma-zing grace", parts: Parts, partsXml: Score);

        Assert.Equal("A-ma-zing grace", saved.Lyrics);
        Assert.NotNull(saved.Parts);
        Assert.Equal(["alto", "bass"], saved.Parts!.Keys.Order());
        var bass = saved.Parts["bass"].Notes;
        Assert.Equal(["d", "s", "d"], bass.Select(n => n.Solfa));
        Assert.Equal([",", ",,", ","], bass.Select(n => n.OctaveMark)); // an octave under the tune's doh
        Assert.Equal(Score, saved.PartsMusicXml);

        // The list view carries none of the heavy fields.
        var list = await new GetLibraryQueryHandler(h.Db, new StubCurrentUser(userId)).Handle(new GetLibraryQuery(), default);
        Assert.Null(list.Value.Single().Parts);
        Assert.Null(list.Value.Single().PartsMusicXml);
    }

    [Fact]
    public async Task Written_parts_under_a_mans_tune_are_marked_from_the_soprano_so_it_reads_as_the_tune()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        // He sang C3 E3 G3; the parts were written with the tune moved up to a soprano's C4 E4 G4.
        IReadOnlyList<NoteEventDto> low = [.. Tune.Select(n => n with { PitchMidi = n.PitchMidi - 12 })];
        var parts = new Dictionary<string, PartDto>
        {
            ["soprano"] = new PartDto([.. Tune], []),
            ["bass"] = new PartDto([new(48, 0.0, 1.0, 0, "", "", 1.0), new(43, 1.0, 1.0, 0, "", "", 1.0), new(48, 2.0, 1.0, 0, "", "", 1.0)], [])
        };

        var saved = await Save(h, userId, parts: parts, tune: low);

        var tune = saved.Notes!.Select(n => n.Solfa + n.OctaveMark).ToArray();
        Assert.Equal(["d", "m", "s"], tune);
        Assert.Equal(tune, saved.Parts!["soprano"].Notes.Select(n => n.Solfa + n.OctaveMark));
        Assert.Equal(["d,", "s,,", "d,"], saved.Parts["bass"].Notes.Select(n => n.Solfa + n.OctaveMark));
    }

    [Fact]
    public async Task Lyrics_can_be_set_later_and_are_trimmed()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        var saved = await Save(h, userId);

        var result = await new UpdateTranscriptionLyricsCommandHandler(h.Db, new StubCurrentUser(userId))
            .Handle(new UpdateTranscriptionLyricsCommand(saved.Id, "  How sweet the sound \n"), default);

        Assert.True(result.IsSuccess);
        Assert.Equal("How sweet the sound", result.Value.Lyrics);
    }

    [Fact]
    public async Task Parts_written_after_saving_are_kept_on_the_sheet_and_can_be_removed()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        var saved = await Save(h, userId);
        Assert.Null(saved.Parts);

        var alto = new PartDto([new NoteEventDto(57, 0, 1, 6, "l", "", 1), new NoteEventDto(55, 1, 1, 5, "s", "", 1)], ["Doh is C · Alto", "| l s |"]);
        var handler = new UpdateTranscriptionPartsCommandHandler(h.Db, new StubCurrentUser(userId));

        var result = await handler.Handle(new UpdateTranscriptionPartsCommand(saved.Id, new Dictionary<string, PartDto> { ["alto"] = alto }, "<satb/>"), default);

        Assert.True(result.IsSuccess);
        Assert.Equal([57, 55], result.Value.Parts!["alto"].Notes.Select(n => n.PitchMidi));
        Assert.Equal("<satb/>", result.Value.PartsMusicXml);
        Assert.NotNull(h.Db.Transcriptions.Single(t => t.Id == saved.Id).Parts);

        var removed = await handler.Handle(new UpdateTranscriptionPartsCommand(saved.Id, null, null), default);
        Assert.True(removed.IsSuccess);
        Assert.Null(removed.Value.Parts);

        var stranger = await new UpdateTranscriptionPartsCommandHandler(h.Db, new StubCurrentUser(Guid.NewGuid()))
            .Handle(new UpdateTranscriptionPartsCommand(saved.Id, new Dictionary<string, PartDto> { ["alto"] = alto }, null), default);
        Assert.True(stranger.IsFailure);
    }

    [Fact]
    public async Task Transposing_moves_every_pitch_and_the_key_but_not_the_solfa()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        var saved = await Save(h, userId, parts: Parts, partsXml: Score);
        var solfaBefore = saved.Notes!.Select(n => n.Solfa + n.OctaveMark).ToArray();
        var bassBefore = saved.Parts!["bass"].Notes.Select(n => n.Solfa + n.OctaveMark).ToArray();

        var result = await new TransposeTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId))
            .Handle(new TransposeTranscriptionCommand(saved.Id, 3), default);

        Assert.True(result.IsSuccess);
        var t = result.Value;
        Assert.Equal("D# major", t.Key);
        Assert.Equal([63, 67, 70], t.Notes!.Select(n => n.PitchMidi));
        Assert.Equal([51, 46, 51], t.Parts!["bass"].Notes.Select(n => n.PitchMidi));
        Assert.Equal(solfaBefore, t.Notes.Select(n => n.Solfa + n.OctaveMark).ToArray());
        Assert.Equal(bassBefore, t.Parts["bass"].Notes.Select(n => n.Solfa + n.OctaveMark).ToArray());
        // Both scores follow: Eb major is three flats, and the C became an Eb.
        Assert.Contains("<fifths>-3</fifths>", t.MusicXml);
        Assert.Contains("<step>E</step><alter>-1</alter><octave>4</octave>", t.MusicXml);
        Assert.Contains("<fifths>-3</fifths>", t.PartsMusicXml);

        // And it stuck: a fresh read sees the moved notes.
        var reread = await new GetTranscriptionQueryHandler(h.Db, new StubCurrentUser(userId)).Handle(new GetTranscriptionQuery(saved.Id), default);
        Assert.Equal([63, 67, 70], reread.Value.Notes!.Select(n => n.PitchMidi));
        Assert.Equal([51, 46, 51], reread.Value.Parts!["bass"].Notes.Select(n => n.PitchMidi));
    }

    [Fact]
    public async Task Transposing_a_sheet_that_is_not_saved_is_the_same_move_without_a_row()
    {
        var handler = new TransposeSheetCommandHandler();

        var result = await handler.Handle(new TransposeSheetCommand("C", -2, Tune, Score, Parts, Score), default);

        Assert.True(result.IsSuccess);
        Assert.Equal("A# major", result.Value.Key);
        Assert.Equal([58, 62, 65], result.Value.Notes.Select(n => n.PitchMidi));
        Assert.Equal(["d", "m", "s"], result.Value.Notes.Select(n => n.Solfa));
        Assert.Equal([46, 41, 46], result.Value.Parts!["bass"].Notes.Select(n => n.PitchMidi));
        Assert.Contains("<fifths>-2</fifths>", result.Value.MusicXml);
        Assert.Contains("<step>B</step><alter>-1</alter><octave>3</octave>", result.Value.MusicXml);
    }

    [Fact]
    public async Task A_bad_score_fails_the_transposition_rather_than_leaving_it_stale()
    {
        var result = await new TransposeSheetCommandHandler()
            .Handle(new TransposeSheetCommand("C", 2, Tune, "<score-partwise><part>"), default);

        Assert.True(result.IsFailure);
        Assert.Equal("LIBRARY_INVALID_SCORE", result.Error.Code);
    }

    [Fact]
    public async Task Sharing_is_idempotent_anonymous_to_read_and_revocable()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h, "ada lovelace@example.com".Replace(" ", "."));
        var saved = await Save(h, userId, lyrics: "words", parts: Parts, partsXml: Score);
        var share = new ShareTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId), h.Clock);

        var first = await share.Handle(new ShareTranscriptionCommand(saved.Id), default);
        var second = await share.Handle(new ShareTranscriptionCommand(saved.Id), default);
        Assert.True(first.IsSuccess);
        Assert.Equal(first.Value.Token, second.Value.Token);
        Assert.InRange(first.Value.Token.Length, 20, 24);
        Assert.DoesNotContain('+', first.Value.Token);
        Assert.DoesNotContain('/', first.Value.Token);

        var open = await new GetSharedTranscriptionQueryHandler(h.Db).Handle(new GetSharedTranscriptionQuery(first.Value.Token), default);
        Assert.True(open.IsSuccess);
        Assert.Equal("My Song", open.Value.Title);
        Assert.Equal("Test", open.Value.SharedBy); // first name only
        Assert.Equal("words", open.Value.Lyrics);
        Assert.Equal(3, open.Value.Notes.Count);
        Assert.NotNull(open.Value.Parts);
        Assert.Equal(Score, open.Value.PartsMusicXml);

        var mine = await new GetTranscriptionQueryHandler(h.Db, new StubCurrentUser(userId)).Handle(new GetTranscriptionQuery(saved.Id), default);
        Assert.Equal(first.Value.Token, mine.Value.ShareToken);

        var revoke = await new UnshareTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId)).Handle(new UnshareTranscriptionCommand(saved.Id), default);
        Assert.True(revoke.IsSuccess);
        var gone = await new GetSharedTranscriptionQueryHandler(h.Db).Handle(new GetSharedTranscriptionQuery(first.Value.Token), default);
        Assert.Equal("SHARE_NOT_FOUND", gone.Error.Code);
    }

    [Fact]
    public async Task Another_user_cannot_share_or_transpose_my_sheet()
    {
        using var h = new TestHarness();
        var owner = await SeedUser(h, "owner@example.com");
        var saved = await Save(h, owner);
        var intruder = await SeedUser(h, "intruder@example.com");

        var share = await new ShareTranscriptionCommandHandler(h.Db, new StubCurrentUser(intruder), h.Clock)
            .Handle(new ShareTranscriptionCommand(saved.Id), default);
        var move = await new TransposeTranscriptionCommandHandler(h.Db, new StubCurrentUser(intruder))
            .Handle(new TransposeTranscriptionCommand(saved.Id, 1), default);

        Assert.Equal("LIBRARY_NOT_OWNED", share.Error.Code);
        Assert.Equal("LIBRARY_NOT_OWNED", move.Error.Code);
    }

    private static async Task<Application.Library.Dtos.SavedTranscriptionDto> Save(
        TestHarness h, Guid userId, string lyrics = "", IReadOnlyDictionary<string, PartDto>? parts = null, string? partsXml = null,
        IReadOnlyList<NoteEventDto>? tune = null)
    {
        var result = await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId), h.QuotaGate)
            .Handle(new SaveTranscriptionCommand("My Song", "C", 120, "4/4", Score, tune ?? Tune, 0.95, SourceJobId: null, lyrics, parts, partsXml), default);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : "");
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
