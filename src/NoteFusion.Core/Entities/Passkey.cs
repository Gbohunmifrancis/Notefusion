using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A WebAuthn credential (a passkey) an account can sign in with instead of its password. Only the public
/// half is stored; the private key never leaves the authenticator.
/// </summary>
/// <remarks>
/// Admin-console only for now: registration is behind the Admin policy and a passkey sign-in issues tokens
/// only to an admin account. The row goes with its account (cascade).
/// </remarks>
public sealed class Passkey : BaseEntity
{
    public const int NameMaxLength = 60;

    /// <summary>What a passkey is called when its owner gave it no name.</summary>
    public const string DefaultName = "Passkey";

    private Passkey() { } // EF Core

    public Guid UserId { get; private set; }

    /// <summary>The authenticator's credential id (raw bytes); unique across every account.</summary>
    public byte[] CredentialId { get; private set; } = [];

    /// <summary>The COSE-encoded public key the authenticator handed over at registration.</summary>
    public byte[] PublicKey { get; private set; } = [];

    /// <summary>
    /// The authenticator's signature counter as last seen. A sign-in reporting a counter at or below this one
    /// (when either is non-zero) is refused: it is the WebAuthn sign of a cloned authenticator. Synced
    /// passkeys report zero every time, which is allowed.
    /// </summary>
    public long SignCount { get; private set; }

    /// <summary>The authenticator model's AAGUID (all zeros when the authenticator does not say).</summary>
    public Guid AaGuid { get; private set; }

    /// <summary>How the browser can reach the authenticator ("internal,hybrid"), comma-separated; may be null.</summary>
    public string? Transports { get; private set; }

    /// <summary>The owner's name for it ("MacBook Touch ID").</summary>
    public string Name { get; private set; } = DefaultName;

    public DateTime CreatedAtUtc { get; private set; }

    public DateTime? LastUsedAtUtc { get; private set; }

    public static Passkey Register(
        Guid userId,
        byte[] credentialId,
        byte[] publicKey,
        uint signCount,
        Guid aaGuid,
        IEnumerable<string> transports,
        string? name,
        DateTime utcNow)
    {
        Guard.NotNull(credentialId);
        Guard.NotNull(publicKey);
        if (credentialId.Length == 0) throw new ArgumentException("A credential id is required.", nameof(credentialId));
        if (publicKey.Length == 0) throw new ArgumentException("A public key is required.", nameof(publicKey));

        var joined = string.Join(',', transports.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => t.Trim()));

        return new Passkey
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            CredentialId = credentialId,
            PublicKey = publicKey,
            SignCount = signCount,
            AaGuid = aaGuid,
            Transports = joined.Length == 0 ? null : joined,
            Name = Normalise(name),
            CreatedAtUtc = utcNow
        };
    }

    public void Rename(string? name) => Name = Normalise(name);

    /// <summary>Records a verified sign-in: the counter the authenticator reported, and when.</summary>
    public void RecordUse(uint signCount, DateTime utcNow)
    {
        SignCount = signCount;
        LastUsedAtUtc = utcNow;
    }

    /// <summary>Trimmed, never blank (blank becomes <see cref="DefaultName"/>), at most <see cref="NameMaxLength"/>.</summary>
    public static string Normalise(string? name)
    {
        var trimmed = name?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return DefaultName;
        return trimmed.Length <= NameMaxLength ? trimmed : trimmed[..NameMaxLength].TrimEnd();
    }
}
