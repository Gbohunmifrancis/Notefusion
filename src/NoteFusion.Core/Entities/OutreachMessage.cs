using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// One customer-research message to one account on one channel: the audit trail of the outreach sweep and
/// its "once per segment, ever" rule. The row is the claim: it is inserted before anything is sent, and
/// (user, segment, channel) is unique, so two overlapping sweeps cannot both send the same message.
/// </summary>
public class OutreachMessage : BaseEntity
{
    public const int ErrorMaxLength = 500;

    /// <summary>A failed send is tried once more, never a third time.</summary>
    public const int MaxAttempts = 2;

    private OutreachMessage() { } // EF Core

    public Guid UserId { get; private set; }
    public OutreachSegment Segment { get; private set; }
    public OutreachChannel Channel { get; private set; }
    public OutreachStatus Status { get; private set; }

    /// <summary>When the sweep claimed this send; what the seven-day spacing is measured from.</summary>
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>When the provider accepted it. Null while pending and when it failed.</summary>
    public DateTime? SentAtUtc { get; private set; }

    public int Attempts { get; private set; }

    /// <summary>Why the last attempt failed, capped. Admin-only.</summary>
    public string? Error { get; private set; }

    public static OutreachMessage Claim(Guid userId, OutreachSegment segment, OutreachChannel channel, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            Segment = segment,
            Channel = channel,
            Status = OutreachStatus.Pending,
            CreatedAtUtc = utcNow,
            Attempts = 1,
        };

    public void MarkSent(DateTime utcNow)
    {
        Status = OutreachStatus.Sent;
        SentAtUtc = utcNow;
        Error = null;
    }

    public void MarkFailed(string? error)
    {
        Status = OutreachStatus.Failed;
        Error = TrimError(error);
    }

    /// <summary>The error as stored: never blank, at most <see cref="ErrorMaxLength"/> characters.</summary>
    public static string TrimError(string? error)
        => string.IsNullOrWhiteSpace(error)
            ? "Unknown error"
            : error.Length > ErrorMaxLength ? error[..ErrorMaxLength] : error;
}
