using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Auth;

/// <summary>Behavioural tests for the auth handlers over a real DB + real security services.</summary>
public class AuthHandlerTests
{
    [Fact]
    public async Task Register_creates_a_user_and_emails_a_code_but_issues_no_tokens()
    {
        using var h = new TestHarness();
        var handler = new RegisterCommandHandler(h.Db, h.Hasher, h.Tokens, h.Clock, h.Email, h.Country);

        var result = await handler.Handle(new RegisterCommand("Ada Lovelace", "ada@example.com", "password123"), default);

        Assert.True(result.IsSuccess);
        Assert.Equal("ada@example.com", result.Value.Email);
        Assert.True(await h.Db.Users.AnyAsync(u => u.Email == "ada@example.com"));

        // The account exists but is not usable yet, and nothing was handed back that could be used: the
        // response type carries no tokens at all, which is what makes the code a gate rather than a nag.
        Assert.False(Assert.Single(h.Db.Users).EmailVerified);
        Assert.Contains(h.Email.Sent, s => s.Kind == "email-verification" && s.To.Email == "ada@example.com");
        Assert.Equal(6, h.Email.VerificationCodes.Single().Length);

        // The welcome waits for the code — there is no point welcoming a mailbox we have not reached.
        Assert.DoesNotContain(h.Email.Sent, s => s.Kind == "welcome");
    }

    [Fact]
    public async Task Register_rejects_a_duplicate_email_case_insensitively()
    {
        using var h = new TestHarness();
        var handler = new RegisterCommandHandler(h.Db, h.Hasher, h.Tokens, h.Clock, h.Email, h.Country);
        await handler.Handle(new RegisterCommand("Ada", "ada@example.com", "password123"), default);

        var duplicate = await handler.Handle(new RegisterCommand("Ada Two", "ADA@example.com", "password123"), default);

        Assert.True(duplicate.IsFailure);
        Assert.Equal("USER_EMAIL_EXISTS", duplicate.Error.Code);
        // The rejected sign-up must not mail a code: exactly one, for the account that was created.
        Assert.Single(h.Email.Sent, s => s.Kind == "email-verification");
    }

    [Fact]
    public async Task Login_succeeds_with_correct_credentials()
    {
        using var h = new TestHarness();
        await Seed(h, "grace@example.com", "s3cretpw!");
        var handler = Login(h);

        var result = await handler.Handle(new LoginCommand("grace@example.com", "s3cretpw!"), default);

        Assert.True(result.IsSuccess);
        Assert.NotEmpty(result.Value.AccessToken);
    }

    [Fact]
    public async Task Login_with_wrong_password_returns_invalid_credentials()
    {
        using var h = new TestHarness();
        await Seed(h, "grace@example.com", "s3cretpw!");
        var handler = Login(h);

        var result = await handler.Handle(new LoginCommand("grace@example.com", "wrong"), default);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_INVALID_CREDENTIALS", result.Error.Code);
    }

    [Fact]
    public async Task Repeated_failed_logins_lock_the_account()
    {
        using var h = new TestHarness();
        await Seed(h, "grace@example.com", "s3cretpw!");
        var handler = Login(h);

        for (var i = 0; i < User.MaxFailedLoginAttempts; i++)
            await handler.Handle(new LoginCommand("grace@example.com", "wrong"), default);

        // Even the correct password is refused while locked out.
        var afterLock = await handler.Handle(new LoginCommand("grace@example.com", "s3cretpw!"), default);

        Assert.True(afterLock.IsFailure);
        Assert.Equal("AUTH_ACCOUNT_LOCKED", afterLock.Error.Code);
    }

    [Fact]
    public async Task Unknown_email_returns_invalid_credentials_not_not_found()
    {
        using var h = new TestHarness();
        var handler = Login(h);

        var result = await handler.Handle(new LoginCommand("nobody@example.com", "whatever"), default);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_INVALID_CREDENTIALS", result.Error.Code); // no account enumeration
    }

    private static LoginCommandHandler Login(TestHarness h)
        => new(h.Db, h.Hasher, h.TokenIssuer, h.Tokens, h.Clock, h.Country, h.Email);

    private static async Task Seed(TestHarness h, string email, string password)
    {
        var user = User.Create("Test User", email, h.Hasher.Hash(password), h.Clock.UtcNow);
        h.MarkEmailVerified(user);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
    }
}
