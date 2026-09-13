namespace NoteFusion.Core.Entities;

/// <summary>
/// A person who signed up for early access while NoteFusion is under store review.
/// Kept separate from <see cref="User"/> because waitlist subscribers have no password,
/// no auth tokens, and have not yet created an active account.
/// </summary>
public sealed class WaitlistEntry
{
    public Guid Id { get; private set; }
    public string Email { get; private set; } = string.Empty;
    public string? FullName { get; private set; }
    public string? Role { get; private set; }
    public string? Source { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public bool IsInvited { get; private set; }
    public DateTime? InvitedAtUtc { get; private set; }

    private WaitlistEntry() { } // EF Core

    public WaitlistEntry(
        Guid id,
        string email,
        string? fullName = null,
        string? role = null,
        string? source = null,
        DateTime? createdAtUtc = null)
    {
        Id = id == Guid.Empty ? Guid.NewGuid() : id;
        Email = email.Trim().ToLowerInvariant();
        FullName = string.IsNullOrWhiteSpace(fullName) ? null : fullName.Trim();
        Role = string.IsNullOrWhiteSpace(role) ? null : role.Trim();
        Source = string.IsNullOrWhiteSpace(source) ? null : source.Trim();
        CreatedAtUtc = createdAtUtc ?? DateTime.UtcNow;
    }

    public void MarkInvited(DateTime? whenUtc = null)
    {
        IsInvited = true;
        InvitedAtUtc = whenUtc ?? DateTime.UtcNow;
    }
}
