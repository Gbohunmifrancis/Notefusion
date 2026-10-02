using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A login-capable account (PRD §auth). Encapsulates the login lockout, first-login,
/// and per-device push-token rules. Ids are deterministic from the email so a user's
/// data survives a database reset (SbzFarms pattern, kept for the consumer app).
/// </summary>
public class User : BaseEntity
{
    public const int MaxFailedLoginAttempts = 5;
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(30);

    /// <summary>
    /// Guesses allowed against one verification code before it is burned. A six-digit code is a million
    /// possibilities, which sounds ample until you notice there is no rate limiter in front of the API:
    /// this cap and the resend cooldown are the whole of the brute-force defence.
    /// </summary>
    public const int MaxEmailVerificationAttempts = 5;

    /// <summary>
    /// How long a verification code stays usable. Short enough that a code read from a breached mailbox
    /// months later is worthless, long enough to survive a slow mail provider and a user who switches
    /// apps to find it.
    /// </summary>
    public static readonly TimeSpan EmailVerificationLifetime = TimeSpan.FromMinutes(10);

    /// <summary>
    /// The wait between codes for one address. Registration and resend both mail whoever is named, so
    /// without this the sign-up form is a mail-bombing tool pointed at any address the caller likes.
    /// </summary>
    public static readonly TimeSpan EmailVerificationResendCooldown = TimeSpan.FromSeconds(60);

    private readonly List<RefreshToken> _refreshTokens = [];
    private readonly List<DeviceToken> _deviceTokens = [];

    private User() { } // EF Core

    public string FullName { get; private set; } = string.Empty;
    public string Email { get; private set; } = string.Empty;
    public string? PhoneNumber { get; private set; }

    /// <summary>
    /// Null for accounts created through Google — those users never set a password,
    /// and a placeholder hash would misrepresent that as "password login available".
    /// Callers must treat null as "password sign-in is not possible for this account".
    /// </summary>
    public string? PasswordHash { get; private set; }

    /// <summary>The Google <c>sub</c> claim, set once a Google account is linked. Null for password-only users.</summary>
    public string? GoogleId { get; private set; }

    /// <summary>Avatar URL — R2 for uploads, or Google's <c>picture</c> claim on first Google sign-in.</summary>
    public string? ProfilePictureUrl { get; private set; }

    public UserRole Role { get; private set; } = UserRole.User;
    public bool IsActive { get; private set; } = true;
    public bool IsFirstLogin { get; private set; }
    public DateTime? LastLoginAt { get; private set; }
    public int FailedLoginAttempts { get; private set; }
    public DateTime? LockoutEndAt { get; private set; }
    public DateTime CreatedAt { get; private set; }

    /// <summary>
    /// Opaque, cryptographically random token issued on a forgot-password request.
    /// Null when no reset is in flight. The hash is stored, not the plaintext, so
    /// a database breach cannot be used to trigger resets.
    /// </summary>
    public string? PasswordResetTokenHash { get; private set; }

    /// <summary>UTC expiry for the current reset token. Null when no token is set.</summary>
    public DateTime? PasswordResetTokenExpiry { get; private set; }

    /// <summary>
    /// Whether the address on this account has been proved to belong to whoever signed up. False until
    /// the emailed code is entered, and password sign-in is refused until it is true.
    /// </summary>
    /// <remarks>
    /// Google-created accounts start true: Google has already proved the address, and
    /// <c>GoogleSignInCommand</c> refuses an identity whose email Google itself has not verified.
    /// </remarks>
    public bool EmailVerified { get; private set; }

    /// <summary>
    /// SHA-256 of the current six-digit code, or null when none is outstanding. Hashed for the same
    /// reason the reset token is: a database read must not hand anyone a working code.
    /// </summary>
    public string? EmailVerificationCodeHash { get; private set; }

    /// <summary>UTC expiry of the current code. Null when none is outstanding.</summary>
    public DateTime? EmailVerificationExpiry { get; private set; }

