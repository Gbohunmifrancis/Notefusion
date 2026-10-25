using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A browser an admin told the console to remember: after a passkey or password unlock it keeps a random token, and the
/// console opens its pass with that token instead of asking again on every reload, new tab, hour away or API restart.
/// The server keeps only the token's SHA-256. A pass opened this way is never a fresh confirmation, so the destructive
/// actions still want the passkey. It lasts <see cref="Lifetime"/> from when it was made, and ends at sign-out or when
/// forgotten in Settings.
/// </summary>
public class AdminTrustedBrowser : BaseEntity
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(30);

    /// <summary>Browsers one admin may have remembered at once; remembering another forgets the least recently used.</summary>
    public const int MaxPerAdmin = 10;

    public const int LabelMaxLength = 80;

    private AdminTrustedBrowser() { } // EF Core

    public Guid UserId { get; private set; }

    /// <summary>Hex SHA-256 of the token: 256 random bits, so a fast hash is enough.</summary>
    public string TokenHash { get; private set; } = string.Empty;

    /// <summary>The browser and system it was remembered on ("Chrome on Windows"), for Settings.</summary>
    public string Label { get; private set; } = string.Empty;

    public DateTime CreatedAtUtc { get; private set; }
    public DateTime LastUsedAtUtc { get; private set; }
    public DateTime ExpiresAtUtc { get; private set; }
    public DateTime? RevokedAtUtc { get; private set; }

    public bool IsActiveAt(DateTime utcNow) => RevokedAtUtc is null && ExpiresAtUtc > utcNow;

    public static AdminTrustedBrowser Create(Guid userId, string tokenHash, string? label, DateTime utcNow)
    {
        label = string.IsNullOrWhiteSpace(label) ? "A browser" : label.Trim();
        return new AdminTrustedBrowser
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            TokenHash = Guard.NotNullOrWhiteSpace(tokenHash),
            Label = label[..Math.Min(label.Length, LabelMaxLength)],
            CreatedAtUtc = utcNow,
            LastUsedAtUtc = utcNow,
            ExpiresAtUtc = utcNow + Lifetime,
        };
    }

    public void MarkUsed(DateTime utcNow) => LastUsedAtUtc = utcNow;

    public void Revoke(DateTime utcNow) => RevokedAtUtc ??= utcNow;
}
