using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Library.Queries;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Library;

/// <summary>Folders for a choir or a service, and one link that shares a whole folder.</summary>
public class FolderTests
{
    private const string Score = "<score-partwise/>";
    private static readonly List<NoteEventDto> Tune = [new(60, 0, 1, 1, "d", "", 1), new(62, 1, 1, 2, "r", "", 1)];

    [Fact]
    public async Task A_sheet_is_filed_and_unfiled_and_the_name_is_tidied()
    {
        using var h = new TestHarness();
        var me = await SeedUser(h, "ada@example.com", "Ada Obi");
        var sheet = await Save(h, me, "Amazing Grace");
        var handler = new UpdateTranscriptionFolderCommandHandler(h.Db, new StubCurrentUser(me));

        var filed = await handler.Handle(new UpdateTranscriptionFolderCommand(sheet, "  Sunday choir "), default);
        Assert.Equal("Sunday choir", filed.Value.Folder);

        var unfiled = await handler.Handle(new UpdateTranscriptionFolderCommand(sheet, "   "), default);
        Assert.Null(unfiled.Value.Folder);

        var stranger = await new UpdateTranscriptionFolderCommandHandler(h.Db, new StubCurrentUser(Guid.NewGuid()))
            .Handle(new UpdateTranscriptionFolderCommand(sheet, "Mine now"), default);
        Assert.True(stranger.IsFailure);
    }

    [Fact]
    public async Task One_link_shares_the_folder_and_includes_sheets_filed_later()
    {
        using var h = new TestHarness();
        var me = await SeedUser(h, "ada@example.com", "Ada Obi");
        var a = await Save(h, me, "Amazing Grace");
        var b = await Save(h, me, "Way Maker");
        var other = await Save(h, me, "Not in it");
        await File(h, me, a, "Sunday choir");
        await File(h, me, b, "Sunday choir");
        await File(h, me, other, "Easter");

        var link = await new ShareFolderCommandHandler(h.Db, new StubCurrentUser(me), h.Clock)
            .Handle(new ShareFolderCommand("Sunday choir"), default);
        Assert.True(link.IsSuccess);
        // Sharing again hands back the same link.
        var again = await new ShareFolderCommandHandler(h.Db, new StubCurrentUser(me), h.Clock)
            .Handle(new ShareFolderCommand("Sunday choir"), default);
        Assert.Equal(link.Value.Token, again.Value.Token);

        var later = await Save(h, me, "Filed later");
        await File(h, me, later, "Sunday choir");

        var opened = await new GetSharedFolderQueryHandler(h.Db, h.Clock).Handle(new GetSharedFolderQuery(link.Value.Token), default);

        Assert.True(opened.IsSuccess);
        Assert.Equal("Sunday choir", opened.Value.Folder);
        Assert.Equal("Ada", opened.Value.SharedBy);
        Assert.Equal(["Amazing Grace", "Way Maker", "Filed later"], opened.Value.Items.Select(i => i.Title));
        // Every song opens as its own shared sheet.
        foreach (var item in opened.Value.Items)
            Assert.True((await new GetSharedTranscriptionQueryHandler(h.Db).Handle(new GetSharedTranscriptionQuery(item.Token), default)).IsSuccess);
        Assert.Equal(1, h.Db.FolderShares.Single().Views);
    }

    [Fact]
    public async Task Renaming_a_folder_moves_its_sheets_and_keeps_its_link()
    {
        using var h = new TestHarness();
        var me = await SeedUser(h, "ada@example.com", "Ada Obi");
        var a = await Save(h, me, "Amazing Grace");
        await File(h, me, a, "Sunday");
        var link = await new ShareFolderCommandHandler(h.Db, new StubCurrentUser(me), h.Clock).Handle(new ShareFolderCommand("Sunday"), default);

        var renamed = await new RenameFolderCommandHandler(h.Db, new StubCurrentUser(me)).Handle(new RenameFolderCommand("Sunday", "Sunday choir"), default);

        Assert.True(renamed.IsSuccess);
        Assert.Equal("Sunday choir", h.Db.Transcriptions.Single().Folder);
        var opened = await new GetSharedFolderQueryHandler(h.Db, h.Clock).Handle(new GetSharedFolderQuery(link.Value.Token), default);
        Assert.Equal("Sunday choir", opened.Value.Folder);
        Assert.Single(opened.Value.Items);
    }

    [Fact]
    public async Task A_stopped_folder_link_no_longer_opens_and_an_empty_folder_cannot_be_shared()
    {
        using var h = new TestHarness();
        var me = await SeedUser(h, "ada@example.com", "Ada Obi");
        var a = await Save(h, me, "Amazing Grace");
        await File(h, me, a, "Sunday");
        var link = await new ShareFolderCommandHandler(h.Db, new StubCurrentUser(me), h.Clock).Handle(new ShareFolderCommand("Sunday"), default);

        await new UnshareFolderCommandHandler(h.Db, new StubCurrentUser(me)).Handle(new UnshareFolderCommand("Sunday"), default);

        Assert.True((await new GetSharedFolderQueryHandler(h.Db, h.Clock).Handle(new GetSharedFolderQuery(link.Value.Token), default)).IsFailure);
        var empty = await new ShareFolderCommandHandler(h.Db, new StubCurrentUser(me), h.Clock).Handle(new ShareFolderCommand("Nothing here"), default);
        Assert.Equal("LIBRARY_EMPTY_FOLDER", empty.Error.Code);
    }

    private static async Task File(TestHarness h, Guid userId, Guid sheet, string folder)
        => Assert.True((await new UpdateTranscriptionFolderCommandHandler(h.Db, new StubCurrentUser(userId))
            .Handle(new UpdateTranscriptionFolderCommand(sheet, folder), default)).IsSuccess);

    private static async Task<Guid> Save(TestHarness h, Guid userId, string title)
    {
        var result = await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId))
            .Handle(new SaveTranscriptionCommand(title, "C", 120, "4/4", Score, Tune, 0.95, SourceJobId: null), default);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : "");
        h.Clock.UtcNow = h.Clock.UtcNow.AddMinutes(1);
        return result.Value.Id;
    }

    private static async Task<Guid> SeedUser(TestHarness h, string email, string name)
    {
        var user = User.Create(name, email, h.Hasher.Hash("password123"), h.Clock.UtcNow);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user.Id;
    }
}