    /// <summary>
    /// Wrong guesses against the current code. Reset when a new code is issued, and the reason a code
    /// can die before its expiry.
    /// </summary>
    public int EmailVerificationAttempts { get; private set; }

    /// <summary>
    /// When the last code was mailed, which is what the resend cooldown is measured from. Kept even
    /// after the code is consumed, so it cannot be reset by verifying and re-registering.
    /// </summary>
    public DateTime? EmailVerificationSentAtUtc { get; private set; }

    /// <summary>
    /// ISO 3166-1 alpha-2 code for where this account was first seen, or null when it could not be
    /// determined. Drives which billing tier the user is offered, so it is stored rather than derived per
    /// request for two reasons: the offer stays put when the user travels, and we keep a record of why a
    /// given person was shown a given price — which matters the first time someone disputes it.
    /// </summary>
    public string? Country { get; private set; }

    /// <summary>
    /// Which client created the account: "web" or "mobile". Null for accounts that predate the field,
    /// which the dashboard reports as unknown rather than guessing.
    /// </summary>
    public string? SignupSource { get; private set; }

    /// <summary>First value wins, like <see cref="RecordCountry"/>: the source is where the account was born.</summary>
    public void RecordSignupSource(string? source)
    {
        if (SignupSource is not null || string.IsNullOrWhiteSpace(source)) return;
        var s = source.Trim().ToLowerInvariant();
        if (s is "web" or "mobile") SignupSource = s;
    }

    public IReadOnlyCollection<RefreshToken> RefreshTokens => _refreshTokens.AsReadOnly();
    public IReadOnlyCollection<DeviceToken> DeviceTokens => _deviceTokens.AsReadOnly();

    /// <summary>Generates a deterministic GUID from the normalized email so user IDs persist across database resets.</summary>
    public static Guid GenerateDeterministicId(string email)
    {
        var normalized = NormalizeEmail(email);
        using var md5 = System.Security.Cryptography.MD5.Create();
        var hash = md5.ComputeHash(System.Text.Encoding.UTF8.GetBytes(normalized));
        return new Guid(hash);
    }

    /// <summary>Creates the seeded admin (used only from the database seeder).</summary>
    public static User CreateAdmin(string fullName, string email, string passwordHash, DateTime utcNow)
        => new()
        {
            Id = GenerateDeterministicId(email),
            FullName = Guard.NotNullOrWhiteSpace(fullName),
            Email = NormalizeEmail(email),
            PasswordHash = Guard.NotNullOrWhiteSpace(passwordHash),
            Role = UserRole.Admin,
            IsActive = true,
            IsFirstLogin = false,
            // Nobody is going to mail the seeded admin a code, and an admin locked out of the console
            // is a deploy that cannot be administered.
            EmailVerified = true,
            CreatedAt = utcNow
        };

    /// <summary>Creates a regular user during sign-up.</summary>
    public static User Create(string fullName, string email, string passwordHash, DateTime utcNow)
        => new()
        {
            Id = GenerateDeterministicId(email),
            FullName = Guard.NotNullOrWhiteSpace(fullName),
            Email = NormalizeEmail(email),
            PasswordHash = Guard.NotNullOrWhiteSpace(passwordHash),
            Role = UserRole.User,
            IsActive = true,
            IsFirstLogin = false,
            // Unverified, and no tokens are issued until it is: anyone can type any address into a
            // sign-up form, so until the code comes back this account is only a claim.
            EmailVerified = false,
            CreatedAt = utcNow
        };

