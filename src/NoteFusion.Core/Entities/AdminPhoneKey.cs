using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// One phone's key to Admin (board f-admin/10 revised): a random secret the server handed the phone once, which the
/// phone keeps behind its strong fingerprint or face (Android Keystore, iOS Keychain biometry), so only the person whose
/// fingerprint is on that phone can send it back. The server keeps only its SHA-256. Made with the account password and
/// an emailed code; a fingerprint or face added to the phone later wipes the phone's copy, and Admin is set up again.
/// </summary>
public class AdminPhoneKey : BaseEntity
{
    private AdminPhoneKey() { } // EF Core

    public Guid UserId { get; private set; }

    /// <summary>Hex SHA-256 of the secret. The secret is 256 random bits, so a fast hash is enough.</summary>
    public string SecretHash { get; private set; } = string.Empty;

    /// <summary>What the phone called itself at setup ("Pixel 7"), for the email and the console.</summary>
    public string Label { get; private set; } = string.Empty;

    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? LastUsedAtUtc { get; private set; }
    public DateTime? RevokedAtUtc { get; private set; }

    public bool IsActive => RevokedAtUtc is null;

    public static AdminPhoneKey Create(Guid userId, string secretHash, string label, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            SecretHash = Guard.NotNullOrWhiteSpace(secretHash),
            Label = string.IsNullOrWhiteSpace(label) ? "Phone" : label.Trim()[..Math.Min(label.Trim().Length, 80)],
            CreatedAtUtc = utcNow,
        };

    public void MarkUsed(DateTime utcNow) => LastUsedAtUtc = utcNow;

    public void Revoke(DateTime utcNow) => RevokedAtUtc ??= utcNow;
}
