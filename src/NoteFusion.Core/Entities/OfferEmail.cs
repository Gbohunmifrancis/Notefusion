using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// One person's copy of an offer's email: queued when Send was pressed, then sent, skipped (with why) or failed. Its
/// <see cref="Token"/> is the button link's <c>m=</c>, which counts the click. Unique per offer, account,
/// <see cref="Round"/> (the launch email and its last call) and <see cref="Channel"/> (a row is the email itself, or the
/// same words as a notification); goes with the account.
/// </summary>
public sealed class OfferEmail : BaseEntity
{
    /// <summary>A failed send is tried once more, never a third time.</summary>
    public const int MaxAttempts = 2;

    public const int TokenMaxLength = 64;
    public const int ErrorMaxLength = 500;

    private OfferEmail() { } // EF Core

    public Guid OfferId { get; private set; }
    public Guid UserId { get; private set; }
    public OfferEmailGroup Group { get; private set; }

    /// <summary>The launch email or the last call.</summary>
    public OfferEmailRound Round { get; private set; }

    /// <summary>The email, or a notification of the same words (web, or web and phone).</summary>
    public OfferChannel Channel { get; private set; }
    public OfferEmailStatus Status { get; private set; }
    public OfferSkipReason? SkipReason { get; private set; }
    public int Attempts { get; private set; }

    /// <summary>Unguessable (16 random bytes, base64url): the link's <c>m=</c>.</summary>
    public string Token { get; private set; } = string.Empty;

    public DateTime QueuedAtUtc { get; private set; }
    public DateTime? SentAtUtc { get; private set; }

    /// <summary>The first time the email's button opened the web app.</summary>
    public DateTime? ClickedAtUtc { get; private set; }

    /// <summary>
    /// The first time the email's tracking image was loaded: an open, or a mail app fetching images on delivery (Apple
    /// Mail does, so the count reads high). A click counts as an open too, as images may be blocked.
    /// </summary>
    public DateTime? OpenedAtUtc { get; private set; }

    /// <summary>Why the last attempt failed, capped. Admin-only.</summary>
    public string? LastError { get; private set; }

    public static OfferEmail Queue(
        Guid offerId, Guid userId, OfferEmailGroup group, string token, DateTime utcNow, OfferEmailRound round = OfferEmailRound.Launch,
        OfferChannel channel = OfferChannel.Email)
        => new()
        {
            Id = Guid.NewGuid(),
            OfferId = Guard.AgainstEmpty(offerId),
            UserId = Guard.AgainstEmpty(userId),
            Group = group,
            Round = round,
            Channel = channel,
            Status = OfferEmailStatus.Queued,
            Token = Guard.NotNullOrWhiteSpace(token),
            QueuedAtUtc = utcNow,
        };

    public void MarkSent(DateTime utcNow)
    {
        Attempts++;
        Status = OfferEmailStatus.Sent;
        SentAtUtc = utcNow;
        LastError = null;
    }

    /// <summary>A refused send: queued again for one more try, or Failed once both are spent.</summary>
    public void MarkAttemptFailed(string? error)
    {
        Attempts++;
        LastError = string.IsNullOrWhiteSpace(error)
            ? "Unknown error"
            : error.Length > ErrorMaxLength ? error[..ErrorMaxLength] : error;
        if (Attempts >= MaxAttempts)
            Status = OfferEmailStatus.Failed;
    }

    public void Skip(OfferSkipReason reason)
    {
        Status = OfferEmailStatus.Skipped;
        SkipReason = reason;
    }
}