    /// <summary>
    /// Creates a user from a validated Google identity. No password is set, so
    /// <see cref="PasswordHash"/> stays null until the user explicitly sets one.
    /// </summary>
    public static User CreateFromGoogle(
        string fullName, string email, string googleId, string? profilePictureUrl, DateTime utcNow)
        => new()
        {
            Id = GenerateDeterministicId(email),
            FullName = Guard.NotNullOrWhiteSpace(fullName),
            Email = NormalizeEmail(email),
            GoogleId = Guard.NotNullOrWhiteSpace(googleId),
            ProfilePictureUrl = profilePictureUrl,
            Role = UserRole.User,
            IsActive = true,
            IsFirstLogin = false,
            // Google proved the address, and the caller has already refused any identity Google itself
            // marks unverified. Mailing a code to confirm what an identity provider just confirmed
            // would be a step with nothing behind it.
            EmailVerified = true,
            CreatedAt = utcNow
        };

    /// <summary>
    /// Grants this account the administrator role. Separate from <see cref="CreateAdmin"/>, which only
    /// covers the account that does not exist yet: an admin is often someone who already signed up as a
    /// user, and re-creating them would orphan their transcriptions. Returns false when the account was
    /// already an admin, so the caller can avoid a pointless write.
    /// </summary>
    public bool PromoteToAdmin()
    {
        if (Role == UserRole.Admin) return false;

        Role = UserRole.Admin;
        return true;
    }

    /// <summary>
    /// Removes the administrator role, pairing with <see cref="PromoteToAdmin"/>. Returns false when the
    /// account was not an admin, so a repeated click costs no write.
    /// </summary>
    /// <remarks>
    /// Nothing here stops the last admin demoting themselves out of the console — that is a rule about the
    /// whole set of accounts, which this entity cannot see, so the command layer holds it.
    /// </remarks>
    public bool DemoteFromAdmin()
    {
        if (Role == UserRole.User) return false;

        Role = UserRole.User;
        return true;
    }

    /// <summary>
    /// Bars the account from signing in. Returns false when it was already suspended.
    /// </summary>
    /// <remarks>
    /// This one flag is the whole enforcement: login, Google sign-in and refresh all already refuse an
    /// inactive account. What it does <em>not</em> do is invalidate an access token already in the user's
    /// hands — those are self-contained JWTs, valid until they expire — so a caller that means "cut this
    /// account off" must also revoke the refresh tokens, and whatever tells the operator it worked has to
    /// name that remaining window rather than imply an instant cut-off.
    /// </remarks>
    public bool Suspend()
    {
        if (!IsActive) return false;

        IsActive = false;
        return true;
    }

    /// <summary>Restores a suspended account. Returns false when it was already active.</summary>
    /// <remarks>
    /// Sign-in works again immediately; the revoked refresh tokens are not resurrected, so every device
    /// signs in once more. That is the honest outcome — an un-revoked token is one an attacker may have
    /// taken a copy of.
    /// </remarks>
    public bool Reactivate()
    {
        if (IsActive) return false;

        IsActive = true;
        return true;
    }

    /// <summary>
    /// Links a Google account to an existing password account, so both routes reach the
    /// same user. Callers must have confirmed Google verified the email first — linking on
    /// an unverified email would let anyone claiming that address take over the account.
    /// </summary>
    /// <remarks>
    /// Google's assurance also verifies the address here. The discarded password is the part worth
    /// explaining: a password on an <em>unverified</em> account was chosen by whoever typed the address
    /// into the sign-up form, who may not be the person now proving they own it. Keeping it would leave
    /// that stranger a working credential on someone else's account, so the account becomes Google-only
    /// until its real owner sets a password through the reset flow.
    /// </remarks>
    public void LinkGoogleAccount(string googleId)
    {
        GoogleId = Guard.NotNullOrWhiteSpace(googleId);

        if (!EmailVerified)
        {
            PasswordHash = null;
        }

        EmailVerified = true;
    }

    /// <summary>Adopts Google's avatar only when the user has no picture of their own to lose.</summary>
    public void SetProfilePictureIfMissing(string? url)
    {
        if (string.IsNullOrWhiteSpace(ProfilePictureUrl))
        {
            ProfilePictureUrl = url;
        }
    }

    /// <summary>Replaces the avatar (R2 upload, or null to clear it).</summary>
    public void SetProfilePicture(string? url) => ProfilePictureUrl = url;

