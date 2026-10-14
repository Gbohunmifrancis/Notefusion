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

        var opened = await new GetSharedFolderQueryHandler(h.Db).Handle(new GetSharedFolderQuery(link.Value.Token), default);

        Assert.True(opened.IsSuccess);
        Assert.Equal("Sunday choir", opened.Value.Folder);
        Assert.Equal("Ada", opened.Value.SharedBy);
        Assert.Equal(["Amazing Grace", "Way Maker", "Filed later"], opened.Value.Items.Select(i => i.Title));
        // Every song opens through the folder's link, and none was given a link of its own.
        foreach (var item in opened.Value.Items)
        {
            var song = await OpenThroughFolder(h, link.Value.Token, item.Id);
            Assert.True(song.IsSuccess);
            Assert.Equal(item.Title, song.Value.Title);
            Assert.Equal("Ada", song.Value.SharedBy);
            Assert.Null(item.Token);
        }
        Assert.All(h.Db.Transcriptions, t => Assert.Null(t.ShareToken));
        Assert.Equal(1, h.Db.FolderShares.Single().Views);
    }

    [Fact]
    public async Task A_private_sheet_in_a_shared_folder_gets_no_link_of_its_own()
    {
        using var h = new TestHarness();
        var me = await SeedUser(h, "ada@example.com", "Ada Obi");
        var mine = await Save(h, me, "Private arrangement");
        var shared = await Save(h, me, "Shared on its own");
        await File(h, me, mine, "Sunday");
        await File(h, me, shared, "Sunday");
        var ownLink = await new ShareTranscriptionCommandHandler(h.Db, new StubCurrentUser(me), h.Clock)
            .Handle(new ShareTranscriptionCommand(shared), default);
        var link = await new ShareFolderCommandHandler(h.Db, new StubCurrentUser(me), h.Clock).Handle(new ShareFolderCommand("Sunday"), default);

        var opened = await new GetSharedFolderQueryHandler(h.Db).Handle(new GetSharedFolderQuery(link.Value.Token), default);

        // Sharing and opening the folder used to mint a public token for every sheet in it, re-publishing a
        // sheet the owner had kept private; that token outlived the folder link and the sheet's filing.
        Assert.Null(h.Db.Transcriptions.Single(t => t.Id == mine).ShareToken);
        Assert.Null(opened.Value.Items.Single(i => i.Id == mine).Token);
        // A sheet the owner shared on its own keeps that link in the listing.
        Assert.Equal(ownLink.Value.Token, opened.Value.Items.Single(i => i.Id == shared).Token);
    }

    [Fact]
    public async Task The_folder_link_opens_only_sheets_filed_in_that_folder_now()
    {
        using var h = new TestHarness();
        var me = await SeedUser(h, "ada@example.com", "Ada Obi");
        var someoneElse = await SeedUser(h, "bo@example.com", "Bo Ade");
        var inIt = await Save(h, me, "Amazing Grace");
        var elsewhere = await Save(h, me, "Easter anthem");
        var moved = await Save(h, me, "Moved out");
        var theirs = await Save(h, someoneElse, "Not Ada's");
        await File(h, me, inIt, "Sunday");
        await File(h, me, elsewhere, "Easter");
        await File(h, me, moved, "Sunday");
        await File(h, someoneElse, theirs, "Sunday");
        var link = await new ShareFolderCommandHandler(h.Db, new StubCurrentUser(me), h.Clock).Handle(new ShareFolderCommand("Sunday"), default);
        Assert.True((await OpenThroughFolder(h, link.Value.Token, moved)).IsSuccess);

        await File(h, me, moved, "Archive");

        Assert.True((await OpenThroughFolder(h, link.Value.Token, inIt)).IsSuccess);
        Assert.Equal("SHARE_NOT_FOUND", (await OpenThroughFolder(h, link.Value.Token, moved)).Error.Code);
        Assert.Equal("SHARE_NOT_FOUND", (await OpenThroughFolder(h, link.Value.Token, elsewhere)).Error.Code);
        Assert.Equal("SHARE_NOT_FOUND", (await OpenThroughFolder(h, link.Value.Token, theirs)).Error.Code);
        Assert.Equal("SHARE_NOT_FOUND", (await OpenThroughFolder(h, "not-a-token", inIt)).Error.Code);
    }

    [Fact]
    public async Task Stopping_the_folder_link_closes_its_sheets_too()
    {
        using var h = new TestHarness();
        var me = await SeedUser(h, "ada@example.com", "Ada Obi");
        var a = await Save(h, me, "Amazing Grace");
        await File(h, me, a, "Sunday");
        var link = await new ShareFolderCommandHandler(h.Db, new StubCurrentUser(me), h.Clock).Handle(new ShareFolderCommand("Sunday"), default);
        Assert.True((await OpenThroughFolder(h, link.Value.Token, a)).IsSuccess);

        await new UnshareFolderCommandHandler(h.Db, new StubCurrentUser(me)).Handle(new UnshareFolderCommand("Sunday"), default);

        Assert.Equal("SHARE_NOT_FOUND", (await OpenThroughFolder(h, link.Value.Token, a)).Error.Code);
        Assert.Null(h.Db.Transcriptions.Single().ShareToken);
    }

    private static Task<NoteFusion.Shared.Results.Result<NoteFusion.Application.Library.Dtos.SharedSheetDto>> OpenThroughFolder(
        TestHarness h, string folderToken, Guid sheetId)
        => new GetSharedFolderSheetQueryHandler(h.Db).Handle(new GetSharedFolderSheetQuery(folderToken, sheetId), default);

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
        var opened = await new GetSharedFolderQueryHandler(h.Db).Handle(new GetSharedFolderQuery(link.Value.Token), default);
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

        Assert.True((await new GetSharedFolderQueryHandler(h.Db).Handle(new GetSharedFolderQuery(link.Value.Token), default)).IsFailure);
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
