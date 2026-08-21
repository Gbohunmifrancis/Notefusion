using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Application.Auth.Dtos;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Auth;

/// <summary>
/// Sign-up email verification: the six-digit code, its limits, and the two places it gates. The rules
/// here are the whole defence — a code this short is a million guesses, and there is no rate limiter in
/// front of the API — so each limit gets a test that would fail if it were quietly relaxed.
/// </summary>
public class EmailVerificationTests
{
    private static readonly DateTime Now = new(2026, 8, 21, 9, 0, 0, DateTimeKind.Utc);

    // ---------------------------------------------------------------- the code itself

    [Fact]
    public void The_right_code_verifies_the_address()
    {
        using var h = new TestHarness(Now);
        var user = Unverified(h);

        var code = EmailVerificationCodes.Issue(user, h.Tokens, Now);

        Assert.True(EmailVerificationCodes.Consume(user, code, Now));
        Assert.True(user.EmailVerified);
    }

    [Fact]
    public void A_used_code_cannot_be_used_again()
    {
        using var h = new TestHarness(Now);
        var user = Unverified(h);
        var code = EmailVerificationCodes.Issue(user, h.Tokens, Now);
        EmailVerificationCodes.Consume(user, code, Now);

        // Deliberately not "already verified, so yes". Anyone could then post a garbage code against a
        // verified address and be handed tokens.
        Assert.False(EmailVerificationCodes.Consume(user, code, Now));
    }

    [Fact]
    public void A_wrong_code_is_refused_and_counted()
    {
        using var h = new TestHarness(Now);
        var user = Unverified(h);
        EmailVerificationCodes.Issue(user, h.Tokens, Now);

        Assert.False(EmailVerificationCodes.Consume(user, "000000", Now));
        Assert.False(user.EmailVerified);
        Assert.Equal(1, user.EmailVerificationAttempts);
    }

    [Fact]
    public void The_right_code_is_refused_once_the_attempts_run_out()
    {
        using var h = new TestHarness(Now);
        var user = Unverified(h);
        var code = EmailVerificationCodes.Issue(user, h.Tokens, Now);

        for (var i = 0; i < User.MaxEmailVerificationAttempts; i++)
        {
            Assert.False(EmailVerificationCodes.Consume(user, WrongCode(code), Now));
        }

        // The cap burns the code rather than merely refusing further guesses: a live code left sitting for
        // the rest of its ten minutes is one a resend-and-retry loop can keep working on.
        Assert.False(EmailVerificationCodes.Consume(user, code, Now));
        Assert.False(user.EmailVerified);
        Assert.Null(user.EmailVerificationCodeHash);
    }

    [Fact]
    public void An_expired_code_is_refused()
    {
        using var h = new TestHarness(Now);
        var user = Unverified(h);
        var code = EmailVerificationCodes.Issue(user, h.Tokens, Now);

        var tooLate = Now.Add(User.EmailVerificationLifetime).AddSeconds(1);

        Assert.False(EmailVerificationCodes.Consume(user, code, tooLate));
        Assert.False(user.EmailVerified);
    }

    [Fact]
    public void A_code_is_still_good_on_the_last_second_of_its_life()
    {
        using var h = new TestHarness(Now);
        var user = Unverified(h);
        var code = EmailVerificationCodes.Issue(user, h.Tokens, Now);

        Assert.True(EmailVerificationCodes.Consume(user, code, Now.Add(User.EmailVerificationLifetime)));
    }

    [Fact]
    public void A_fresh_code_gives_back_the_full_set_of_attempts()
    {
        using var h = new TestHarness(Now);
        var user = Unverified(h);
        EmailVerificationCodes.Issue(user, h.Tokens, Now);
        EmailVerificationCodes.Consume(user, "000000", Now);
        EmailVerificationCodes.Consume(user, "000001", Now);

        var second = EmailVerificationCodes.Issue(user, h.Tokens, Now.AddMinutes(2));

        Assert.Equal(0, user.EmailVerificationAttempts);
        Assert.True(EmailVerificationCodes.Consume(user, second, Now.AddMinutes(2)));
    }

