using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Devices.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Devices;

/// <summary>
/// The "a newer build is in the store" push. Two properties matter and neither is visible from
/// reading the handler once: it must reach a user exactly once per release however often the sweep
/// runs, and it must stay completely silent on a deployment that has not been told about a release —
/// the default state of every environment, and the one where getting it wrong tells every user to
/// update to the build they are already running.
/// </summary>
public class NotifyAppUpdateTests
{
    private const string Token = "ExponentPushToken[abc123]";

    [Fact]
    public async Task Notifies_a_user_whose_device_is_behind()
    {
        using var h = new TestHarness();
        var user = await SeedUserWithDevice(h, appBuild: 12);

        var result = await Handler(h, latestBuild: 14).Handle(new NotifyAppUpdateCommand(user.Id), default);

        Assert.True(result.IsSuccess);
        var (recipients, message) = Assert.Single(h.Push.Sent);
        Assert.Equal([user.Id], recipients);
        Assert.Contains("1.2.0", message.Title);
        Assert.Equal("AppUpdate", message.Data!["screen"]);
    }

    [Fact]
    public async Task Sends_once_per_release_however_often_the_sweep_runs()
    {
        using var h = new TestHarness();
        var user = await SeedUserWithDevice(h, appBuild: 12);

        await Handler(h, latestBuild: 14).Handle(new NotifyAppUpdateCommand(user.Id), default);

        // The sweep runs hourly and the device stays behind until the user actually updates, so a
        // second call is the ordinary case rather than an edge one. Tracker cleared because each
        // sweep gets its own scope in production, and a cached entity would hide a missing write.
        h.Db.ChangeTracker.Clear();
        await Handler(h, latestBuild: 14).Handle(new NotifyAppUpdateCommand(user.Id), default);

        Assert.Single(h.Push.Sent);
    }

    [Fact]
    public async Task A_further_release_notifies_again()
    {
        using var h = new TestHarness();
        var user = await SeedUserWithDevice(h, appBuild: 12);

        await Handler(h, latestBuild: 14).Handle(new NotifyAppUpdateCommand(user.Id), default);
        h.Db.ChangeTracker.Clear();
        await Handler(h, latestBuild: 15).Handle(new NotifyAppUpdateCommand(user.Id), default);

        // The once-per-release claim is keyed on the build, so a genuinely new release still gets
        // through. A plain "already notified" flag would pass the test above and fail this one.
        Assert.Equal(2, h.Push.Sent.Count);
    }

    [Fact]
    public async Task Says_nothing_when_the_device_is_already_up_to_date()
    {
        using var h = new TestHarness();
        var user = await SeedUserWithDevice(h, appBuild: 14);

        var result = await Handler(h, latestBuild: 14).Handle(new NotifyAppUpdateCommand(user.Id), default);

        Assert.True(result.IsSuccess);
        Assert.Empty(h.Push.Sent);
    }

    [Fact]
    public async Task Says_nothing_when_no_release_has_been_configured()
    {
        using var h = new TestHarness();
        var user = await SeedUserWithDevice(h, appBuild: 12);

        // LatestBuild unset is every environment's starting state. Without this guard the comparison
        // reads "anything is behind zero" the wrong way round on the first deploy that forgets it.
        var result = await Handler(h, latestBuild: 0).Handle(new NotifyAppUpdateCommand(user.Id), default);

        Assert.True(result.IsSuccess);
        Assert.Empty(h.Push.Sent);
    }

    [Fact]
    public async Task A_second_device_on_the_same_account_does_not_earn_a_second_notice()
    {
        using var h = new TestHarness();
        var user = await SeedUserWithDevice(h, appBuild: 12);
        user.RegisterDeviceToken("ExponentPushToken[tablet]", "android", 13, h.Clock.UtcNow);
        await h.Db.SaveChangesAsync();

        await Handler(h, latestBuild: 14).Handle(new NotifyAppUpdateCommand(user.Id), default);
        h.Db.ChangeTracker.Clear();
        await Handler(h, latestBuild: 14).Handle(new NotifyAppUpdateCommand(user.Id), default);

        // The push addresses a user, so it already reached both handsets. Marking only the row that
        // triggered it would leave the sibling behind and send the whole notice again next sweep.
        Assert.Single(h.Push.Sent);
        Assert.All(
            await h.Db.DeviceTokens.Where(t => t.UserId == user.Id).ToListAsync(),
            t => Assert.Equal(14, t.NotifiedBuild));
    }

    [Fact]
    public async Task Reporting_the_new_build_stops_the_notice()
    {
        using var h = new TestHarness();
        var user = await SeedUserWithDevice(h, appBuild: 12);

        // The user updated through the store and the app re-registered its token on next launch.
        user.RegisterDeviceToken(Token, "android", 14, h.Clock.UtcNow);
        await h.Db.SaveChangesAsync();

        await Handler(h, latestBuild: 14).Handle(new NotifyAppUpdateCommand(user.Id), default);

        Assert.Empty(h.Push.Sent);
    }

    [Fact]
    public async Task A_user_with_no_devices_left_is_not_a_failure()
    {
        using var h = new TestHarness();
        var user = User.Create("Test User", "user@example.com", h.Hasher.Hash("password123"), h.Clock.UtcNow);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();

        // Unregistered between the sweep reading the row and the command running. Nobody to tell,
        // which is the state the command wanted anyway — not something to log as a failed notice.
        var result = await Handler(h, latestBuild: 14).Handle(new NotifyAppUpdateCommand(user.Id), default);

        Assert.True(result.IsSuccess);
        Assert.Empty(h.Push.Sent);
    }

    private static NotifyAppUpdateCommandHandler Handler(TestHarness h, int latestBuild)
        => new(h.Db, h.Clock, h.Push, new AppReleaseSettings
        {
            LatestVersion = "1.2.0",
            LatestBuild = latestBuild,
            ReleaseNotes = "Faster transcription.",
        });

    private static async Task<User> SeedUserWithDevice(TestHarness h, int appBuild)
    {
        var user = User.Create("Test User", "user@example.com", h.Hasher.Hash("password123"), h.Clock.UtcNow);
        user.RegisterDeviceToken(Token, "android", appBuild, h.Clock.UtcNow);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user;
    }
}
