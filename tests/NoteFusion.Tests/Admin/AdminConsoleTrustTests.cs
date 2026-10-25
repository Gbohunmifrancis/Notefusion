using NoteFusion.Application.Admin.PhoneLock;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Security;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

/// <summary>
/// A browser the console remembers: asked for right after an unlock, traded later for a pass with no passkey, never a
/// fresh confirmation, only the admin's own, and gone when forgotten, expired or past the ten an admin may keep.
/// </summary>
public class AdminConsoleTrustTests
{
    private static readonly DateTime Now = new(2026, 10, 25, 9, 0, 0, DateTimeKind.Utc);

    private static User Admin(TestHarness h, string email = "francis@notefusion.studio")
    {
        var user = User.CreateAdmin("Francis", email, h.Hasher.Hash("pw-for-tests"), Now.AddDays(-90));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static StubCurrentUser As(User user) => new(user.Id, UserRole.Admin);

    private static async Task<ConsoleTrustDto> Remember(TestHarness h, User admin, InMemoryAdminPhoneLock passes, string label = "Chrome on Windows")
    {
        var pass = passes.Open(admin.Id, null, h.Clock.UtcNow);   // an unlock or a sign-in: fresh
        var trust = await new RememberConsoleBrowserCommandHandler(h.Db, As(admin), passes, h.Clock)
            .Handle(new RememberConsoleBrowserCommand(pass.Token, label), default);
        Assert.True(trust.IsSuccess);
        return trust.Value;
    }

    private static Task<NoteFusion.Shared.Results.Result<AdminPhoneSessionDto>> Open(TestHarness h, User admin, InMemoryAdminPhoneLock passes, string? token)
        => new OpenConsoleFromTrustedBrowserCommandHandler(h.Db, As(admin), passes, h.Clock)
            .Handle(new OpenConsoleFromTrustedBrowserCommand(token), default);

    [Fact]
    public async Task A_remembered_browser_opens_the_console_without_a_passkey_but_never_as_a_fresh_confirmation()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        var passes = new InMemoryAdminPhoneLock();

        var trust = await Remember(h, admin, passes);
        Assert.Equal(Now + AdminTrustedBrowser.Lifetime, trust.ExpiresAtUtc);
        var row = Assert.Single(h.Db.AdminTrustedBrowsers);
        Assert.NotEqual(trust.Token, row.TokenHash);          // only the hash is kept
        Assert.Equal(64, row.TokenHash.Length);

        // A day later (a reload, a deploy that restarted the API): the token opens a pass.
        h.Clock.UtcNow = Now.AddDays(1);
        var opened = await Open(h, admin, new InMemoryAdminPhoneLock(), trust.Token);
        Assert.True(opened.IsSuccess);

        var reopened = new InMemoryAdminPhoneLock();
        var session = (await Open(h, admin, reopened, trust.Token)).Value;
        var held = reopened.Touch(session.Session, admin.Id, h.Clock.UtcNow);
        Assert.NotNull(held);
        Assert.True(h.Clock.UtcNow - held!.UnlockedAtUtc > AdminPhoneLockRules.FreshFor);   // Suspend & co. still ask
        Assert.Equal(Now.AddDays(1), h.Db.AdminTrustedBrowsers.Single().LastUsedAtUtc);
    }

    [Fact]
    public async Task Only_a_pass_opened_in_the_last_minute_can_remember_a_browser()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        var passes = new InMemoryAdminPhoneLock();
        var pass = passes.Open(admin.Id, null, Now);
        var remember = new RememberConsoleBrowserCommandHandler(h.Db, As(admin), passes, h.Clock);

        h.Clock.UtcNow = Now.AddMinutes(2);
        Assert.Equal("ADMIN_CONFIRM_REQUIRED", (await remember.Handle(new RememberConsoleBrowserCommand(pass.Token, null), default)).Error.Code);

