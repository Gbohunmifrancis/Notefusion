using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// An immutable record of one thing an admin did to an account: who did it, to whom, from where, and
/// when. Append-only, like <see cref="Billing.LedgerEntry"/> — there is no mutator and nothing deletes
/// rows, because a trail that can be edited answers no question worth asking.
/// </summary>
/// <remarks>
/// The actor's email and the target's email are copied in rather than read through a join at display
/// time. A trail has to survive the accounts it describes: an admin who leaves, or a user who is
/// deleted, would otherwise take the readable half of the history with them.
/// </remarks>
public sealed class AdminAuditLog : BaseEntity
{
    private AdminAuditLog() { } // EF Core

    public Guid ActorUserId { get; private set; }

    /// <summary>Snapshot of the acting admin's email at the time of the action.</summary>
    public string ActorEmail { get; private set; } = string.Empty;

    public AdminAuditAction Action { get; private set; }

    /// <summary>The account acted on. Null for actions that are not about one account.</summary>
    public Guid? TargetUserId { get; private set; }

    /// <summary>Snapshot of the target's email at the time of the action.</summary>
    public string? TargetEmail { get; private set; }

    /// <summary>
    /// The address the request appeared to come from, or null when it could not be determined (a
    /// background job, a test). Null rather than a placeholder: "unknown" and "127.0.0.1" are
    /// different facts.
    /// </summary>
    public string? IpAddress { get; private set; }

    /// <summary>One human sentence, written by the handler that performed the action.</summary>
    public string Summary { get; private set; } = string.Empty;

    /// <summary>The operator's own note, when they gave a reason. Never generated.</summary>
    public string? Note { get; private set; }

    public DateTime OccurredAtUtc { get; private set; }

    public static AdminAuditLog Record(
        Guid actorUserId,
        string actorEmail,
        AdminAuditAction action,
        Guid? targetUserId,
        string? targetEmail,
        string? ipAddress,
        string summary,
        string? note,
        DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            ActorUserId = Guard.AgainstEmpty(actorUserId),
            ActorEmail = Guard.NotNullOrWhiteSpace(actorEmail),
            Action = action,
            TargetUserId = targetUserId,
            TargetEmail = targetEmail,
            IpAddress = ipAddress,
            Summary = Guard.NotNullOrWhiteSpace(summary),
            Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
            OccurredAtUtc = utcNow
        };
}
