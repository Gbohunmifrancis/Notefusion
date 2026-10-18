using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities.Billing;

/// <summary>
/// Someone came back from a checkout's payment page without paying ("What stopped you?"): when, how long the page
/// was open, and their one-tap answer if they gave one. One row per checkout at most (the payment transaction is
/// unique here), written by the client that opened it.
/// </summary>
/// <remarks>
/// Beside the <see cref="PaymentTransaction"/> rather than on it: the transaction is the money's audit record, kept
/// when its account is deleted, while this is the customer's own words (the note is free text) and goes with the
/// account. Most checkouts never have one, and nothing about the payment reads it.
/// </remarks>
public class CheckoutExit : BaseEntity
{
    /// <summary>The longest note kept, after trimming.</summary>
    public const int NoteMaxLength = 280;

    /// <summary>The longest a page can have been open by its client's count: two days, past every checkout's life.</summary>
    public const int MaxSecondsOpen = 2 * 24 * 60 * 60;

    private CheckoutExit() { } // EF Core

    public Guid PaymentTransactionId { get; private set; }

    /// <summary>The account that opened the checkout (and the only one that may write here).</summary>
    public Guid UserId { get; private set; }

    /// <summary>The first time the client reported coming back unpaid.</summary>
    public DateTime ReturnedAtUtc { get; private set; }

    /// <summary>How long the payment page was open, in seconds, by the client's clock.</summary>
    public int SecondsOpen { get; private set; }

    /// <summary>The answer, or null while there is none ("Not now", a swipe).</summary>
    public CheckoutExitReason? Reason { get; private set; }

    /// <summary>The few words under "Something else", trimmed. Read by the console only, never shown to other users.</summary>
    public string? Note { get; private set; }

    public DateTime? AnsweredAtUtc { get; private set; }

    public static CheckoutExit Record(Guid paymentTransactionId, Guid userId, int secondsOpen, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            PaymentTransactionId = Guard.AgainstEmpty(paymentTransactionId),
            UserId = Guard.AgainstEmpty(userId),
            ReturnedAtUtc = utcNow,
            SecondsOpen = Guard.InRange(secondsOpen, 0, MaxSecondsOpen),
        };

    /// <summary>
    /// Takes the answer, once: a second answer to the same checkout changes nothing and returns false. A note is
    /// trimmed, and an empty one is no note.
    /// </summary>
    public bool Answer(CheckoutExitReason reason, string? note, DateTime utcNow)
    {
        if (!Enum.IsDefined(reason))
            throw new ArgumentOutOfRangeException(nameof(reason), reason, "Unknown reason.");
        if (Reason is not null)
            return false;

        var trimmed = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (trimmed is { Length: > NoteMaxLength })
            throw new ArgumentOutOfRangeException(nameof(note), trimmed.Length, $"A note is at most {NoteMaxLength} characters.");

        Reason = reason;
        Note = trimmed;
        AnsweredAtUtc = utcNow;
        return true;
    }
}
