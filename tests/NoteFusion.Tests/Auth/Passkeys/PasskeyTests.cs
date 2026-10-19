using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Controllers;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Auth.Passkeys;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Security.Passkeys;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Auth.Passkeys;

/// <summary>
/// Passkeys end to end through the real handlers, the real Fido2NetLib verifier and a software
/// authenticator signing real ES256 assertions: registration, sign-in, and every refusal that matters.
/// </summary>
public sealed class PasskeyTests : IDisposable
{
    private const string Origin = "https://admin.notefusion.studio";
    private const string RpId = "notefusion.studio";

    private readonly TestHarness _h = new();
    private readonly InMemoryPasskeyChallengeStore _challenges;
    private readonly Fido2PasskeyCeremony _ceremony;
    private readonly FakeAuthenticator _authenticator = new(Origin, RpId);

    public PasskeyTests()
    {
        _challenges = new InMemoryPasskeyChallengeStore(_h.Clock);
        _ceremony = new Fido2PasskeyCeremony(
            new PasskeySettings { RpId = RpId, Origins = [Origin] }, NullLogger<Fido2PasskeyCeremony>.Instance);
    }

    public void Dispose()
    {
        _authenticator.Dispose();
        _h.Dispose();
    }

    // ── Registration ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Registration_options_require_a_resident_key_and_user_verification_and_exclude_existing_passkeys()
    {
        var admin = await SeedAsync("admin@example.com", admin: true);
        await RegisterAsync(admin, "First");

        var options = (await BeginRegistration(admin).Handle(new BeginPasskeyRegistrationCommand(), default)).Value;

        Assert.Equal(RpId, options.GetProperty("rp").GetProperty("id").GetString());
        Assert.Equal("NoteFusion", options.GetProperty("rp").GetProperty("name").GetString());
        Assert.Equal(admin.Id.ToByteArray(), FakeAuthenticator.FromBase64Url(options.GetProperty("user").GetProperty("id").GetString()!));
        Assert.Equal("admin@example.com", options.GetProperty("user").GetProperty("name").GetString());
        var selection = options.GetProperty("authenticatorSelection");
        Assert.Equal("required", selection.GetProperty("residentKey").GetString());
        Assert.Equal("required", selection.GetProperty("userVerification").GetString());
        Assert.Equal("none", options.GetProperty("attestation").GetString());
        Assert.True(FakeAuthenticator.FromBase64Url(options.GetProperty("challenge").GetString()!).Length >= 16);
        var excluded = Assert.Single(options.GetProperty("excludeCredentials").EnumerateArray());
        Assert.Equal(FakeAuthenticator.Base64Url(_authenticator.CredentialId), excluded.GetProperty("id").GetString());
    }

    [Fact]
    public async Task Only_an_admin_can_add_a_passkey()
    {
        var user = await SeedAsync("user@example.com", admin: false);

        var result = await BeginRegistration(user).Handle(new BeginPasskeyRegistrationCommand(), default);

        Assert.Equal(PasskeyErrors.AdminOnly, result.Error);
    }

    [Fact]
    public void Every_management_route_sits_behind_the_admin_policy_and_only_sign_in_is_anonymous()
    {
        var actions = typeof(PasskeysController).GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly);
        foreach (var action in actions)
        {
            var anonymous = action.GetCustomAttribute<AllowAnonymousAttribute>() is not null;
            if (action.Name is nameof(PasskeysController.LoginOptions) or nameof(PasskeysController.Login))
            {
                Assert.True(anonymous, action.Name);
                continue;
            }
            Assert.False(anonymous, action.Name);
            Assert.Equal(AuthorizationPolicies.Admin, action.GetCustomAttribute<AuthorizeAttribute>()?.Policy);
        }

