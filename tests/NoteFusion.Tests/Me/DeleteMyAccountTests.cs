using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Me.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Me;

/// <summary>
/// Account-closure tests. Deletion is irreversible and reaches beyond the users table,
/// so these pin both halves of the contract: nothing goes when the password is wrong,
/// and nothing is left behind when it is right.
/// </summary>
public class DeleteMyAccountTests
{
    private const string Password = "password123";

    [Fact]
    public async Task Deletes_the_account_and_everything_hanging_off_it()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        user.RegisterDeviceToken("ExponentPushToken[abc]", "android", h.Clock.UtcNow);
        h.TokenIssuer.Issue(user); // adds a refresh token
        await h.Db.SaveChangesAsync();

        await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(user.Id))
            .Handle(SaveCommand(), default);

        var result = await Handler(h, user.Id).Handle(new DeleteMyAccountCommand(Password), default);

        Assert.True(result.IsSuccess);
        Assert.False(await h.Db.Users.AnyAsync(u => u.Id == user.Id));
        // Transcriptions have no FK to users, so nothing cascades them — the handler
        // has to remove them or they survive as rows no one can ever reach.
        Assert.False(await h.Db.Transcriptions.AnyAsync(t => t.UserId == user.Id));
        Assert.False(await h.Db.RefreshTokens.AnyAsync(t => t.UserId == user.Id));
        Assert.False(await h.Db.DeviceTokens.AnyAsync(t => t.UserId == user.Id));
    }

    [Fact]
    public async Task Rejects_a_wrong_password_and_leaves_the_account_intact()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(user.Id))
            .Handle(SaveCommand(), default);

        var result = await Handler(h, user.Id).Handle(new DeleteMyAccountCommand("not-my-password"), default);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_CURRENT_PASSWORD_INCORRECT", result.Error.Code);
        Assert.True(await h.Db.Users.AnyAsync(u => u.Id == user.Id));
        Assert.True(await h.Db.Transcriptions.AnyAsync(t => t.UserId == user.Id));
    }

    [Fact]
    public async Task Deleting_one_account_leaves_another_users_library_alone()
    {
        using var h = new TestHarness();
        var mine = await SeedUser(h);
        var theirs = await SeedUser(h, "other@example.com");

        await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(mine.Id))
            .Handle(SaveCommand(), default);
        await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(theirs.Id))
            .Handle(SaveCommand(), default);

        var result = await Handler(h, mine.Id).Handle(new DeleteMyAccountCommand(Password), default);

        Assert.True(result.IsSuccess);
        Assert.True(await h.Db.Users.AnyAsync(u => u.Id == theirs.Id));
        Assert.Equal(1, await h.Db.Transcriptions.CountAsync(t => t.UserId == theirs.Id));
    }

    [Fact]
    public async Task Rejects_an_unauthenticated_caller()
    {
        using var h = new TestHarness();
        await SeedUser(h);

        var handler = new DeleteMyAccountCommandHandler(h.Db, h.Hasher, new StubCurrentUser(userId: null));
        var result = await handler.Handle(new DeleteMyAccountCommand(Password), default);

        Assert.True(result.IsFailure);
        Assert.Equal("USER_NOT_FOUND", result.Error.Code);
        Assert.Equal(1, await h.Db.Users.CountAsync());
    }

    private static DeleteMyAccountCommandHandler Handler(TestHarness h, Guid userId)
        => new(h.Db, h.Hasher, new StubCurrentUser(userId));

    private static SaveTranscriptionCommand SaveCommand() =>
        new("My Song", "C", 120, "4/4", "<score/>",
            [new NoteEventDto(60, 0.0, 1.0, 0, "", "", 0.99)], 0.95, SourceJobId: null);

    private static async Task<User> SeedUser(TestHarness h, string email = "user@example.com")
    {
        var user = User.Create("Test User", email, h.Hasher.Hash(Password), h.Clock.UtcNow);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user;
    }
}