    [Fact]
    public void A_new_code_retires_the_old_one()
    {
        using var h = new TestHarness(Now);
        var user = Unverified(h);
        var first = EmailVerificationCodes.Issue(user, h.Tokens, Now);
        var second = EmailVerificationCodes.Issue(user, h.Tokens, Now.AddMinutes(2));

        Assert.False(EmailVerificationCodes.Consume(user, first, Now.AddMinutes(2)));
        Assert.True(EmailVerificationCodes.Consume(user, second, Now.AddMinutes(2)));
    }

    [Fact]
    public void Codes_are_six_digits_and_not_the_same_one_twice()
    {
        using var h = new TestHarness(Now);

        var codes = Enumerable.Range(0, 40).Select(_ => h.Tokens.GenerateNumericCode()).ToList();

        Assert.All(codes, c => Assert.Matches("^[0-9]{6}$", c));

        // Not a randomness test — a broken generator that returned a constant, or dropped leading zeros,
        // would pass the shape check above and fail here.
        Assert.True(codes.Distinct().Count() > 30);
    }

    [Fact]
    public void Resending_is_refused_inside_the_cooldown_and_allowed_after_it()
    {
        using var h = new TestHarness(Now);
        var user = Unverified(h);

        Assert.True(user.CanResendEmailVerification(Now)); // nothing sent yet

        EmailVerificationCodes.Issue(user, h.Tokens, Now);

        Assert.False(user.CanResendEmailVerification(Now.AddSeconds(59)));
        Assert.True(user.CanResendEmailVerification(Now.Add(User.EmailVerificationResendCooldown)));
    }

    // ---------------------------------------------------------------- how accounts start out

    [Fact]
    public void A_password_sign_up_starts_unverified_and_a_google_one_does_not()
    {
        using var h = new TestHarness(Now);

        var password = User.Create("Pat", "pat@example.com", h.Hasher.Hash("password123"), Now);
        var google = User.CreateFromGoogle("Ada", "ada@example.com", "google-123", null, Now);

        Assert.False(password.EmailVerified);

        // GoogleSignInCommand refuses a Google identity whose email Google has not verified, so by the time
        // an account is created this way the address is already proved. Asking for a code would be theatre.
        Assert.True(google.EmailVerified);
    }

    [Fact]
    public void An_admin_is_created_verified()
    {
        using var h = new TestHarness(Now);

        // Seeded from configuration at boot, with no mailbox to check a code from. An admin locked out of
        // the console is a deploy nobody can administer.
        var admin = User.CreateAdmin("Ada Admin", "ada@notefusion.studio", h.Hasher.Hash("password123"), Now);

        Assert.True(admin.EmailVerified);
    }

    [Fact]
    public void Linking_google_to_an_unverified_account_discards_its_password()
    {
        using var h = new TestHarness(Now);

        // The takeover this closes: someone registers with an address they do not own, gets no tokens, and
        // waits. The real owner later signs in with Google, which merges onto that row — and the squatter's
        // password would work on it. It was chosen by whoever typed the address in, not by the owner.
        var squatted = User.Create("Pat", "pat@example.com", h.Hasher.Hash("squatter-pw"), Now);

        squatted.LinkGoogleAccount("google-123");

        Assert.Null(squatted.PasswordHash);
        Assert.True(squatted.EmailVerified);
    }

    [Fact]
    public void Linking_google_to_a_verified_account_keeps_its_password()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Pat", "pat@example.com", h.Hasher.Hash("password123"), Now);
        h.MarkEmailVerified(user);

        user.LinkGoogleAccount("google-123");

