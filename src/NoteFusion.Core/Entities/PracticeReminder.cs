using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// One practice reminder push to one account on one of its local days: the claim that makes the reminder sweep
/// idempotent, and the audit trail the admin console lists. Inserted before anything is sent; (user, local date,
/// slot) is unique, so two overlapping sweeps cannot both send the same reminder and a day never has more than
/// two (<see cref="PracticeReminderSlot"/>).
/// </summary>
/// <remarks>
/// The words sent are kept on the row, so the one retry of a failed send says exactly what the first try did and
/// the console shows what the singer read. Only phones are reminded (Expo push, <c>Application/Practice/Reminders</c>);
/// an account with no phone that understands server reminders gets no row at all.
/// </remarks>
public class PracticeReminder : BaseEntity
{
    public const int TitleMaxLength = 80;
    public const int BodyMaxLength = 200;
    public const int ErrorMaxLength = 500;

    /// <summary>A failed send is tried once more, never a third time.</summary>
    public const int MaxAttempts = 2;

    private PracticeReminder() { } // EF Core

    public Guid UserId { get; private set; }

    /// <summary>The singer's calendar day the reminder is for, in the time zone stored on their account.</summary>
    public DateOnly LocalDate { get; private set; }

    public PracticeReminderSlot Slot { get; private set; }
    public PracticeReminderKind Kind { get; private set; }

    /// <summary>The streak the copy names: the running streak, or the one just lost; 0 when there is none.</summary>
    public int Streak { get; private set; }

    public string Title { get; private set; } = string.Empty;
    public string Body { get; private set; } = string.Empty;

    /// <summary>False when the account's notification sound was off: sent on the quiet Android channel, no iOS sound.</summary>
    public bool Sound { get; private set; }

    public PracticeReminderStatus Status { get; private set; }

    /// <summary>Phones the last attempt was addressed to.</summary>
    public int Devices { get; private set; }

    public int Attempts { get; private set; }

    /// <summary>Why the last attempt failed, capped. Admin-only.</summary>
    public string? Error { get; private set; }

    /// <summary>When the sweep claimed it.</summary>
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>When Expo accepted it. Null while pending and when it failed.</summary>
    public DateTime? SentAtUtc { get; private set; }

    public static PracticeReminder Claim(
        Guid userId,
        DateOnly localDate,
        PracticeReminderSlot slot,
        PracticeReminderKind kind,
        int streak,
        string title,
        string body,
        bool sound,
        int devices,
        DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            LocalDate = localDate,
            Slot = slot,
            Kind = kind,
            Streak = Math.Max(0, streak),
            Title = Guard.NotNullOrWhiteSpace(title),
            Body = Guard.NotNullOrWhiteSpace(body),
            Sound = sound,
            Devices = devices,
            Status = PracticeReminderStatus.Pending,
            Attempts = 1,
            CreatedAtUtc = utcNow,
        };

    public void MarkSent(int devices, DateTime utcNow)
    {
        Status = PracticeReminderStatus.Sent;
        Devices = devices;
        SentAtUtc = utcNow;
        Error = null;
    }

    public void MarkFailed(int devices, string? error)
    {
        Status = PracticeReminderStatus.Failed;
        Devices = devices;
        Error = TrimError(error);
    }

    /// <summary>
    /// Expo's breaker refused the send unsent, so this try does not count: left Failed with its attempt handed
    /// back, the retry sweep sends it as its first real try.
    /// </summary>
    public void MarkNotAttempted(string? reason)
    {
        Status = PracticeReminderStatus.Failed;
        Attempts = Math.Max(0, Attempts - 1);
        Error = TrimError(reason);
    }

    /// <summary>The error as stored: never blank, at most <see cref="ErrorMaxLength"/> characters.</summary>
    public static string TrimError(string? error)
        => string.IsNullOrWhiteSpace(error)
            ? "Unknown error"
            : error.Length > ErrorMaxLength ? error[..ErrorMaxLength] : error;
}
