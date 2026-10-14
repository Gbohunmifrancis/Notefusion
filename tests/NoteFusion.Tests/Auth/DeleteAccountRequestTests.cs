using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;
using NoteFusion.Infrastructure.Security;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Auth;

public class DeleteAccountRequestTests
{
    private static readonly DateTime Now = new(2026, 8, 25, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Non_existent_email_returns_neutral_success_and_sends_nothing()
    {
        using var h = new TestHarness(Now);
        var handler = CreateHandler(h);

        var result = await handler.Handle(
            new DeleteAccountRequestCommand("doesnotexist@example.com"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Success);
        Assert.False(result.Value.Confirmed);
        Assert.Empty(h.Email.Sent);
    }

    [Fact]
    public async Task Valid_password_immediately_deletes_account_and_associated_transcriptions()
    {
        using var h = new TestHarness(Now);
        var user = CreateUser(h, "alice@example.com", "Password123!");

        var transcription = new Transcription(
            user.Id,
            title: "Sunday Solo",
            key: new MusicalKey(0, KeyMode.Major),
            tempoBpm: 120,
            timeSignature: "4/4",
            musicXml: "<score/>",
            notes: Array.Empty<NoteEvent>(),
            overallConfidence: 0.95);

        h.Db.Transcriptions.Add(transcription);
        await h.Db.SaveChangesAsync();

        var handler = CreateHandler(h);

        var result = await handler.Handle(
            new DeleteAccountRequestCommand(user.Email, Password: "Password123!", Reason: "No longer playing piano"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Success);
        Assert.True(result.Value.Confirmed);

        // Verify user and data are deleted from the database
        Assert.Null(h.Db.Users.Find(user.Id));
        Assert.Empty(h.Db.Transcriptions.Where(t => t.UserId == user.Id));

        // Verify goodbye confirmation email was sent
        Assert.Contains(h.Email.CustomEmails, e => e.To.Email == user.Email && e.Subject.Contains("deleted"));
    }

    [Fact]
    public async Task Incorrect_password_is_rejected_and_preserves_account()
    {
        using var h = new TestHarness(Now);
        var user = CreateUser(h, "bob@example.com", "Password123!");
        var handler = CreateHandler(h);

        var result = await handler.Handle(
            new DeleteAccountRequestCommand(user.Email, Password: "WrongPassword!"),
            CancellationToken.None);
        var unknown = await handler.Handle(
            new DeleteAccountRequestCommand("nobody@example.com", Password: "WrongPassword!"),
            CancellationToken.None);

        // Nothing deleted, and told in exactly the words an unknown address gets, so this anonymous page
        // cannot be used to find out which addresses have accounts.
        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Confirmed);
        Assert.Equal(unknown.Value, result.Value);

        // User is still intact in DB
        Assert.NotNull(h.Db.Users.Find(user.Id));
        Assert.Empty(h.Email.CustomEmails);
    }

    [Fact]
    public async Task Repeated_wrong_passwords_lock_the_account_like_login_does()
    {
        using var h = new TestHarness(Now);
        var user = CreateUser(h, "frank@example.com", "Password123!");
        var handler = CreateHandler(h);

        for (var i = 0; i < User.MaxFailedLoginAttempts; i++)
            await handler.Handle(new DeleteAccountRequestCommand(user.Email, Password: "WrongPassword!"), CancellationToken.None);

        // Locked: even the right password deletes nothing, and the answer is the same neutral one.
        var locked = await handler.Handle(
            new DeleteAccountRequestCommand(user.Email, Password: "Password123!"), CancellationToken.None);

        Assert.True(locked.IsSuccess);
        Assert.False(locked.Value.Confirmed);
        Assert.Equal(DeleteAccountRequestCommandHandler.NotDeletedMessage, locked.Value.Message);
        Assert.NotNull(h.Db.Users.Find(user.Id));
    }

    [Fact]
    public async Task Asking_for_a_link_reads_the_same_whether_or_not_the_address_has_an_account()
    {
        using var h = new TestHarness(Now);
        var user = CreateUser(h, "gina@example.com", "Password123!");
        var handler = CreateHandler(h);

        var known = await handler.Handle(new DeleteAccountRequestCommand(user.Email), CancellationToken.None);
        var unknown = await handler.Handle(new DeleteAccountRequestCommand("nobody@example.com"), CancellationToken.None);

        Assert.Equal(unknown.Value, known.Value);
        Assert.Single(h.Email.CustomEmails); // only the real account is mailed
    }

    [Fact]
    public async Task A_link_signed_with_the_published_default_secret_no_longer_deletes()
    {
        using var h = new TestHarness(Now);
        var user = CreateUser(h, "mallory-target@example.com", "Password123!");
        var handler = CreateHandler(h);

        // Exactly what anyone could compute from the old source: the HMAC keyed by the constant that used to
        // be the default, over fields that are not secret.
        var forged = LegacyToken(user, Now.AddHours(24), AuthSettings.PublishedDeletionSecret);

        var result = await handler.Handle(
            new DeleteAccountRequestCommand(user.Email, Token: forged), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("auth.invalid_token", result.Error.Code);
        Assert.NotNull(h.Db.Users.Find(user.Id));
    }

    [Fact]
    public void The_published_default_and_an_empty_secret_are_replaced_but_an_own_secret_is_kept()
    {
        using var keys = new RsaKeyProvider(new JwtSettings());

        var published = new AuthSettings { DeletionSecret = AuthSettings.PublishedDeletionSecret };
        var empty = new AuthSettings();
        var own = new AuthSettings { DeletionSecret = "configured-by-the-deploy" };

        Assert.True(DeletionSecretFallback.Apply(published, keys));
        Assert.True(DeletionSecretFallback.Apply(empty, keys));
        Assert.False(DeletionSecretFallback.Apply(own, keys));

        Assert.NotEqual(AuthSettings.PublishedDeletionSecret, published.DeletionSecret);
        Assert.Equal(published.DeletionSecret, empty.DeletionSecret); // stable for one key
        Assert.Equal("configured-by-the-deploy", own.DeletionSecret);

        // A different signing key derives a different secret.
        using var otherKeys = new RsaKeyProvider(new JwtSettings());
        var other = new AuthSettings();
        DeletionSecretFallback.Apply(other, otherKeys);
        Assert.NotEqual(empty.DeletionSecret, other.DeletionSecret);
    }

    private static string LegacyToken(User user, DateTime expiryUtc, string secret)
    {
        var expiryTicks = expiryUtc.Ticks;
        var raw = $"{user.Id}:{user.Email.ToLowerInvariant()}:{expiryTicks}";
        var keyBytes = Encoding.UTF8.GetBytes(secret + ":" + user.CreatedAt.Ticks + ":" + (user.PasswordHash ?? "oauth") + ":" + user.Id);
        using var hmac = new HMACSHA256(keyBytes);
        var hashString = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(raw)));
        return Convert.ToBase64String(Encoding.UTF8.GetBytes($"{user.Id}:{expiryTicks}:{hashString}"))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    [Fact]
    public async Task Blank_password_dispatches_email_confirmation_link()
    {
        using var h = new TestHarness(Now);
        var user = CreateUser(h, "charlie@example.com", "Password123!");
        var handler = CreateHandler(h);

        var result = await handler.Handle(
            new DeleteAccountRequestCommand(user.Email),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Success);
        Assert.False(result.Value.Confirmed);

        // Account is still intact until confirmed
        Assert.NotNull(h.Db.Users.Find(user.Id));

        // Confirmation email with link was dispatched
        var sentEmail = Assert.Single(h.Email.CustomEmails);
        Assert.Equal(user.Email, sentEmail.To.Email);
        Assert.Contains("confirm", sentEmail.Subject, StringComparison.OrdinalIgnoreCase);
        Assert.NotNull(sentEmail.CtaUrl);
        Assert.Contains("token=", sentEmail.CtaUrl);
        Assert.Contains("email=" + Uri.EscapeDataString(user.Email), sentEmail.CtaUrl);
    }

    [Fact]
    public async Task Valid_token_from_confirmation_link_deletes_account()
    {
        using var h = new TestHarness(Now);
        var user = CreateUser(h, "dave@example.com", "Password123!");
        var handler = CreateHandler(h);

        // Step 1: Request deletion link
        await handler.Handle(new DeleteAccountRequestCommand(user.Email), CancellationToken.None);
        var sentEmail = Assert.Single(h.Email.CustomEmails);
        var uri = new Uri(sentEmail.CtaUrl!);
        var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
        var token = query["token"];
        Assert.False(string.IsNullOrWhiteSpace(token));

        // Step 2: Confirm with token
        var confirmResult = await handler.Handle(
            new DeleteAccountRequestCommand(user.Email, Token: token),
            CancellationToken.None);

        Assert.True(confirmResult.IsSuccess);
        Assert.True(confirmResult.Value.Success);
        Assert.True(confirmResult.Value.Confirmed);

        // Account is deleted
        Assert.Null(h.Db.Users.Find(user.Id));
    }

    [Fact]
    public async Task Tampered_or_expired_token_is_rejected()
    {
        using var h = new TestHarness(Now);
        var user = CreateUser(h, "eve@example.com", "Password123!");
        var handler = CreateHandler(h);

        // Step 1: Request deletion link
        await handler.Handle(new DeleteAccountRequestCommand(user.Email), CancellationToken.None);
        var sentEmail = Assert.Single(h.Email.CustomEmails);
        var uri = new Uri(sentEmail.CtaUrl!);
        var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
        var token = query["token"];

        // Case A: Tampered token
        var tamperedResult = await handler.Handle(
            new DeleteAccountRequestCommand(user.Email, Token: token + "bad"),
            CancellationToken.None);

        Assert.True(tamperedResult.IsFailure);
        Assert.Equal("auth.invalid_token", tamperedResult.Error.Code);
        Assert.NotNull(h.Db.Users.Find(user.Id));

        // Case B: Expired token (> 24 hours)
        h.Clock.UtcNow = h.Clock.UtcNow.AddHours(25);
        var expiredResult = await handler.Handle(
            new DeleteAccountRequestCommand(user.Email, Token: token),
            CancellationToken.None);

        Assert.True(expiredResult.IsFailure);
        Assert.Equal("auth.invalid_token", expiredResult.Error.Code);
        Assert.NotNull(h.Db.Users.Find(user.Id));
    }

    private static DeleteAccountRequestCommandHandler CreateHandler(TestHarness h)
    {
        return new DeleteAccountRequestCommandHandler(
            h.Db,
            h.Hasher,
            h.Email,
            h.Clock,
            h.Auth,
            NullLogger<DeleteAccountRequestCommandHandler>.Instance);
    }

    private static User CreateUser(TestHarness h, string email, string password)
    {
        var passwordHash = h.Hasher.Hash(password);
        var user = User.Create("Test User", email, passwordHash, h.Clock.UtcNow);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }
}