        // This one proved the mailbox, so the password is theirs and both ways in keep working.
        Assert.NotNull(user.PasswordHash);
    }

    [Fact]
    public void Resetting_the_password_also_verifies_the_address()
    {
        using var h = new TestHarness(Now);
        var user = Unverified(h);
        user.SetPasswordResetToken("hash", Now);

        Assert.True(user.ConsumePasswordResetToken("hash", h.Hasher.Hash("new-password"), Now));

        // Receiving the link proves the mailbox exactly as the code does. Without this an unverified user
        // who reset their password would reset it forever: the new one works, and login still refuses them.
        Assert.True(user.EmailVerified);
    }

    // ---------------------------------------------------------------- verify-email

    [Fact]
    public async Task Verifying_issues_the_tokens_registration_withheld()
    {
        using var h = new TestHarness(Now);
        var email = await Register(h);
        var code = h.Email.VerificationCodes.Single();

        var result = await Verify(h, email, code);

        Assert.True(result.IsSuccess);
        Assert.NotEmpty(result.Value.AccessToken);
        Assert.NotEmpty(result.Value.RefreshToken);
        Assert.Equal(email, result.Value.User.Email);
        Assert.True(Assert.Single(h.Db.Users).EmailVerified);

        // The welcome lands here rather than at sign-up: this is the first moment the address is known good.
        Assert.Contains(h.Email.Sent, s => s.Kind == "welcome" && s.To.Email == email);
    }

    [Fact]
    public async Task A_wrong_code_is_rejected_and_the_failed_attempt_is_committed()
    {
        using var h = new TestHarness(Now);
        var email = await Register(h);

        var result = await Verify(h, email, WrongCode(h.Email.VerificationCodes.Single()));

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_INVALID_VERIFICATION_CODE", result.Error.Code);

        // Reload from the database, not the tracked instance: an increment that was never saved is no cap
        // at all, and the next request gets a fresh five guesses.
        h.Db.ChangeTracker.Clear();
        Assert.Equal(1, h.Db.Users.Single().EmailVerificationAttempts);
    }

    [Fact]
    public async Task An_unknown_address_gets_the_same_answer_as_a_wrong_code()
    {
        using var h = new TestHarness(Now);

        var result = await Verify(h, "nobody@example.com", "123456");

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_INVALID_VERIFICATION_CODE", result.Error.Code); // no account enumeration
        Assert.Empty(h.Email.Sent);
    }

    [Fact]
    public async Task Verifying_twice_does_not_hand_out_a_second_session()
    {
        using var h = new TestHarness(Now);
        var email = await Register(h);
        var code = h.Email.VerificationCodes.Single();
        await Verify(h, email, code);

        var again = await Verify(h, email, code);

        Assert.True(again.IsFailure);
        Assert.Equal("AUTH_INVALID_VERIFICATION_CODE", again.Error.Code);
        Assert.Single(h.Email.Sent, s => s.Kind == "welcome");
    }

    [Fact]
    public async Task A_deactivated_account_cannot_verify_its_way_in()
    {
        using var h = new TestHarness(Now);
        var email = await Register(h);
        var code = h.Email.VerificationCodes.Single();

        var user = h.Db.Users.Single();
        user.Suspend();
        await h.Db.SaveChangesAsync();

        var result = await Verify(h, email, code);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_ACCOUNT_INACTIVE", result.Error.Code);
    }

    // ---------------------------------------------------------------- resend

    [Fact]
    public async Task Resending_mails_a_second_code_that_works()
    {
        using var h = new TestHarness(Now);
        var email = await Register(h);

        h.Clock.UtcNow = Now.Add(User.EmailVerificationResendCooldown);
        var resend = await Resend(h, email);

        Assert.True(resend.IsSuccess);
        Assert.Equal(2, h.Email.VerificationCodes.Count);

        var second = await Verify(h, email, h.Email.VerificationCodes.Last());
        Assert.True(second.IsSuccess);
    }

    [Fact]
    public async Task Resending_inside_the_cooldown_reports_success_and_sends_nothing()
    {
        using var h = new TestHarness(Now);
        var email = await Register(h);

        h.Clock.UtcNow = Now.AddSeconds(30);
        var resend = await Resend(h, email);

        // Success either way. Saying "too soon" would confirm the address is registered, and the countdown
        // the user sees is the client's own.
        Assert.True(resend.IsSuccess);
        Assert.Single(h.Email.VerificationCodes);
    }

    [Fact]
    public async Task Resending_to_an_unknown_or_verified_address_reports_success_and_sends_nothing()
    {
        using var h = new TestHarness(Now);
        var email = await Register(h);
        await Verify(h, email, h.Email.VerificationCodes.Single());

        Assert.True((await Resend(h, "nobody@example.com")).IsSuccess);
        Assert.True((await Resend(h, email)).IsSuccess);

        Assert.Single(h.Email.VerificationCodes);
    }

    // ---------------------------------------------------------------- the login gate

    [Fact]
    public async Task An_unverified_account_is_refused_at_login_and_mailed_a_fresh_code()
    {
        using var h = new TestHarness(Now);
        var email = await Register(h);

        h.Clock.UtcNow = Now.Add(User.EmailVerificationResendCooldown);
        var result = await Login(h).Handle(new LoginCommand(email, "password123"), default);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_EMAIL_NOT_VERIFIED", result.Error.Code);

        // Routed to the code screen with something to type: the second code is the one that will work.
        Assert.Equal(2, h.Email.VerificationCodes.Count);
        var verified = await Verify(h, email, h.Email.VerificationCodes.Last());
        Assert.True(verified.IsSuccess);
    }

    [Fact]
    public async Task The_wrong_password_on_an_unverified_account_says_nothing_about_it()
    {
        using var h = new TestHarness(Now);
        var email = await Register(h);

        h.Clock.UtcNow = Now.Add(User.EmailVerificationResendCooldown);
        var result = await Login(h).Handle(new LoginCommand(email, "not-the-password"), default);

        // The gate sits after the password check on purpose. Ahead of it, login would answer "is this
        // address registered?" for anyone who asked, without knowing any password.
        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_INVALID_CREDENTIALS", result.Error.Code);
        Assert.Single(h.Email.VerificationCodes);
    }

    [Fact]
    public async Task Repeated_logins_do_not_turn_into_repeated_emails()
    {
        using var h = new TestHarness(Now);
        var email = await Register(h);

        for (var i = 0; i < 5; i++)
        {
            await Login(h).Handle(new LoginCommand(email, "password123"), default);
        }

        // Same cooldown as resend, so a client that retries on 403 cannot mail-bomb the address.
        Assert.Single(h.Email.VerificationCodes);
    }

    [Fact]
    public async Task A_verified_account_signs_in_normally()
    {
        using var h = new TestHarness(Now);
        var email = await Register(h);
        await Verify(h, email, h.Email.VerificationCodes.Single());

        var result = await Login(h).Handle(new LoginCommand(email, "password123"), default);

        Assert.True(result.IsSuccess);
        Assert.NotEmpty(result.Value.AccessToken);
    }

    // ---------------------------------------------------------------- fixtures

    private static User Unverified(TestHarness h)
        => User.Create("Pat Pending", "pat@example.com", h.Hasher.Hash("password123"), Now);

    /// <summary>Registers an account through the real handler and returns the normalised email.</summary>
    private static async Task<string> Register(TestHarness h)
    {
        var result = await new RegisterCommandHandler(h.Db, h.Hasher, h.Tokens, h.Clock, h.Email, h.Country)
            .Handle(new RegisterCommand("Pat Pending", "pat@example.com", "password123"), default);

        Assert.True(result.IsSuccess);
        return result.Value.Email;
    }

    private static Task<Result<LoginResponse>> Verify(TestHarness h, string email, string code)
        => new VerifyEmailCommandHandler(h.Db, h.TokenIssuer, h.Clock, h.Email)
            .Handle(new VerifyEmailCommand(email, code), default);

    private static Task<Result<MediatR.Unit>> Resend(TestHarness h, string email)
        => new ResendEmailVerificationCommandHandler(
                h.Db, h.Tokens, h.Clock, h.Email,
                NullLogger<ResendEmailVerificationCommandHandler>.Instance)
            .Handle(new ResendEmailVerificationCommand(email), default);

    private static LoginCommandHandler Login(TestHarness h)
        => new(h.Db, h.Hasher, h.TokenIssuer, h.Tokens, h.Clock, h.Country, h.Email);

    /// <summary>Any six digits that are not <paramref name="code"/>.</summary>
    private static string WrongCode(string code) => code == "000000" ? "111111" : "000000";
}
