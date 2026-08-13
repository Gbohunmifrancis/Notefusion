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

    /// <summary>Avatar URL — Cloudinary for uploads, or Google's <c>picture</c> claim on first Google sign-in.</summary>
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
    /// Links a Google account to an existing password account, so both routes reach the
    /// same user. Callers must have confirmed Google verified the email first — linking on
    /// an unverified email would let anyone claiming that address take over the account.
    /// </summary>
    public void LinkGoogleAccount(string googleId)
    {
        GoogleId = Guard.NotNullOrWhiteSpace(googleId);
    }

    /// <summary>Adopts Google's avatar only when the user has no picture of their own to lose.</summary>
    public void SetProfilePictureIfMissing(string? url)
    {
        if (string.IsNullOrWhiteSpace(ProfilePictureUrl))
        {
            ProfilePictureUrl = url;
        }
    }

    /// <summary>Replaces the avatar (Cloudinary upload, or null to clear it).</summary>
    public void SetProfilePicture(string? url) => ProfilePictureUrl = url;

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
    public void RegisterDeviceToken(string tokenValue, string platform, DateTime utcNow)
    {
        var existing = _deviceTokens.FirstOrDefault(t => t.Token == tokenValue);
        if (existing is not null)
        {
            existing.Touch(utcNow);
            return;
        }

        _deviceTokens.Add(DeviceToken.Create(Id, tokenValue, platform, utcNow));
    }

    private static string NormalizeEmail(string email) => Guard.NotNullOrWhiteSpace(email).Trim().ToLowerInvariant();
}