    /// <summary>
    /// Records where this account was first observed, once. First observation wins on purpose: it makes
    /// this safe to call on every sign-in — which is what backfills accounts created before we resolved
    /// countries at all, and accounts whose lookup failed the first time — while guaranteeing a user who
    /// travels, or who signs in over a VPN, is never silently re-priced. Blank or malformed input is
    /// ignored rather than stored: "unknown" and "wrong" are not the same, and only the first is safe.
    /// Returns true when the value was actually taken, so a caller can skip a pointless write.
    /// </summary>
    public bool RecordCountry(string? isoAlpha2)
    {
        if (Country is not null) return false;

        var code = isoAlpha2?.Trim().ToUpperInvariant();
        if (code is null || code.Length != 2 || !code.All(char.IsAsciiLetterUpper)) return false;

        Country = code;
        return true;
    }

    public bool IsLockedOut(DateTime utcNow) => LockoutEndAt.HasValue && LockoutEndAt.Value > utcNow;

    public void RecordSuccessfulLogin(DateTime utcNow)
    {
        FailedLoginAttempts = 0;
        LockoutEndAt = null;
        LastLoginAt = utcNow;
    }

    /// <summary>Increments the failed-attempt counter and locks the account once the threshold is hit.</summary>
    public void RecordFailedLogin(DateTime utcNow)
    {
        FailedLoginAttempts++;
        if (FailedLoginAttempts >= MaxFailedLoginAttempts)
        {
            LockoutEndAt = utcNow.Add(LockoutDuration);
            FailedLoginAttempts = 0;
        }
    }

    public void ChangePassword(string newPasswordHash, DateTime utcNow)
    {
        PasswordHash = Guard.NotNullOrWhiteSpace(newPasswordHash);
        IsFirstLogin = false;
    }

    /// <summary>
    /// Stores a hashed reset token valid for one hour. The caller supplies the hash;
    /// the plaintext is returned to the user via email and never persisted.
    /// </summary>
    public void SetPasswordResetToken(string tokenHash, DateTime utcNow)
    {
        PasswordResetTokenHash = Guard.NotNullOrWhiteSpace(tokenHash);
        PasswordResetTokenExpiry = utcNow.AddHours(1);
    }

    /// <summary>
    /// Verifies the token hash, resets the password, and invalidates the token.
    /// Returns false when the token does not match or has expired.
    /// </summary>
    public bool ConsumePasswordResetToken(string tokenHash, string newPasswordHash, DateTime utcNow)
    {
        if (PasswordResetTokenHash is null
            || PasswordResetTokenExpiry is null
            || PasswordResetTokenExpiry.Value < utcNow
            || PasswordResetTokenHash != tokenHash)
        {
            return false;
        }

        PasswordHash = Guard.NotNullOrWhiteSpace(newPasswordHash);
        PasswordResetTokenHash = null;
        PasswordResetTokenExpiry = null;
        IsFirstLogin = false;

        // Receiving the reset link proves the mailbox, which is the same thing the six-digit code
        // proves — so an account that resets its password is verified by that alone. Without this, a
        // new user who never entered their code and then reset their password would be left resetting
        // it forever: the new password works, and login still refuses them.
        EmailVerified = true;
        EmailVerificationCodeHash = null;
        EmailVerificationExpiry = null;
        return true;
    }

    /// <summary>
    /// Stores the hash of a freshly minted verification code and starts its clock. The caller supplies
    /// the hash; the six digits themselves are emailed and never persisted.
    /// </summary>
    /// <remarks>
    /// Resets the attempt counter, because the guesses were spent against the old code — carrying them
    /// forward would mean a user who mistyped twice gets three tries on a code they have only just
    /// received. <see cref="EmailVerificationSentAtUtc"/> is what the resend cooldown reads.
    /// </remarks>
    public void SetEmailVerificationCode(string codeHash, DateTime utcNow)
    {
        EmailVerificationCodeHash = Guard.NotNullOrWhiteSpace(codeHash);
        EmailVerificationExpiry = utcNow.Add(EmailVerificationLifetime);
        EmailVerificationAttempts = 0;
        EmailVerificationSentAtUtc = utcNow;
    }

