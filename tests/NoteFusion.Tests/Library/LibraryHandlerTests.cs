using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Library;

/// <summary>
/// Library handler tests. The important one is <see cref="Key_override_relabels_without_touching_notes"/>:
/// it locks in the solfa engine's core promise (F-03) at the persistence boundary.
/// </summary>
public class LibraryHandlerTests
{
    private static readonly IReadOnlyList<NoteEventDto> SampleNotes =
    [
        new(60, 0.0, 1.0, 0, "", "", 0.99), // C
        new(64, 1.0, 1.0, 0, "", "", 0.98), // E
        new(67, 2.0, 1.0, 0, "", "", 0.97)  // G
    ];

    [Fact]
    public async Task Save_persists_a_transcription_for_the_current_user()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        var handler = new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId));

        var result = await handler.Handle(SaveCommand(), default);

        Assert.True(result.IsSuccess);
        Assert.Equal("My Song", result.Value.Title);
        Assert.Equal(3, result.Value.Notes!.Count);
    }

    [Fact]
    public async Task Get_returns_forbidden_for_a_transcription_owned_by_another_user()
    {
        using var h = new TestHarness();
        var ownerId = await SeedUser(h, "owner@example.com");
        var saved = await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(ownerId))
            .Handle(SaveCommand(), default);

        var otherId = await SeedUser(h, "intruder@example.com");
        var query = new NoteFusion.Application.Library.Queries.GetTranscriptionQueryHandler(
            h.Db, new StubCurrentUser(otherId));

        var result = await query.Handle(
            new NoteFusion.Application.Library.Queries.GetTranscriptionQuery(saved.Value.Id), default);

        Assert.True(result.IsFailure);
        Assert.Equal("LIBRARY_NOT_OWNED", result.Error.Code);
    }

    [Fact]
    public async Task Key_override_relabels_without_touching_notes()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        var saved = await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId))
            .Handle(SaveCommand(key: "C"), default);
        var notesBefore = saved.Value.Notes!.Select(n => n.PitchMidi).ToArray();

        var handler = new UpdateTranscriptionKeyCommandHandler(h.Db, new StubCurrentUser(userId));
        var result = await handler.Handle(new UpdateTranscriptionKeyCommand(saved.Value.Id, "G major"), default);

        Assert.True(result.IsSuccess);
        Assert.StartsWith("G", result.Value.Key); // key was re-labelled
        // The note list — the source of truth for both notation views — is byte-for-byte unchanged.
        Assert.Equal(notesBefore, result.Value.Notes!.Select(n => n.PitchMidi).ToArray());
    }

    [Fact]
    public async Task Key_override_rejects_an_unparseable_key()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        var saved = await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId))
            .Handle(SaveCommand(), default);

        var handler = new UpdateTranscriptionKeyCommandHandler(h.Db, new StubCurrentUser(userId));
        var result = await handler.Handle(new UpdateTranscriptionKeyCommand(saved.Value.Id, "H#"), default);

        Assert.True(result.IsFailure);
        Assert.Equal("LIBRARY_INVALID_KEY", result.Error.Code);
    }

    private static SaveTranscriptionCommand SaveCommand(string key = "C") =>
        new("My Song", key, 120, "4/4", "<score/>", SampleNotes, 0.95, SourceJobId: "job-1");

    private static async Task<Guid> SeedUser(TestHarness h, string email = "user@example.com")
    {
        var user = User.Create("Test User", email, h.Hasher.Hash("password123"), h.Clock.UtcNow);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user.Id;
    }
}
