using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Me.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Me;

/// <summary>
/// Account-closure tests. Deletion is irreversible and reaches beyond the users table,
/// so these pin both halves of the contract: nothing goes when re-authentication fails,
/// and nothing is left behind when it succeeds. Google accounts have no password, so they
/// re-authenticate with a fresh ID token instead — covered here too, because an account
/// that cannot be closed is a compliance problem, not just a missing feature.
/// </summary>
public class DeleteMyAccountTests
{
    private const string Password = "password123";

    [Fact]
    public async Task Deletes_the_account_and_everything_hanging_off_it()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        user.RegisterDeviceToken("ExponentPushToken[abc]", "android", 1, h.Clock.UtcNow);
        h.TokenIssuer.Issue(user); // adds a refresh token
        await h.Db.SaveChangesAsync();

        await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(user.Id), h.QuotaGate)
            .Handle(SaveCommand(), default);

        var result = await Handler(h, user.Id).Handle(new DeleteMyAccountCommand(Password, null), default);

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
        await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(user.Id), h.QuotaGate)
            .Handle(SaveCommand(), default);

        var result = await Handler(h, user.Id).Handle(new DeleteMyAccountCommand("not-my-password", null), default);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_REAUTHENTICATION_REQUIRED", result.Error.Code);
        Assert.True(await h.Db.Users.AnyAsync(u => u.Id == user.Id));
        Assert.True(await h.Db.Transcriptions.AnyAsync(t => t.UserId == user.Id));
    }

    [Fact]
    public async Task Closes_a_Google_account_with_a_fresh_id_token()
    {
        using var h = new TestHarness();
        var user = await SeedGoogleUser(h);
        var google = new StubGoogleTokenValidator().Accept("fresh-token", "google-sub-1", "google@example.com");

        var result = await Handler(h, user.Id, google)
            .Handle(new DeleteMyAccountCommand(null, "fresh-token"), default);

        Assert.True(result.IsSuccess);
        Assert.False(await h.Db.Users.AnyAsync(u => u.Id == user.Id));
    }

    [Fact]
    public async Task Refuses_a_google_token_belonging_to_a_different_account()
    {
        using var h = new TestHarness();
        var user = await SeedGoogleUser(h);
        // A valid token — just not for this user. Validity alone must not be enough,
        // or anyone with any Google account could close someone else's.
        var google = new StubGoogleTokenValidator()
            .Accept("someone-elses-token", "google-sub-999", "intruder@example.com");

        var result = await Handler(h, user.Id, google)
            .Handle(new DeleteMyAccountCommand(null, "someone-elses-token"), default);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_REAUTHENTICATION_REQUIRED", result.Error.Code);
        Assert.True(await h.Db.Users.AnyAsync(u => u.Id == user.Id));
    }

    [Fact]
    public async Task Refuses_a_password_account_that_sends_only_a_google_token()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        var google = new StubGoogleTokenValidator().Accept("tok", "google-sub-1", "user@example.com");

        var result = await Handler(h, user.Id, google).Handle(new DeleteMyAccountCommand(null, "tok"), default);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_REAUTHENTICATION_REQUIRED", result.Error.Code);
        Assert.True(await h.Db.Users.AnyAsync(u => u.Id == user.Id));
    }

    [Fact]
    public async Task Deleting_one_account_leaves_another_users_library_alone()
    {
        using var h = new TestHarness();
        var mine = await SeedUser(h);
        var theirs = await SeedUser(h, "other@example.com");

        await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(mine.Id), h.QuotaGate)
            .Handle(SaveCommand(), default);
        await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(theirs.Id), h.QuotaGate)
            .Handle(SaveCommand(), default);

        var result = await Handler(h, mine.Id).Handle(new DeleteMyAccountCommand(Password, null), default);

        Assert.True(result.IsSuccess);
        Assert.True(await h.Db.Users.AnyAsync(u => u.Id == theirs.Id));
        Assert.Equal(1, await h.Db.Transcriptions.CountAsync(t => t.UserId == theirs.Id));
    }

    [Fact]
    public async Task Rejects_an_unauthenticated_caller()
    {
        using var h = new TestHarness();
        await SeedUser(h);

        var handler = new DeleteMyAccountCommandHandler(h.Db, h.Hasher, new StubGoogleTokenValidator(), new StubCurrentUser(userId: null));
        var result = await handler.Handle(new DeleteMyAccountCommand(Password, null), default);

        Assert.True(result.IsFailure);
        Assert.Equal("USER_NOT_FOUND", result.Error.Code);
        Assert.Equal(1, await h.Db.Users.CountAsync());
    }

    private static DeleteMyAccountCommandHandler Handler(
        TestHarness h, Guid userId, StubGoogleTokenValidator? google = null)
        => new(h.Db, h.Hasher, google ?? new StubGoogleTokenValidator(), new StubCurrentUser(userId));

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

    private static async Task<User> SeedGoogleUser(TestHarness h)
    {
        var user = User.CreateFromGoogle(
            "Google User", "google@example.com", "google-sub-1", null, h.Clock.UtcNow);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user;
    }
}
