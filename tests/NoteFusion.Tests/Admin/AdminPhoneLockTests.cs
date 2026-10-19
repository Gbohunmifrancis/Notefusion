using System.IdentityModel.Tokens.Jwt;
using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Controllers;
using NoteFusion.Application.Admin.PhoneLock;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Security;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

/// <summary>
/// The phone's Admin lock, server side (board f-admin/10 revised): a phone's token reaches no admin route without an
/// open pass, a pass comes only from the phone's fingerprint-locked key or the password plus an emailed code, and the
/// destructive actions want a fresh one.
/// </summary>
public class AdminPhoneLockTests
{
    private static readonly DateTime Now = new(2026, 10, 19, 9, 0, 0, DateTimeKind.Utc);
    private const string Password = "correct horse battery";

    // ── Setting a phone up ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Setting_up_takes_the_password_then_the_emailed_code_and_keeps_only_the_keys_hash()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        var phoneLock = new InMemoryAdminPhoneLock();

        var sent = await RequestCode(h, admin, phoneLock, Password, AdminPhoneLockRules.PurposeSetup);
        Assert.True(sent.IsSuccess);
        Assert.Equal("fr•••@notefusion.studio", sent.Value.SentTo);
        var code = Assert.Single(h.Email.AdminCodes);

        var setUp = await SetUp(h, admin, phoneLock, sent.Value.CodeId, code);
        Assert.True(setUp.IsSuccess);

        var key = Assert.Single(h.Db.AdminPhoneKeys);
        Assert.Equal("Pixel 7", key.Label);
        Assert.NotEqual(setUp.Value.Secret, key.SecretHash);
        Assert.True(AdminPhoneLockRules.Matches(key, setUp.Value.Secret));
        Assert.NotNull(phoneLock.Touch(setUp.Value.Session, admin.Id, Now));
        Assert.Contains(h.Email.Sent, s => s.Kind == "admin-phone-added");
        Assert.Contains(h.Db.AdminAuditLogs, l => l.Action == AdminAuditAction.SetUpAdminPhone);