        // The sign-in itself is limited like password login; minting options is not, so loading the sign-in
        // page (which asks for options to fill the autofill) cannot use up password attempts.
        Assert.Equal(AuthRateLimiting.Credentials,
            typeof(PasskeysController).GetMethod(nameof(PasskeysController.Login))!
                .GetCustomAttribute<EnableRateLimitingAttribute>()!.PolicyName);
        Assert.Equal(AuthRateLimiting.Passkeys,
            typeof(PasskeysController).GetMethod(nameof(PasskeysController.LoginOptions))!
                .GetCustomAttribute<EnableRateLimitingAttribute>()!.PolicyName);
    }

    [Fact]
    public async Task Adding_a_passkey_stores_it_and_writes_the_audit_trail()
    {
        var admin = await SeedAsync("admin@example.com", admin: true);

        var dto = await RegisterAsync(admin, "  MacBook Touch ID  ");

        Assert.Equal("MacBook Touch ID", dto.Name);
        var stored = await _h.Db.Passkeys.SingleAsync();
        Assert.Equal(admin.Id, stored.UserId);
        Assert.Equal(_authenticator.CredentialId, stored.CredentialId);
        Assert.Equal(FakeAuthenticator.Aaguid, stored.AaGuid);
        Assert.Equal("internal,hybrid", stored.Transports);
        Assert.Null(stored.LastUsedAtUtc);
        Assert.Single(_h.Db.AdminAuditLogs, a => a.Action == AdminAuditAction.AddPasskey && a.ActorUserId == admin.Id);

        // The admin is told: a passkey added with a stolen session would otherwise be a silent way back in.
        Assert.Contains(_h.Email.Sent, s => s.Kind == "admin-passkey-added" && s.To.Email == "admin@example.com");
    }

    [Fact]
    public async Task A_registration_challenge_is_bound_to_the_admin_it_was_issued_to()
    {
        var first = await SeedAsync("first@example.com", admin: true);
        var second = await SeedAsync("second@example.com", admin: true);

        var options = (await BeginRegistration(first).Handle(new BeginPasskeyRegistrationCommand(), default)).Value;
        var response = _authenticator.Create(options);

        var result = await CompleteRegistration(second).Handle(new CompletePasskeyRegistrationCommand(response, "Mine"), default);

        Assert.Equal(PasskeyErrors.RegistrationExpired, result.Error);
        Assert.Empty(_h.Db.Passkeys);
    }

    [Fact]
    public async Task A_registration_without_user_verification_is_refused()
    {
        var admin = await SeedAsync("admin@example.com", admin: true);
        _authenticator.VerifiesUser = false;

        var options = (await BeginRegistration(admin).Handle(new BeginPasskeyRegistrationCommand(), default)).Value;
        var result = await CompleteRegistration(admin).Handle(
            new CompletePasskeyRegistrationCommand(_authenticator.Create(options), null), default);

        Assert.Equal(PasskeyErrors.RegistrationFailed, result.Error);
        Assert.Empty(_h.Db.Passkeys);
    }

    // ── Sign-in ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Sign_in_options_are_discoverable_and_require_user_verification()
    {
        var options = (await BeginSignIn().Handle(new BeginPasskeySignInCommand(), default)).Value;

        Assert.Equal(RpId, options.GetProperty("rpId").GetString());
        Assert.Equal("required", options.GetProperty("userVerification").GetString());
        Assert.True(!options.TryGetProperty("allowCredentials", out var allow) || allow.GetArrayLength() == 0);
    }

    [Fact]
    public async Task An_admin_signs_in_with_a_passkey_and_gets_the_same_token_pair_as_password_login()
    {
        var admin = await SeedAsync("admin@example.com", admin: true);
        await RegisterAsync(admin, "Laptop");
        _h.Clock.UtcNow += TimeSpan.FromHours(1);

        var result = await SignInAsync();

        Assert.True(result.IsSuccess, result.Error.Message);
        Assert.Equal(admin.Id, result.Value.User.Id);
        Assert.Equal("Admin", result.Value.User.Role);
        Assert.False(string.IsNullOrEmpty(result.Value.AccessToken));
        Assert.False(string.IsNullOrEmpty(result.Value.RefreshToken));
        Assert.Single(_h.Db.RefreshTokens, t => t.UserId == admin.Id);

        var passkey = await _h.Db.Passkeys.AsNoTracking().SingleAsync();
        Assert.Equal(_h.Clock.UtcNow, passkey.LastUsedAtUtc);
        Assert.Equal(_authenticator.Counter, (uint)passkey.SignCount);
        Assert.Single(_h.Db.AdminAuditLogs, a => a.Action == AdminAuditAction.PasskeySignIn && a.ActorUserId == admin.Id);
    }

    [Fact]
    public async Task A_passkey_on_an_account_that_is_not_an_admin_gets_no_token()
    {
        // Registration is admin-only, so this is an admin who has since been demoted.
        var admin = await SeedAsync("admin@example.com", admin: true);
        await RegisterAsync(admin, "Laptop");
        var tracked = await _h.Db.Users.SingleAsync(u => u.Id == admin.Id);
        tracked.DemoteFromAdmin();
        await _h.Db.SaveChangesAsync();

        var result = await SignInAsync();

        Assert.Equal(PasskeyErrors.NotAnAdmin, result.Error);
        Assert.Equal("This passkey isn't for an admin account.", result.Error.Message);
        Assert.Empty(_h.Db.RefreshTokens);
    }

    [Fact]
    public async Task A_sign_in_challenge_can_be_answered_once()
    {
        var admin = await SeedAsync("admin@example.com", admin: true);
        await RegisterAsync(admin, "Laptop");

        var options = (await BeginSignIn().Handle(new BeginPasskeySignInCommand(), default)).Value;
        var assertion = _authenticator.Get(options);

        Assert.True((await SignIn().Handle(new PasskeySignInCommand(assertion), default)).IsSuccess);
        var replay = await SignIn().Handle(new PasskeySignInCommand(assertion), default);

        Assert.Equal(PasskeyErrors.SignInExpired, replay.Error);
    }

    [Fact]
    public async Task A_sign_in_challenge_expires_after_five_minutes()
    {
        var admin = await SeedAsync("admin@example.com", admin: true);
        await RegisterAsync(admin, "Laptop");

        var options = (await BeginSignIn().Handle(new BeginPasskeySignInCommand(), default)).Value;
        var assertion = _authenticator.Get(options);
        _h.Clock.UtcNow += PasskeyChallenge.Lifetime + TimeSpan.FromSeconds(1);

        var result = await SignIn().Handle(new PasskeySignInCommand(assertion), default);

        Assert.Equal(PasskeyErrors.SignInExpired, result.Error);
        Assert.Empty(_h.Db.RefreshTokens);
    }

    [Fact]
    public async Task A_signature_counter_that_goes_backwards_is_refused()
    {
        var admin = await SeedAsync("admin@example.com", admin: true);
        _authenticator.Counter = 10;
        await RegisterAsync(admin, "Security key");

        Assert.True((await SignInAsync(counter: 11)).IsSuccess);
        var cloned = await SignInAsync(counter: 5);

        Assert.Equal(PasskeyErrors.SignInFailed, cloned.Error);
        Assert.Equal(11, (await _h.Db.Passkeys.AsNoTracking().SingleAsync()).SignCount);
    }

    [Fact]
    public async Task An_assertion_from_another_origin_is_refused()
    {
        var admin = await SeedAsync("admin@example.com", admin: true);
        await RegisterAsync(admin, "Laptop");
        _authenticator.Origin = "https://admin.notefusion.studio.evil.example";

        var result = await SignInAsync();

        Assert.Equal(PasskeyErrors.SignInFailed, result.Error);
    }

    [Fact]
    public async Task An_assertion_signed_by_another_key_is_refused()
    {
        var admin = await SeedAsync("admin@example.com", admin: true);
        await RegisterAsync(admin, "Laptop");

        // Same credential id and user handle, different private key: a forged assertion.
        using var forger = new FakeAuthenticator(Origin, RpId, _authenticator.CredentialId)
        {
            UserHandle = _authenticator.UserHandle
        };

        var options = (await BeginSignIn().Handle(new BeginPasskeySignInCommand(), default)).Value;
        var result = await SignIn().Handle(new PasskeySignInCommand(forger.Get(options)), default);

        Assert.Equal(PasskeyErrors.SignInFailed, result.Error);
    }

    [Fact]
    public async Task An_unknown_passkey_is_refused()
    {
        var options = (await BeginSignIn().Handle(new BeginPasskeySignInCommand(), default)).Value;

        var result = await SignIn().Handle(new PasskeySignInCommand(_authenticator.Get(options)), default);

        Assert.Equal(PasskeyErrors.UnknownPasskey, result.Error);
    }

    [Fact]
    public async Task A_malformed_credential_is_a_plain_refusal()
    {
        var garbage = JsonDocument.Parse("""{"id":"x","response":{"clientDataJSON":"not base64!"}}""").RootElement;

        var result = await SignIn().Handle(new PasskeySignInCommand(garbage), default);

        Assert.Equal(PasskeyErrors.SignInFailed, result.Error);
    }

    // ── Management ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_admin_lists_renames_and_removes_only_their_own_passkeys()
    {
        var admin = await SeedAsync("admin@example.com", admin: true);
        var other = await SeedAsync("other@example.com", admin: true);
        var mine = await RegisterAsync(admin, "Laptop");
        var theirs = Passkey.Register(other.Id, [1, 2, 3], [4, 5, 6], 0, Guid.Empty, [], "Theirs", _h.Clock.UtcNow);
        _h.Db.Passkeys.Add(theirs);
        await _h.Db.SaveChangesAsync();

        var me = new StubCurrentUser(admin.Id, UserRole.Admin, admin.Email);
        var list = (await new GetMyPasskeysQueryHandler(_h.Db, me).Handle(new GetMyPasskeysQuery(), default)).Value;
        Assert.Equal(mine.Id, Assert.Single(list).Id);

        Assert.Equal(PasskeyErrors.NotFound,
            (await new RenamePasskeyCommandHandler(_h.Db, me).Handle(new RenamePasskeyCommand(theirs.Id, "Mine now"), default)).Error);
        Assert.Equal(PasskeyErrors.NotFound,
            (await new DeletePasskeyCommandHandler(_h.Db, me, _h.AuditAs(admin)).Handle(new DeletePasskeyCommand(theirs.Id), default)).Error);
        Assert.True(await _h.Db.Passkeys.AnyAsync(p => p.Id == theirs.Id && p.Name == "Theirs"));

        var renamed = await new RenamePasskeyCommandHandler(_h.Db, me).Handle(new RenamePasskeyCommand(mine.Id, "Work laptop"), default);
        Assert.Equal("Work laptop", renamed.Value.Name);

        var removed = await new DeletePasskeyCommandHandler(_h.Db, me, _h.AuditAs(admin)).Handle(new DeletePasskeyCommand(mine.Id), default);
        Assert.True(removed.IsSuccess);
        Assert.False(await _h.Db.Passkeys.AnyAsync(p => p.Id == mine.Id));
        Assert.Single(_h.Db.AdminAuditLogs, a => a.Action == AdminAuditAction.RemovePasskey);
    }

    [Fact]
    public void A_name_longer_than_sixty_characters_is_refused_on_rename()
    {
        var validator = new RenamePasskeyCommandValidator();

        Assert.False(validator.Validate(new RenamePasskeyCommand(Guid.NewGuid(), new string('a', 61))).IsValid);
        Assert.False(validator.Validate(new RenamePasskeyCommand(Guid.NewGuid(), "")).IsValid);
        Assert.True(validator.Validate(new RenamePasskeyCommand(Guid.NewGuid(), "YubiKey 5C")).IsValid);
    }

    // ── Store and settings ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_challenge_store_hands_a_challenge_out_once_and_never_after_it_expires()
    {
        var store = new InMemoryPasskeyChallengeStore(_h.Clock);
        store.Save(new PasskeyChallenge("a", PasskeyCeremonyKind.SignIn, null, "{}", _h.Clock.UtcNow.AddMinutes(5)));
        store.Save(new PasskeyChallenge("b", PasskeyCeremonyKind.SignIn, null, "{}", _h.Clock.UtcNow.AddMinutes(5)));

        Assert.NotNull(store.Take("a"));
        Assert.Null(store.Take("a"));

        _h.Clock.UtcNow = _h.Clock.UtcNow.AddMinutes(6);
        Assert.Null(store.Take("b"));
        Assert.Null(store.Take("never-issued"));
    }

    [Fact]
    public void The_relying_party_defaults_to_the_console_in_production_and_localhost_in_development()
    {
        var empty = new ConfigurationBuilder().Build();

        var production = PasskeySettings.Resolve(empty, isDevelopment: false);
        Assert.Equal("notefusion.studio", production.RpId);
        Assert.Equal(["https://admin.notefusion.studio"], production.Origins);
        Assert.Empty(production.OriginsOutsideRpId());

        var development = PasskeySettings.Resolve(empty, isDevelopment: true);
        Assert.Equal("localhost", development.RpId);
        Assert.Contains("http://localhost:3000", development.Origins);

        var configured = PasskeySettings.Resolve(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Passkeys:RpId"] = "Example.com",
            ["Passkeys:Origins"] = "https://a.example.com, https://b.example.com/",
        }).Build(), isDevelopment: false);
        Assert.Equal("example.com", configured.RpId);
        Assert.Equal(["https://a.example.com", "https://b.example.com"], configured.Origins);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────────

    private async Task<User> SeedAsync(string email, bool admin)
    {
        var user = admin
            ? User.CreateAdmin("Test Admin", email, "hash", _h.Clock.UtcNow)
            : User.Create("Test User", email, "hash", _h.Clock.UtcNow);
        if (!admin) _h.MarkEmailVerified(user);
        _h.Db.Users.Add(user);
        await _h.Db.SaveChangesAsync();
        return user;
    }

    private async Task<PasskeyDto> RegisterAsync(User admin, string name)
    {
        var options = (await BeginRegistration(admin).Handle(new BeginPasskeyRegistrationCommand(), default)).Value;
        var result = await CompleteRegistration(admin).Handle(
            new CompletePasskeyRegistrationCommand(_authenticator.Create(options), name), default);
        Assert.True(result.IsSuccess, result.IsSuccess ? null : result.Error.Message);
        return result.Value;
    }

    private async Task<NoteFusion.Shared.Results.Result<NoteFusion.Application.Auth.Dtos.LoginResponse>> SignInAsync(uint? counter = null)
    {
        var options = (await BeginSignIn().Handle(new BeginPasskeySignInCommand(), default)).Value;
        return await SignIn().Handle(new PasskeySignInCommand(_authenticator.Get(options, counter)), default);
    }

    private BeginPasskeyRegistrationCommandHandler BeginRegistration(User caller)
        => new(_h.Db, new StubCurrentUser(caller.Id, caller.Role, caller.Email), _ceremony, _challenges, _h.Clock);

    private CompletePasskeyRegistrationCommandHandler CompleteRegistration(User caller)
        => new(_h.Db, new StubCurrentUser(caller.Id, caller.Role, caller.Email), _ceremony, _challenges,
            _h.AuditAs(caller), _h.Clock, _h.Email);

    private BeginPasskeySignInCommandHandler BeginSignIn() => new(_ceremony, _challenges, _h.Clock);

    private PasskeySignInCommandHandler SignIn()
        => new(_h.Db, _ceremony, _challenges, _h.TokenIssuer, _h.ClientIp, _h.Clock,
            NullLogger<PasskeySignInCommandHandler>.Instance);
}
