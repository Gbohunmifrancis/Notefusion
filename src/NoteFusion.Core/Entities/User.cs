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
    public string PasswordHash { get; private set; } = string.Empty;
    public UserRole Role { get; private set; } = UserRole.User;
    public bool IsActive { get; private set; } = true;
    public bool IsFirstLogin { get; private set; }
    public DateTime? LastLoginAt { get; private set; }
    public int FailedLoginAttempts { get; private set; }
    public DateTime? LockoutEndAt { get; private set; }
    public DateTime CreatedAt { get; private set; }

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
