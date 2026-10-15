using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// An account that asked for no more non-essential email, through the one-click unsubscribe link in an
/// outreach message. Transactional mail (receipts, password resets, verification codes) still goes: that
/// is the account working, not us writing to them. One row per account; deleting the account deletes it.
/// </summary>
public class EmailOptOut : BaseEntity
{
    private EmailOptOut() { } // EF Core

    public Guid UserId { get; private set; }
    public DateTime OptedOutAtUtc { get; private set; }

    public static EmailOptOut Create(Guid userId, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            OptedOutAtUtc = utcNow,
        };
}
