using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Devices.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Devices;

/// <summary>
/// Push-token registration tests. Registration runs on every sign-in with the same token,
/// so the re-register path is the common one, not an edge case — and a unique index on
/// (UserId, Token) turns any failure to dedupe into a 500. The client swallows that error,
/// which is exactly why it needs pinning here.
/// </summary>
public class RegisterDeviceTests
{
    private const string Token = "ExponentPushToken[abc123]";

    [Fact]
    public async Task Registers_a_token_for_the_current_user()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);

        var result = await RegisterHandler(h, user.Id)
            .Handle(new RegisterDeviceCommand(Token, "android"), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, await h.Db.DeviceTokens.CountAsync(t => t.UserId == user.Id));
    }

    [Fact]
    public async Task Re_registering_the_same_token_touches_it_instead_of_inserting_a_second_row()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);

        await RegisterHandler(h, user.Id).Handle(new RegisterDeviceCommand(Token, "android"), default);

        // A later sign-in, with the same token. The tracker clear matters: each registration is
        // its own request in production, so the entity arrives with an empty DeviceTokens
        // collection. Without the include it scans that empty collection, Adds again, and the
        // unique index on (UserId, Token) rejects the insert.
        h.Db.ChangeTracker.Clear();
        h.Clock.UtcNow = h.Clock.UtcNow.AddDays(1);
        var result = await RegisterHandler(h, user.Id)
            .Handle(new RegisterDeviceCommand(Token, "android"), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, await h.Db.DeviceTokens.CountAsync(t => t.UserId == user.Id));

        // UpdatedAt is what stale-token pruning reads, so a no-op refresh is not good enough.
        var stored = await h.Db.DeviceTokens.SingleAsync(t => t.UserId == user.Id);
        Assert.Equal(h.Clock.UtcNow, stored.UpdatedAt);
    }

    [Fact]
    public async Task Two_devices_belonging_to_one_user_both_survive()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);

        await RegisterHandler(h, user.Id).Handle(new RegisterDeviceCommand(Token, "android"), default);
        await RegisterHandler(h, user.Id)
            .Handle(new RegisterDeviceCommand("ExponentPushToken[phone2]", "ios"), default);

        Assert.Equal(2, await h.Db.DeviceTokens.CountAsync(t => t.UserId == user.Id));
    }

    [Fact]
    public async Task Unregistering_drops_the_token_so_the_server_stops_sending()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        await RegisterHandler(h, user.Id).Handle(new RegisterDeviceCommand(Token, "android"), default);

        var result = await UnregisterHandler(h, user.Id)
            .Handle(new UnregisterDeviceCommand(Token), default);

        Assert.True(result.IsSuccess);
        Assert.False(await h.Db.DeviceTokens.AnyAsync(t => t.UserId == user.Id));
    }

    [Fact]
    public async Task Unregistering_an_unknown_token_succeeds()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);

        // Turning notifications off twice, or from a device whose token was already pruned,
        // is not an error — the caller only cares that we will not send there.
        var result = await UnregisterHandler(h, user.Id)
            .Handle(new UnregisterDeviceCommand("ExponentPushToken[never-registered]"), default);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task Unregistering_leaves_another_users_device_alone()
    {
        using var h = new TestHarness();
        var mine = await SeedUser(h);
        var theirs = await SeedUser(h, "other@example.com");

        // The same physical device signed into two accounts in turn: both rows carry this
        // token, and only the caller's may go.
        await RegisterHandler(h, mine.Id).Handle(new RegisterDeviceCommand(Token, "android"), default);
        await RegisterHandler(h, theirs.Id).Handle(new RegisterDeviceCommand(Token, "android"), default);

        await UnregisterHandler(h, mine.Id).Handle(new UnregisterDeviceCommand(Token), default);

        Assert.False(await h.Db.DeviceTokens.AnyAsync(t => t.UserId == mine.Id));
        Assert.True(await h.Db.DeviceTokens.AnyAsync(t => t.UserId == theirs.Id));
    }

    [Fact]
    public async Task Rejects_an_unauthenticated_caller()
    {
        using var h = new TestHarness();
        await SeedUser(h);

        var result = await new RegisterDeviceCommandHandler(h.Db, h.Clock, new StubCurrentUser(null))
            .Handle(new RegisterDeviceCommand(Token, "android"), default);

        Assert.True(result.IsFailure);
        Assert.False(await h.Db.DeviceTokens.AnyAsync());
    }

    private static RegisterDeviceCommandHandler RegisterHandler(TestHarness h, Guid userId)
        => new(h.Db, h.Clock, new StubCurrentUser(userId));

    private static UnregisterDeviceCommandHandler UnregisterHandler(TestHarness h, Guid userId)
        => new(h.Db, new StubCurrentUser(userId));

    private static async Task<User> SeedUser(TestHarness h, string email = "user@example.com")
    {
        var user = User.Create("Test User", email, h.Hasher.Hash("password123"), h.Clock.UtcNow);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user;
    }
}
