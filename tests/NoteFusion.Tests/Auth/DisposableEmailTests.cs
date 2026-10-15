using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Auth;

/// <summary>
/// Throwaway inboxes are refused at password sign-up: one passes the emailed code and is gone minutes later,
/// and each was a fresh set of free transcriptions. Nothing else is touched — not Google sign-in, and not an
/// account that already exists on such a domain.
/// </summary>
public class DisposableEmailTests
{
    private const string Refusal =
        "Please use a permanent email address. Temporary inboxes can't receive your NoteFusion sheets.";

    [Theory]
    [InlineData("someone@mailinator.com")]
    [InlineData("Someone@MAILINATOR.com")]
    [InlineData("x@yopmail.com")]
    [InlineData("x@guerrillamail.com")]
    [InlineData("x@sharklasers.com")]
    [InlineData("x@10minutemail.com")]
    [InlineData("x@temp-mail.org")]
    public async Task Register_refuses_a_throwaway_inbox_with_a_plain_sentence(string email)
    {
        using var h = new TestHarness();

        var result = await Register(h, email);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_DISPOSABLE_EMAIL", result.Error.Code);
        Assert.Equal(Refusal, result.Error.Message);
        Assert.Empty(h.Db.Users);
        Assert.Empty(h.Email.Sent); // no code mailed to a throwaway inbox
    }

    [Fact]
    public async Task A_subdomain_of_a_throwaway_domain_is_refused_too()
    {
        using var h = new TestHarness();

        var result = await Register(h, "x@inbox.mailinator.com");

        Assert.Equal("AUTH_DISPOSABLE_EMAIL", result.Error.Code);
    }

    [Theory]
    [InlineData("ada@gmail.com")]
    [InlineData("ada@example.com")]
    [InlineData("ada@yahoo.com")]
    [InlineData("ada@notmailinator.org")] // a name that merely contains a listed one
    [InlineData("ada@mailinator.com.ng")] // a listed domain as a prefix, not a parent
    public async Task An_ordinary_address_signs_up(string email)
    {
        using var h = new TestHarness();

        var result = await Register(h, email);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : "");
        Assert.Single(h.Db.Users);
    }

    [Fact]
    public async Task Google_sign_in_is_not_asked()
    {
        using var h = new TestHarness();
        var google = new StubGoogleTokenValidator().Accept("token", "sub-1", "someone@mailinator.com");

        var result = await new GoogleSignInCommandHandler(h.Db, google, h.TokenIssuer, h.Clock, h.Email, h.Country)
            .Handle(new GoogleSignInCommand("token"), default);

        Assert.True(result.IsSuccess);
        Assert.True(await h.Db.Users.AnyAsync(u => u.Email == "someone@mailinator.com"));
    }

    [Fact]
    public async Task An_existing_account_on_a_throwaway_domain_still_signs_in()
    {
        using var h = new TestHarness();
        var user = User.Create("Old", "old@mailinator.com", h.Hasher.Hash("password123"), h.Clock.UtcNow);
        h.MarkEmailVerified(user);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();

        var result = await new LoginCommandHandler(h.Db, h.Hasher, h.TokenIssuer, h.Tokens, h.Clock, h.Country, h.Email)
            .Handle(new LoginCommand("old@mailinator.com", "password123"), default);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public void The_bundled_list_loads()
    {
        Assert.True(DisposableEmailDomains.Count >= 150);
        Assert.False(DisposableEmailDomains.IsDisposable("not-an-address"));
        Assert.False(DisposableEmailDomains.IsDisposable("ada@"));
    }

    private static Task<NoteFusion.Shared.Results.Result<Application.Auth.Dtos.RegistrationResponse>> Register(
        TestHarness h, string email)
        => new RegisterCommandHandler(h.Db, h.Hasher, h.Tokens, h.Clock, h.Email, h.Country)
            .Handle(new RegisterCommand("Ada", email, "password123"), default);
}