    /// <summary>
    /// Whether enough time has passed since the last code to send another. False means the caller should
    /// silently do nothing — telling an anonymous caller they are on cooldown would confirm the address
    /// is registered.
    /// </summary>
    public bool CanResendEmailVerification(DateTime utcNow)
        => EmailVerificationSentAtUtc is null
            || utcNow - EmailVerificationSentAtUtc.Value >= EmailVerificationResendCooldown;

    /// <summary>
    /// Checks a code and, on a match, marks the address verified. Returns false for a code that is
    /// wrong, expired, exhausted, or absent — one answer for all four, so the caller cannot leak which.
    /// </summary>
    /// <remarks>
    /// A miss increments the attempt counter and, on reaching
    /// <see cref="MaxEmailVerificationAttempts"/>, destroys the code outright. Merely refusing further
    /// guesses would leave a live code sitting there for the ten minutes an attacker needs to request a
    /// resend and keep going; burning it forces them back through the cooldown for every five tries.
    /// </remarks>
    public bool ConsumeEmailVerificationCode(string codeHash, DateTime utcNow)
    {
        if (EmailVerificationCodeHash is null
            || EmailVerificationExpiry is null
            || EmailVerificationExpiry.Value < utcNow
            || EmailVerificationAttempts >= MaxEmailVerificationAttempts)
        {
            return false;
        }

        if (EmailVerificationCodeHash != codeHash)
        {
            EmailVerificationAttempts++;
            if (EmailVerificationAttempts >= MaxEmailVerificationAttempts)
            {
                EmailVerificationCodeHash = null;
                EmailVerificationExpiry = null;
            }

            return false;
        }

        EmailVerified = true;
        EmailVerificationCodeHash = null;
        EmailVerificationExpiry = null;
        EmailVerificationAttempts = 0;
        return true;
    }

    /// <summary>Self-service profile update (name + optional phone). Email and role are not user-editable.</summary>
    public void UpdateProfile(string fullName, string? phoneNumber)
    {
        FullName = Guard.NotNullOrWhiteSpace(fullName);
        PhoneNumber = phoneNumber;
    }

    public void AddRefreshToken(RefreshToken token) => _refreshTokens.Add(token);

    /// <summary>Registers or refreshes a device push token (expo push token, PRD §push).</summary>
    /// <param name="appBuild">
    /// The build this device is running. Re-registration is how the server learns a device has
    /// updated, so this is recorded on the refresh path too, not only on first registration.
    /// </param>
    public void RegisterDeviceToken(string tokenValue, string platform, int appBuild, DateTime utcNow)
    {
        var existing = _deviceTokens.FirstOrDefault(t => t.Token == tokenValue);
        if (existing is not null)
        {
            existing.ReportBuild(appBuild, utcNow);
            return;
        }

        _deviceTokens.Add(DeviceToken.Create(Id, tokenValue, platform, appBuild, utcNow));
    }

    /// <summary>
    /// Drops a device push token, so the server stops sending to it. Deleting rather than
    /// flagging keeps <see cref="DeviceToken"/> a plain record of "somewhere we can reach you":
    /// the client re-registers whenever the user turns notifications back on.
    /// </summary>
    /// <returns><c>true</c> when a token was removed; <c>false</c> when there was nothing to remove.</returns>
    public bool RemoveDeviceToken(string tokenValue)
    {
        var existing = _deviceTokens.FirstOrDefault(t => t.Token == tokenValue);
        if (existing is null)
            return false;

        _deviceTokens.Remove(existing);
        return true;
    }

    private static string NormalizeEmail(string email) => Guard.NotNullOrWhiteSpace(email).Trim().ToLowerInvariant();
}