        // The code opened one thing once.
        var again = await SetUp(h, admin, phoneLock, sent.Value.CodeId, code);
        Assert.Equal("ADMIN_CODE_WRONG", again.Error.Code);
    }

    [Fact]
    public async Task A_wrong_password_sends_no_code()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);

        var sent = await RequestCode(h, admin, new InMemoryAdminPhoneLock(), "guess", AdminPhoneLockRules.PurposeSetup);

        Assert.Equal("ADMIN_PASSWORD_INCORRECT", sent.Error.Code);
        Assert.Empty(h.Email.AdminCodes);
    }

    [Fact]
    public async Task A_new_setup_retires_the_key_a_new_fingerprint_wiped()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        var phoneLock = new InMemoryAdminPhoneLock();
        var first = await SetUpFully(h, admin, phoneLock);

        var second = await SetUpFully(h, admin, phoneLock, replaces: first.KeyId);

        Assert.False(h.Db.AdminPhoneKeys.Single(k => k.Id == first.KeyId).IsActive);
        var unlock = await Unlock(h, admin, phoneLock, first.KeyId, first.Secret);
        Assert.Equal("ADMIN_PHONE_KEY_INVALID", unlock.Error.Code);
        Assert.True((await Unlock(h, admin, phoneLock, second.KeyId, second.Secret)).IsSuccess);
    }

    // ── Unlocking ───────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_phones_key_opens_a_pass_and_a_wrong_one_counts_towards_a_lockout()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        var phoneLock = new InMemoryAdminPhoneLock();
        var phone = await SetUpFully(h, admin, phoneLock);

        var opened = await Unlock(h, admin, phoneLock, phone.KeyId, phone.Secret);
        Assert.True(opened.IsSuccess);
        Assert.NotNull(phoneLock.Touch(opened.Value.Session, admin.Id, Now));

        for (var i = 0; i < AdminPhoneLockRules.FailureLimit - 1; i++)
            Assert.Equal("ADMIN_PHONE_KEY_INVALID", (await Unlock(h, admin, phoneLock, phone.KeyId, "not-it")).Error.Code);
        Assert.Equal("ADMIN_PHONE_KEY_INVALID", (await Unlock(h, admin, phoneLock, phone.KeyId, "not-it")).Error.Code);

        // Locked out: even the right key waits, and the passes it held are ended.
        Assert.Equal("ADMIN_LOCK_TOO_MANY", (await Unlock(h, admin, phoneLock, phone.KeyId, phone.Secret)).Error.Code);
        Assert.Null(phoneLock.Touch(opened.Value.Session, admin.Id, Now));
        Assert.False(phoneLock.IsLockedOut(admin.Id, Now + AdminPhoneLockRules.LockoutFor));
    }

    [Fact]
    public async Task Another_admins_key_opens_nothing()
    {
        using var h = new TestHarness(Now);
        var mine = Admin(h);
        var theirs = Admin(h, "other@notefusion.studio");
        var phoneLock = new InMemoryAdminPhoneLock();
        var phone = await SetUpFully(h, theirs, phoneLock);

        Assert.Equal("ADMIN_PHONE_KEY_INVALID", (await Unlock(h, mine, phoneLock, phone.KeyId, phone.Secret)).Error.Code);
    }

    [Fact]
    public async Task A_phone_with_no_sensor_opens_with_the_password_and_an_emailed_code()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        var phoneLock = new InMemoryAdminPhoneLock();
        var sent = await RequestCode(h, admin, phoneLock, Password, AdminPhoneLockRules.PurposeUnlock);
        var verify = new VerifyAdminCodeCommandHandler(new StubCurrentUser(admin.Id, UserRole.Admin), phoneLock, h.Clock);

        // A setup code is not an unlock code, and a wrong code is wrong.
        Assert.Equal("ADMIN_CODE_WRONG", (await verify.Handle(new VerifyAdminCodeCommand(sent.Value.CodeId, "000000x"), default)).Error.Code);

        var opened = await verify.Handle(new VerifyAdminCodeCommand(sent.Value.CodeId, h.Email.AdminCodes[^1]), default);
        Assert.True(opened.IsSuccess);
        Assert.NotNull(phoneLock.Touch(opened.Value.Session, admin.Id, Now));
    }

    [Fact]
    public void Codes_expire_and_an_account_gets_five_an_hour()
    {
        var phoneLock = new InMemoryAdminPhoneLock();
        var user = Guid.NewGuid();
        var code = phoneLock.IssueCode(user, AdminPhoneLockRules.PurposeUnlock, Now)!;

        Assert.Equal(AdminCodeCheck.Expired,
            phoneLock.CheckCode(user, code.CodeId, code.Code, AdminPhoneLockRules.PurposeUnlock, Now + AdminPhoneLockRules.CodeLifetime));

        for (var i = 1; i < AdminPhoneLockRules.CodesPerHour; i++)
            Assert.NotNull(phoneLock.IssueCode(user, AdminPhoneLockRules.PurposeUnlock, Now.AddMinutes(i)));
        Assert.Null(phoneLock.IssueCode(user, AdminPhoneLockRules.PurposeUnlock, Now.AddMinutes(10)));
        Assert.NotNull(phoneLock.IssueCode(user, AdminPhoneLockRules.PurposeUnlock, Now.AddMinutes(61)));
    }

    [Fact]
    public void A_pass_ends_five_minutes_after_its_last_request_and_an_hour_after_it_opened()
    {
        var phoneLock = new InMemoryAdminPhoneLock();
        var user = Guid.NewGuid();
        var pass = phoneLock.Open(user, null, Now);

        Assert.Null(phoneLock.Touch(pass.Token, Guid.NewGuid(), Now)); // never another account's
        Assert.NotNull(phoneLock.Touch(pass.Token, user, Now.AddMinutes(4)));
        Assert.NotNull(phoneLock.Touch(pass.Token, user, Now.AddMinutes(8)));
        Assert.Null(phoneLock.Touch(pass.Token, user, Now.AddMinutes(14)));

        var busy = phoneLock.Open(user, null, Now);
        for (var minute = 4; minute < 60; minute += 4)
            Assert.NotNull(phoneLock.Touch(busy.Token, user, Now.AddMinutes(minute)));
        Assert.Null(phoneLock.Touch(busy.Token, user, Now.AddMinutes(60)));

        var closed = phoneLock.Open(user, null, Now);
        phoneLock.Close(closed.Token);
        Assert.Null(phoneLock.Touch(closed.Token, user, Now));
    }

    // ── The policy ──────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_phones_token_needs_an_open_pass_and_a_browsers_is_not_asked_yet()
    {
        var phoneLock = new InMemoryAdminPhoneLock();
        var admin = Guid.NewGuid();

        Assert.True(await Allowed(phoneLock, admin, ClientKinds.Web, header: null));
        Assert.True(await Allowed(phoneLock, admin, client: null, header: null)); // a token from before the claim
        Assert.Equal(AdminPhoneLockErrors.Locked.Code, await Refusal(phoneLock, admin, ClientKinds.App, header: null));
        Assert.Equal(AdminPhoneLockErrors.Locked.Code, await Refusal(phoneLock, admin, ClientKinds.App, header: "made-up"));

        var pass = phoneLock.Open(admin, null, Now);
        Assert.True(await Allowed(phoneLock, admin, ClientKinds.App, pass.Token));
        // Someone else's pass is no pass.
        Assert.Equal(AdminPhoneLockErrors.Locked.Code, await Refusal(phoneLock, Guid.NewGuid(), ClientKinds.App, pass.Token));
        // The lock's own routes and "Mute 1 hour" answer while locked.
        Assert.True(await Allowed(phoneLock, admin, ClientKinds.App, header: null, new AllowLockedPhoneAttribute()));
    }

    [Fact]
    public async Task Switched_off_the_server_asks_no_phone_for_a_pass()
    {
        var off = new AdminPhoneLockSettings { Enforce = false };
        Assert.Null(await Refusal(new InMemoryAdminPhoneLock(), Guid.NewGuid(), ClientKinds.App, header: null, off,
            new FreshPhoneUnlockAttribute()));
    }

    [Fact]
    public async Task A_destructive_action_from_the_phone_wants_a_fingerprint_in_the_last_minute()
    {
        var phoneLock = new InMemoryAdminPhoneLock();
        var admin = Guid.NewGuid();
        var pass = phoneLock.Open(admin, null, Now.AddMinutes(-3));
        phoneLock.Touch(pass.Token, admin, Now.AddMinutes(-1));

        Assert.Equal(AdminPhoneLockErrors.ConfirmRequired.Code,
            await Refusal(phoneLock, admin, ClientKinds.App, pass.Token, new FreshPhoneUnlockAttribute()));

        Assert.True(phoneLock.MarkFresh(pass.Token, admin, Now));
        Assert.True(await Allowed(phoneLock, admin, ClientKinds.App, pass.Token, new FreshPhoneUnlockAttribute()));
    }

    [Fact]
    public void The_destructive_routes_want_a_fresh_unlock_and_only_the_lock_and_mute_answer_while_locked()
    {
        var actions = typeof(AdminController).Assembly.GetTypes()
            .Where(t => typeof(ControllerBase).IsAssignableFrom(t)
                        && t.GetCustomAttribute<AuthorizeAttribute>()?.Policy == AuthorizationPolicies.Admin)
            .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Select(m => (Type: t, Method: m)))
            .ToList();

        var fresh = actions.Where(a => a.Method.GetCustomAttribute<FreshPhoneUnlockAttribute>() is not null)
            .Select(a => $"{a.Type.Name}.{a.Method.Name}").OrderBy(n => n).ToList();
        Assert.Equal(
            ["AdminController.EndSubscription", "AdminController.RevokePro", "AdminController.Role",
             "AdminController.Suspend", "AdminFeaturesController.Set"],
            fresh);

        var open = actions.Where(a => a.Method.GetCustomAttribute<AllowLockedPhoneAttribute>() is not null
                                      || a.Type.GetCustomAttribute<AllowLockedPhoneAttribute>() is not null)
            .Select(a => a.Type == typeof(AdminPhoneLockController) ? "phone-lock" : $"{a.Type.Name}.{a.Method.Name}")
            .Distinct().OrderBy(n => n).ToList();
        Assert.Equal(["AdminAlertsController.Mute", "phone-lock"], open);
    }

    // ── Tokens keep their client ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_token_issued_to_the_phone_stays_a_phone_token_whatever_refreshes_it()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        var client = new StubClientApp(ClientKinds.App);
        var issuer = new TokenIssuer(h.Jwt, h.Tokens, h.Db, h.Clock, h.Auth, client);

        var first = issuer.Issue(admin);
        await h.Db.SaveChangesAsync();
        Assert.Equal(ClientKinds.App, ClaimOf(first.AccessToken));
        Assert.Equal(ClientKinds.App, Assert.Single(h.Db.RefreshTokens).Client);

        // A thief's request says it is a browser; the chain began on the phone.
        client.Current = ClientKinds.Web;
        var refreshed = await new RefreshTokenCommandHandler(h.Db, h.Hasher, issuer, h.Clock)
            .Handle(new RefreshTokenCommand(first.RefreshToken), default);
        Assert.Equal(ClientKinds.App, ClaimOf(refreshed.Value.AccessToken));
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

    private static string? ClaimOf(string jwt)
        => new JwtSecurityTokenHandler().ReadJwtToken(jwt).Claims.FirstOrDefault(c => c.Type == ClientKinds.Claim)?.Value;

    private static async Task<bool> Allowed(
        IAdminPhoneLock phoneLock, Guid userId, string? client, string? header, params object[] metadata)
        => await Refusal(phoneLock, userId, client, header, metadata) is null;

    private static Task<string?> Refusal(
        IAdminPhoneLock phoneLock, Guid userId, string? client, string? header, params object[] metadata)
        => Refusal(phoneLock, userId, client, header, new AdminPhoneLockSettings(), metadata);

    private static async Task<string?> Refusal(
        IAdminPhoneLock phoneLock, Guid userId, string? client, string? header, AdminPhoneLockSettings settings,
        params object[] metadata)
    {
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, userId.ToString()) };
        if (client is not null)
            claims.Add(new Claim(ClientKinds.Claim, client));
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));

        var http = new DefaultHttpContext();
        http.SetEndpoint(new Endpoint(_ => Task.CompletedTask, new EndpointMetadataCollection(metadata), "admin"));
        if (header is not null)
            http.Request.Headers[AdminPhoneLockRules.Header] = header;

        var requirement = new UnlockedPhoneRequirement();
        var context = new AuthorizationHandlerContext([requirement], user, http);
        await new UnlockedPhoneHandler(phoneLock, new HttpContextAccessor { HttpContext = http }, new FixedClock(Now), settings)
            .HandleAsync(context);

        return context.HasSucceeded ? null : context.FailureReasons.Single().Message;
    }

    private sealed record Phone(Guid KeyId, string Secret);

    private static async Task<Phone> SetUpFully(TestHarness h, User admin, IAdminPhoneLock phoneLock, Guid? replaces = null)
    {
        var sent = await RequestCode(h, admin, phoneLock, Password, AdminPhoneLockRules.PurposeSetup);
        var setUp = await SetUp(h, admin, phoneLock, sent.Value.CodeId, h.Email.AdminCodes[^1], replaces);
        return new Phone(setUp.Value.KeyId, setUp.Value.Secret);
    }

    private static Task<NoteFusion.Shared.Results.Result<AdminCodeSentDto>> RequestCode(
        TestHarness h, User admin, IAdminPhoneLock phoneLock, string password, string purpose)
        => new RequestAdminCodeCommandHandler(
                h.Db, new StubCurrentUser(admin.Id, UserRole.Admin), h.Hasher, phoneLock, h.Email, h.Clock)
            .Handle(new RequestAdminCodeCommand(password, purpose), default);

    private static Task<NoteFusion.Shared.Results.Result<AdminPhoneSetUpDto>> SetUp(
        TestHarness h, User admin, IAdminPhoneLock phoneLock, string codeId, string code, Guid? replaces = null)
        => new SetUpAdminPhoneCommandHandler(
                h.Db, new StubCurrentUser(admin.Id, UserRole.Admin), phoneLock, h.Tokens, h.AuditAs(admin), h.Email, h.Clock)
            .Handle(new SetUpAdminPhoneCommand(codeId, code, "Pixel 7", replaces), default);

    private static Task<NoteFusion.Shared.Results.Result<AdminPhoneSessionDto>> Unlock(
        TestHarness h, User admin, IAdminPhoneLock phoneLock, Guid keyId, string secret)
        => new UnlockAdminPhoneCommandHandler(h.Db, new StubCurrentUser(admin.Id, UserRole.Admin), phoneLock, h.Clock)
            .Handle(new UnlockAdminPhoneCommand(keyId, secret), default);

    private static User Admin(TestHarness h, string email = "francis@notefusion.studio")
    {
        var user = User.CreateAdmin("Francis", email, h.Hasher.Hash(Password), Now.AddDays(-90));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }
}
