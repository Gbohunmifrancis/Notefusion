using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Auth;

/// <summary>
/// Refresh tokens as a credential: spent once, revoked when the password changes, and a stolen copy coming
/// back costs the thief (and the user) every session. Each request is run on a cleared change tracker, as a
/// fresh request scope would be, so what is asserted is what the database holds.
/// </summary>
public class RefreshTokenSecurityTests
{
    [Fact]
    public async Task A_token_issued_before_a_password_reset_cannot_refresh_after_it()
    {
        using var h = new TestHarness();
        var user = await Seed(h);
        var before = await IssueAsync(h, user);

        user.SetPasswordResetToken(Sha256Hex("reset-me"), h.Clock.UtcNow);
        await h.Db.SaveChangesAsync();
        h.Db.ChangeTracker.Clear();

        var reset = await new ResetPasswordCommandHandler(h.Db, h.Hasher, h.Clock, h.Email)
            .Handle(new ResetPasswordCommand(user.Email, "reset-me", "brand-new-pw1"), default);
        Assert.True(reset.IsSuccess);
        h.Db.ChangeTracker.Clear();

        var refreshed = await Refresh(h).Handle(new RefreshTokenCommand(before), default);

        Assert.True(refreshed.IsFailure);
        Assert.Equal("AUTH_INVALID_REFRESH_TOKEN", refreshed.Error.Code);
    }

    [Fact]
    public async Task Changing_the_password_revokes_other_sessions_but_keeps_the_new_one()
    {
        using var h = new TestHarness();
        var user = await Seed(h);
        var otherDevice = await IssueAsync(h, user);
        h.Db.ChangeTracker.Clear();

        var changed = await new ChangePasswordCommandHandler(
                h.Db, h.Hasher, h.TokenIssuer, h.Clock, new StubCurrentUser(user.Id), h.Email, h.QuotaGate)
            .Handle(new ChangePasswordCommand("s3cretpw!", "brand-new-pw1"), default);
        Assert.True(changed.IsSuccess);
        h.Db.ChangeTracker.Clear();

        var stale = await Refresh(h).Handle(new RefreshTokenCommand(otherDevice), default);
        h.Db.ChangeTracker.Clear();
        var fresh = await Refresh(h).Handle(new RefreshTokenCommand(changed.Value.RefreshToken), default);

        Assert.True(stale.IsFailure);
        Assert.True(fresh.IsSuccess);
    }

    [Fact]
    public async Task A_token_redeemed_twice_works_only_the_first_time()
    {
        using var h = new TestHarness();
        var user = await Seed(h);
        var token = await IssueAsync(h, user);
        h.Db.ChangeTracker.Clear();

        var first = await Refresh(h).Handle(new RefreshTokenCommand(token), default);
        h.Db.ChangeTracker.Clear();
        var second = await Refresh(h).Handle(new RefreshTokenCommand(token), default);

        Assert.True(first.IsSuccess);
        Assert.True(second.IsFailure);
        Assert.Equal("AUTH_INVALID_REFRESH_TOKEN", second.Error.Code);

        // Inside the grace window the repeat is taken for a second tab, not a thief: the session it lost the
        // race to keeps working.
        h.Db.ChangeTracker.Clear();
        var successor = await Refresh(h).Handle(new RefreshTokenCommand(first.Value.RefreshToken), default);
        Assert.True(successor.IsSuccess);
    }