        // A pass a remembered browser opened cannot remember another.
        var notFresh = passes.Open(admin.Id, null, h.Clock.UtcNow, fresh: false);
        Assert.Equal("ADMIN_CONFIRM_REQUIRED", (await remember.Handle(new RememberConsoleBrowserCommand(notFresh.Token, null), default)).Error.Code);
        Assert.Equal("ADMIN_CONFIRM_REQUIRED", (await remember.Handle(new RememberConsoleBrowserCommand(null, null), default)).Error.Code);
        Assert.Empty(h.Db.AdminTrustedBrowsers);
    }

    [Fact]
    public async Task A_token_opens_nothing_once_forgotten_expired_for_another_admin_or_made_up()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        var other = Admin(h, "ada@notefusion.studio");
        var passes = new InMemoryAdminPhoneLock();
        var trust = await Remember(h, admin, passes);

        Assert.Equal("ADMIN_TRUST_INVALID", (await Open(h, other, passes, trust.Token)).Error.Code);
        Assert.Equal("ADMIN_TRUST_INVALID", (await Open(h, admin, passes, "made-up")).Error.Code);
        Assert.Equal("ADMIN_TRUST_INVALID", (await Open(h, admin, passes, null)).Error.Code);

        h.Clock.UtcNow = Now + AdminTrustedBrowser.Lifetime;
        Assert.Equal("ADMIN_TRUST_INVALID", (await Open(h, admin, passes, trust.Token)).Error.Code);

        h.Clock.UtcNow = Now;
        await new ForgetConsoleBrowserCommandHandler(h.Db, As(admin), h.Clock).Handle(new ForgetConsoleBrowserCommand(Token: trust.Token), default);
        Assert.Equal("ADMIN_TRUST_INVALID", (await Open(h, admin, passes, trust.Token)).Error.Code);
    }

    [Fact]
    public async Task Settings_lists_the_admins_own_browsers_marks_this_one_and_forgets_by_id()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        var other = Admin(h, "ada@notefusion.studio");
        var passes = new InMemoryAdminPhoneLock();
        var mine = await Remember(h, admin, passes, "Chrome on Windows");
        h.Clock.UtcNow = Now.AddMinutes(1);
        await Remember(h, admin, passes, "Safari on iOS");
        await Remember(h, other, passes, "Firefox on Linux");

        var list = (await new GetConsoleBrowsersQueryHandler(h.Db, As(admin), h.Clock).Handle(new GetConsoleBrowsersQuery(mine.Token), default)).Value;
        Assert.Equal(["Safari on iOS", "Chrome on Windows"], list.Select(b => b.Label));
        Assert.Equal([false, true], list.Select(b => b.ThisBrowser));

        // Another admin's id is not this admin's to forget.
        var theirs = h.Db.AdminTrustedBrowsers.Single(b => b.UserId == other.Id).Id;
        await new ForgetConsoleBrowserCommandHandler(h.Db, As(admin), h.Clock).Handle(new ForgetConsoleBrowserCommand(Id: theirs), default);
        Assert.Null(h.Db.AdminTrustedBrowsers.Single(b => b.Id == theirs).RevokedAtUtc);

        await new ForgetConsoleBrowserCommandHandler(h.Db, As(admin), h.Clock).Handle(new ForgetConsoleBrowserCommand(Id: list[0].Id), default);
        var after = (await new GetConsoleBrowsersQueryHandler(h.Db, As(admin), h.Clock).Handle(new GetConsoleBrowsersQuery(), default)).Value;
        Assert.Equal(["Chrome on Windows"], after.Select(b => b.Label));
    }

    [Fact]
    public async Task Past_ten_browsers_the_least_recently_used_is_forgotten()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        var passes = new InMemoryAdminPhoneLock();
        var first = await Remember(h, admin, passes, "Browser 1");
        for (var i = 2; i <= AdminTrustedBrowser.MaxPerAdmin + 1; i++)
        {
            h.Clock.UtcNow = Now.AddMinutes(i);
            await Remember(h, admin, passes, $"Browser {i}");
        }

        Assert.Equal(AdminTrustedBrowser.MaxPerAdmin, h.Db.AdminTrustedBrowsers.Count(b => b.RevokedAtUtc == null));
        Assert.Equal("ADMIN_TRUST_INVALID", (await Open(h, admin, passes, first.Token)).Error.Code);
    }
}
