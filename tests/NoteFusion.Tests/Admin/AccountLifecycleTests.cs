using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Admin.Commands;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

/// <summary>
/// Suspending, reactivating, and moving accounts in and out of the admin role.
///
/// Two things are being pinned here. The first is that suspension actually bites — flipping a flag that
/// only the login path reads would leave every signed-in device running on its refresh token for a week,
/// so the tokens have to go too. The second is that the console cannot lock everyone out of itself: the
/// last active admin demoting or suspending themselves is only recoverable from a psql session, so both
/// are refused at the door.
/// </summary>
public class AccountLifecycleTests
{
    private static readonly DateTime Now = new(2026, 8, 20, 10, 0, 0, DateTimeKind.Utc);

    // ------------------------------------------------------------------ suspension

    [Fact]
    public async Task Suspending_an_account_stops_the_next_sign_in()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        var result = await Suspend(h, admin, target.Id);

        Assert.True(result.IsSuccess);
        Assert.False(target.IsActive);

        var login = await Login(h, target.Email);
        Assert.True(login.IsFailure);
        Assert.Equal("AUTH_ACCOUNT_INACTIVE", login.Error.Code);
    }

    [Fact]
    public async Task Suspending_revokes_the_sessions_that_are_already_open()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        // The device signs in first, the way a real abusive account would already be signed in.
        var login = await Login(h, target.Email);
        Assert.True(login.IsSuccess);

        await Suspend(h, admin, target.Id);

        // Without this the flag is theatre: the refresh token outlives the suspension by seven days, so the
        // account would keep minting fresh access tokens for a week without ever touching the login path.
        Assert.All(h.Db.RefreshTokens.ToList(), t => Assert.True(t.IsRevoked));
        Assert.All(h.Db.RefreshTokens.ToList(), t => Assert.Equal(Now, t.RevokedAt));
    }

    [Fact]
    public async Task Reactivating_restores_sign_in()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        await Suspend(h, admin, target.Id);
        var result = await new ReactivateUserCommandHandler(h.Db, Caller(admin), h.AuditAs(admin))
            .Handle(new ReactivateUserCommand(target.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(target.IsActive);
        Assert.True((await Login(h, target.Email)).IsSuccess);
    }

    [Fact]
    public async Task Reactivating_does_not_resurrect_the_revoked_tokens()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        await Login(h, target.Email);

        await Suspend(h, admin, target.Id);
        await new ReactivateUserCommandHandler(h.Db, Caller(admin), h.AuditAs(admin))
            .Handle(new ReactivateUserCommand(target.Id), CancellationToken.None);

        // Every device signs in again. A token that was live through a suspension is one whose copies we
        // cannot account for, so honouring it afterwards would undo the point of revoking it.
        Assert.All(h.Db.RefreshTokens.ToList(), t => Assert.True(t.IsRevoked));
    }

    [Fact]
    public async Task Suspending_twice_changes_nothing_and_logs_once()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        await Suspend(h, admin, target.Id);
        var second = await Suspend(h, admin, target.Id);

        // A double tap must not fail in the operator's face — and must not read as two separate incidents
        // in the trail either.
        Assert.True(second.IsSuccess);
        Assert.Single(h.Db.AdminAuditLogs.Where(a => a.Action == AdminAuditAction.SuspendUser).ToList());
    }

    [Fact]
    public async Task You_cannot_suspend_yourself()
    {
        using var h = new TestHarness(Now);
        var (admin, _) = Seed(h);

        var result = await Suspend(h, admin, admin.Id);

        Assert.True(result.IsFailure);
        Assert.Equal("ADMIN_CANNOT_ACT_ON_SELF", result.Error.Code);
        Assert.True(admin.IsActive);
    }

    [Fact]
    public async Task The_last_active_admin_cannot_be_suspended()
    {
        using var h = new TestHarness(Now);
        var (ada, _) = Seed(h);
        var ben = User.CreateAdmin("Ben Backup", "ben@notefusion.studio", h.Hasher.Hash("password123"), Now.AddDays(-10));
        h.Db.Users.Add(ben);
        h.Db.SaveChanges();

        // The window this guard exists for: the role is a JWT claim, so Ada keeps console access for up to
        // an hour after another admin demotes her. In that hour her token still says Admin while the
        // database says User — and if she suspends Ben, nobody is left who can sign in and undo it. The
        // guard reads the database rather than trusting the claim, which is what closes the window.
        ada.DemoteFromAdmin();
        h.Db.SaveChanges();

        var staleToken = new StubCurrentUser(ada.Id, UserRole.Admin, ada.Email, ada.FullName);
        var result = await new SuspendUserCommandHandler(h.Db, staleToken, h.AuditAs(ada), h.Clock)
            .Handle(new SuspendUserCommand(ben.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("ADMIN_LAST_ADMIN", result.Error.Code);
        Assert.True(ben.IsActive);
    }

    [Fact]
    public async Task A_suspension_is_recorded_with_the_session_count_and_the_operators_reason()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        await Login(h, target.Email);
        h.ClientIp.Current = "102.89.23.7";

        await Suspend(h, admin, target.Id, note: "Chargeback fraud, ticket 4192.");

        var entry = Assert.Single(h.Db.AdminAuditLogs.ToList());
        Assert.Equal(AdminAuditAction.SuspendUser, entry.Action);
        Assert.Equal(admin.Id, entry.ActorUserId);
        Assert.Equal(target.Id, entry.TargetUserId);
        Assert.Equal("102.89.23.7", entry.IpAddress);
        Assert.Contains("revoked 1 active session", entry.Summary);
        Assert.Equal("Chargeback fraud, ticket 4192.", entry.Note);
    }

    [Fact]
    public async Task A_missing_account_is_a_not_found_not_a_silent_success()
    {
        using var h = new TestHarness(Now);
        var (admin, _) = Seed(h);

        var result = await Suspend(h, admin, Guid.NewGuid());

        Assert.True(result.IsFailure);
        Assert.Equal("USER_NOT_FOUND", result.Error.Code);
        Assert.Empty(h.Db.AdminAuditLogs.ToList());
    }

    // ------------------------------------------------------------------ roles

    [Fact]
    public async Task An_existing_user_can_be_promoted_and_demoted()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        Assert.True((await SetRole(h, admin, target.Id, UserRole.Admin)).IsSuccess);
        Assert.Equal(UserRole.Admin, target.Role);

        Assert.True((await SetRole(h, admin, target.Id, UserRole.User)).IsSuccess);
        Assert.Equal(UserRole.User, target.Role);

        var actions = h.Db.AdminAuditLogs.Select(a => a.Summary).ToList();
        Assert.Equal(new[] { "Granted administrator access.", "Removed administrator access." }, actions.ToArray());
    }

    [Fact]
    public async Task Setting_the_role_an_account_already_has_writes_nothing()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        var result = await SetRole(h, admin, target.Id, UserRole.User);

        Assert.True(result.IsSuccess);
        Assert.Empty(h.Db.AdminAuditLogs.ToList());
    }

    [Fact]
    public async Task You_cannot_change_your_own_role()
    {
        using var h = new TestHarness(Now);
        var (admin, _) = Seed(h);

        var result = await SetRole(h, admin, admin.Id, UserRole.User);

        // Demoting yourself signs you out of the console mid-task with no way back in from the console.
        Assert.True(result.IsFailure);
        Assert.Equal("ADMIN_CANNOT_ACT_ON_SELF", result.Error.Code);
        Assert.Equal(UserRole.Admin, admin.Role);
    }

    [Fact]
    public async Task The_last_active_admin_cannot_be_demoted()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        await SetRole(h, admin, target.Id, UserRole.Admin);
        await Suspend(h, admin, target.Id);

        // Pat is now an admin holding a live access token whose account has since been suspended — the
        // hour-long window where the JWT still says Admin and the database disagrees. If Pat demotes Ada in
        // that window, the console has no one left who can sign in, and only psql can undo it. So the guard
        // counts *active* admins from the database rather than trusting the claim in front of it.
        var result = await new SetUserRoleCommandHandler(h.Db, Caller(target), h.AuditAs(target))
            .Handle(new SetUserRoleCommand(admin.Id, UserRole.User), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("ADMIN_LAST_ADMIN", result.Error.Code);
        Assert.Equal(UserRole.Admin, admin.Role);
    }

    // ------------------------------------------------------------------ reset links

    [Fact]
    public async Task Sending_a_reset_link_emails_the_account_and_stores_a_token()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        var result = await new SendPasswordResetCommandHandler(
                h.Db, Caller(admin), h.AuditAs(admin), new HarnessSender(h))
            .Handle(new SendPasswordResetCommand(target.Id, "Locked out, ticket 4200."), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var (kind, recipient) = Assert.Single(h.Email.Sent);
        Assert.Equal("password-reset", kind);
        Assert.Equal(target.Email, recipient.Email);
        Assert.NotNull(target.PasswordResetTokenHash);

        // The trail entry and the stored token commit together: the row was staged before the inner
        // handler saved, so there is no version of this where a reset token exists unattributed.
        var entry = Assert.Single(h.Db.AdminAuditLogs.AsNoTracking().ToList());
        Assert.Equal(AdminAuditAction.SendPasswordReset, entry.Action);
        Assert.Equal("Locked out, ticket 4200.", entry.Note);
    }

    [Fact]
    public async Task The_emailed_link_points_where_configuration_says_and_nowhere_else()
    {
        using var h = new TestHarness(Now);
        var (_, target) = Seed(h);

        await new ForgotPasswordCommandHandler(
                h.Db, h.Tokens, h.Clock, h.Email, h.Auth, Silent)
            .Handle(new ForgotPasswordCommand(target.Email), CancellationToken.None);

        // The destination used to be a field on the request. That let an anonymous caller name someone
        // else's address and their own base URL, and have NoteFusion mail that person a genuine one-time
        // reset token pointing at the caller's site. The command has no such field now, and this pins that:
        // the only thing that can change the destination is a deploy.
        Assert.StartsWith(h.Auth.ResetPasswordUrl + "?token=", h.Email.ResetUrls.Single());
    }

    // ---------------------------------------------------------------- fixtures

    private static readonly NullLogger<ForgotPasswordCommandHandler> Silent =
        NullLogger<ForgotPasswordCommandHandler>.Instance;

    private static (User Admin, User Target) Seed(TestHarness h)
    {
        var admin = User.CreateAdmin("Ada Admin", "ada@notefusion.studio", h.Hasher.Hash("password123"), Now.AddDays(-200));
        var target = User.Create("Pat Pro", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));

        h.Db.Users.Add(admin);
        h.Db.Users.Add(target);
        h.Db.SaveChanges();

        return (admin, target);
    }

    private static StubCurrentUser Caller(User admin)
        => new(admin.Id, admin.Role, admin.Email, admin.FullName);

    private static Task<Result> Suspend(TestHarness h, User admin, Guid targetId, string? note = null)
        => new SuspendUserCommandHandler(h.Db, Caller(admin), h.AuditAs(admin), h.Clock)
            .Handle(new SuspendUserCommand(targetId, note), CancellationToken.None);

    private static Task<Result> SetRole(TestHarness h, User admin, Guid targetId, UserRole role)
        => new SetUserRoleCommandHandler(h.Db, Caller(admin), h.AuditAs(admin))
            .Handle(new SetUserRoleCommand(targetId, role), CancellationToken.None);

    private static Task<Result<Application.Auth.Dtos.LoginResponse>> Login(TestHarness h, string email)
        => new LoginCommandHandler(h.Db, h.Hasher, h.TokenIssuer, h.Clock, h.Country)
            .Handle(new LoginCommand(email, "password123"), CancellationToken.None);
}