    [Fact]
    public async Task A_rotated_token_coming_back_later_revokes_every_session_of_the_user()
    {
        using var h = new TestHarness();
        var user = await Seed(h);
        var stolen = await IssueAsync(h, user);
        var otherDevice = await IssueAsync(h, user);
        h.Db.ChangeTracker.Clear();

        var rotated = await Refresh(h).Handle(new RefreshTokenCommand(stolen), default);
        Assert.True(rotated.IsSuccess);
        h.Db.ChangeTracker.Clear();

        // The chain moves on: its owner spends the successor, so two parties now hold it.
        var moved = await Refresh(h).Handle(new RefreshTokenCommand(rotated.Value.RefreshToken), default);
        Assert.True(moved.IsSuccess);
        h.Db.ChangeTracker.Clear();

        h.Clock.UtcNow = h.Clock.UtcNow.AddSeconds(31);
        var replay = await Refresh(h).Handle(new RefreshTokenCommand(stolen), default);
        Assert.True(replay.IsFailure);
        h.Db.ChangeTracker.Clear();

        Assert.False(await h.Db.RefreshTokens.AnyAsync(t => t.UserId == user.Id && !t.IsRevoked));
        Assert.True((await Refresh(h).Handle(new RefreshTokenCommand(moved.Value.RefreshToken), default)).IsFailure);
        h.Db.ChangeTracker.Clear();
        Assert.True((await Refresh(h).Handle(new RefreshTokenCommand(otherDevice), default)).IsFailure);
    }

    [Fact]
    public async Task A_replay_after_a_lost_rotation_answer_is_refused_but_signs_nobody_out()
    {
        using var h = new TestHarness();
        var user = await Seed(h);
        var token = await IssueAsync(h, user);
        var otherDevice = await IssueAsync(h, user);
        h.Db.ChangeTracker.Clear();

        // The server rotates, but the answer never reaches the phone (a timeout on a weak connection).
        var lost = await Refresh(h).Handle(new RefreshTokenCommand(token), default);
        Assert.True(lost.IsSuccess);
        h.Db.ChangeTracker.Clear();

        h.Clock.UtcNow = h.Clock.UtcNow.AddMinutes(5);
        Assert.True((await Refresh(h).Handle(new RefreshTokenCommand(token), default)).IsFailure);
        h.Db.ChangeTracker.Clear();

        // Only that one phone has to sign in again; every other session is untouched.
        Assert.True((await Refresh(h).Handle(new RefreshTokenCommand(otherDevice), default)).IsSuccess);
    }

    [Fact]
    public async Task A_token_with_the_right_id_but_a_wrong_secret_neither_refreshes_nor_logs_out()
    {
        using var h = new TestHarness();
        var user = await Seed(h);
        var token = await IssueAsync(h, user);
        var forged = token[..(token.IndexOf('.') + 1)] + "not-the-secret";
        h.Db.ChangeTracker.Clear();

        var refreshed = await Refresh(h).Handle(new RefreshTokenCommand(forged), default);
        var loggedOut = await new LogoutCommandHandler(h.Db, h.Hasher, h.Clock)
            .Handle(new LogoutCommand(forged), default);
        h.Db.ChangeTracker.Clear();

        Assert.True(refreshed.IsFailure);
        Assert.True(loggedOut.IsSuccess); // says nothing either way
        Assert.True((await Refresh(h).Handle(new RefreshTokenCommand(token), default)).IsSuccess);
    }

    [Fact]
    public async Task Logout_with_the_real_token_revokes_it()
    {
        using var h = new TestHarness();
        var user = await Seed(h);
        var token = await IssueAsync(h, user);
        h.Db.ChangeTracker.Clear();

        await new LogoutCommandHandler(h.Db, h.Hasher, h.Clock).Handle(new LogoutCommand(token), default);
        h.Db.ChangeTracker.Clear();

        Assert.True((await Refresh(h).Handle(new RefreshTokenCommand(token), default)).IsFailure);
    }

    private static RefreshTokenCommandHandler Refresh(TestHarness h)
        => new(h.Db, h.Hasher, h.TokenIssuer, h.Clock);

    private static async Task<string> IssueAsync(TestHarness h, User user)
    {
        var pair = h.TokenIssuer.Issue(user);
        await h.Db.SaveChangesAsync();
        return pair.RefreshToken;
    }

    private static async Task<User> Seed(TestHarness h)
    {
        var user = User.Create("Test User", "grace@example.com", h.Hasher.Hash("s3cretpw!"), h.Clock.UtcNow);
        h.MarkEmailVerified(user);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user;
    }

    private static string Sha256Hex(string value)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}
