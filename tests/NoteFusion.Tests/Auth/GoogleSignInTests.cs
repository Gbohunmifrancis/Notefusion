using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Auth;

/// <summary>
/// Google sign-in is one endpoint doing two jobs, so these tests pin which one runs: create on
/// first sight of a subject, reuse afterwards, and link — never duplicate — when the address
/// already has a password account. The refusals matter as much: an unverified email would let a
/// token claim an address Google never confirmed.
/// </summary>
public class GoogleSignInTests
{
    private const string Token = "google-id-token";
    private const string Subject = "112233445566";
    private const string Email = "singer@example.com";

    [Fact]
    public async Task Creates_an_account_on_first_sign_in()
    {
        using var h = new TestHarness();
        var google = new StubGoogleTokenValidator()
            .Accept(Token, Subject, Email, fullName: "Ada Singer", pictureUrl: "https://lh3.google.com/a/ada");

        var result = await Handler(h, google).Handle(new GoogleSignInCommand(Token), default);

        Assert.True(result.IsSuccess);
        var user = await h.Db.Users.SingleAsync();
        Assert.Equal(Subject, user.GoogleId);
        Assert.Equal(Email, user.Email);
        Assert.Equal("Ada Singer", user.FullName);
        Assert.Equal("https://lh3.google.com/a/ada", user.ProfilePictureUrl);
        // No password was ever set, and none should be invented.
        Assert.Null(user.PasswordHash);
        Assert.Equal(user.Id, result.Value.User.Id);
    }

    [Fact]
    public async Task Reuses_the_same_account_on_later_sign_ins()
    {
        using var h = new TestHarness();
        var google = new StubGoogleTokenValidator().Accept(Token, Subject, Email);

        var first = await Handler(h, google).Handle(new GoogleSignInCommand(Token), default);
        var second = await Handler(h, google).Handle(new GoogleSignInCommand(Token), default);

        Assert.True(second.IsSuccess);
        Assert.Equal(first.Value.User.Id, second.Value.User.Id);
        Assert.Equal(1, await h.Db.Users.CountAsync());
    }

    [Fact]
    public async Task Links_google_to_an_existing_password_account_instead_of_duplicating_it()
    {
        using var h = new TestHarness();
        var existing = User.Create("Ada Singer", Email, h.Hasher.Hash("password123"), h.Clock.UtcNow);
        h.Db.Users.Add(existing);
        await h.Db.SaveChangesAsync();

        var google = new StubGoogleTokenValidator().Accept(Token, Subject, Email);
        var result = await Handler(h, google).Handle(new GoogleSignInCommand(Token), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, await h.Db.Users.CountAsync());
        var user = await h.Db.Users.SingleAsync();
        Assert.Equal(existing.Id, user.Id);
        Assert.Equal(Subject, user.GoogleId);
        // Linking must not cost the user their existing password login.
        Assert.NotNull(user.PasswordHash);
    }

    [Fact]
    public async Task Matches_on_subject_even_when_the_google_email_changed()
    {
        using var h = new TestHarness();
        var first = new StubGoogleTokenValidator().Accept(Token, Subject, Email);
        var created = await Handler(h, first).Handle(new GoogleSignInCommand(Token), default);

        // Same person, new address at Google. The subject is the stable key, so this is a
        // sign-in, not a second account.
        var renamed = new StubGoogleTokenValidator().Accept(Token, Subject, "ada.new@example.com");
        var result = await Handler(h, renamed).Handle(new GoogleSignInCommand(Token), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(created.Value.User.Id, result.Value.User.Id);
        Assert.Equal(1, await h.Db.Users.CountAsync());
    }

    [Fact]
    public async Task Rejects_an_invalid_token_and_creates_nothing()
    {
        using var h = new TestHarness();

        var result = await Handler(h, new StubGoogleTokenValidator())
            .Handle(new GoogleSignInCommand("not-a-real-token"), default);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_INVALID_GOOGLE_TOKEN", result.Error.Code);
        Assert.Equal(0, await h.Db.Users.CountAsync());
    }

    [Fact]
    public async Task Rejects_an_unverified_email_and_creates_nothing()
    {
        using var h = new TestHarness();
        var google = new StubGoogleTokenValidator().Accept(Token, Subject, Email, emailVerified: false);

        var result = await Handler(h, google).Handle(new GoogleSignInCommand(Token), default);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_GOOGLE_EMAIL_UNVERIFIED", result.Error.Code);
        Assert.Equal(0, await h.Db.Users.CountAsync());
    }

    [Fact]
    public async Task Refuses_a_deactivated_account()
    {
        using var h = new TestHarness();
        var google = new StubGoogleTokenValidator().Accept(Token, Subject, Email);
        await Handler(h, google).Handle(new GoogleSignInCommand(Token), default);

        var user = await h.Db.Users.SingleAsync();
        // No production path deactivates an account yet (the same branch in LoginCommand is
        // reached the same way), so set the flag through EF rather than widen the domain API.
        h.Db.Entry(user).Property(nameof(User.IsActive)).CurrentValue = false;
        await h.Db.SaveChangesAsync();

        var result = await Handler(h, google).Handle(new GoogleSignInCommand(Token), default);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_ACCOUNT_INACTIVE", result.Error.Code);
    }

    [Fact]
    public async Task Issues_a_usable_refresh_token()
    {
        using var h = new TestHarness();
        var google = new StubGoogleTokenValidator().Accept(Token, Subject, Email);

        var result = await Handler(h, google).Handle(new GoogleSignInCommand(Token), default);

        Assert.False(string.IsNullOrWhiteSpace(result.Value.AccessToken));
        Assert.False(string.IsNullOrWhiteSpace(result.Value.RefreshToken));
        Assert.True(await h.Db.RefreshTokens.AnyAsync(t => t.UserId == result.Value.User.Id));
    }

    private static GoogleSignInCommandHandler Handler(TestHarness h, StubGoogleTokenValidator google)
        => new(h.Db, google, h.TokenIssuer, h.Clock, h.Email);
}
