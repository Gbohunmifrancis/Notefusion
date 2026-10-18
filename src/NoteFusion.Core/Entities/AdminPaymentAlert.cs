using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// The admins' "someone just paid" push for one completed payment: the claim that makes it once per payment, and
/// what became of it (System Health's Push panel). Written in the same transaction as the payment's ledger credit
/// (<c>PaymentFulfillment</c>), so a payment that completed always has one and a payment fulfilled twice cannot have
/// two: <see cref="PaymentTransactionId"/> is unique.
/// </summary>
/// <remarks>
/// A send is claimed (<see cref="BeginAttempt"/>, committed) before it goes, so a crash between the push service
/// accepting it and the result being written leaves an attempt with no result, which is never retried: an admin
/// is told at most once. Only a failure that was written down is tried again, up to <see cref="MaxAttempts"/>.
/// </remarks>
public class AdminPaymentAlert : BaseEntity
{
    public const int ErrorMaxLength = 300;

    /// <summary>A failed send is tried twice more, then left.</summary>
    public const int MaxAttempts = 3;

    private AdminPaymentAlert() { } // EF Core

    public Guid PaymentTransactionId { get; private set; }

    /// <summary>When the payment completed and this alert was claimed.</summary>
    public DateTime CreatedAtUtc { get; private set; }

    public int Attempts { get; private set; }
    public DateTime? LastAttemptAtUtc { get; private set; }

    /// <summary>When the push service took it, or it was settled with nobody to tell. Null while due.</summary>
    public DateTime? SentAtUtc { get; private set; }

    /// <summary>Admin phones the last attempt was addressed to.</summary>
    public int Devices { get; private set; }

    /// <summary>Phones the push service accepted it for.</summary>
    public int Accepted { get; private set; }

    /// <summary>Phones the push service refused (an expired token, say).</summary>
    public int Refused { get; private set; }

    /// <summary>Why the last attempt failed, capped. Admin-only.</summary>
    public string? Error { get; private set; }

    public static AdminPaymentAlert Claim(Guid paymentTransactionId, DateTime utcNow) => new()
    {
        Id = Guid.NewGuid(),
        PaymentTransactionId = Guard.AgainstEmpty(paymentTransactionId),
        CreatedAtUtc = utcNow,
    };

    /// <summary>Whether a send is due: never tried, or a failure written down with tries left.</summary>
    public bool IsDue => SentAtUtc is null && (Attempts == 0 || (Error is not null && Attempts < MaxAttempts));

    public void BeginAttempt(DateTime utcNow)
    {
        Attempts++;
        LastAttemptAtUtc = utcNow;
        Error = null;
    }

    public void MarkSent(int devices, int accepted, int refused, DateTime utcNow)
    {
        Devices = devices;
        Accepted = accepted;
        Refused = refused;
        Error = null;
        SentAtUtc = utcNow;
    }

    public void MarkFailed(int devices, int refused, string error)
    {
        Devices = devices;
        Refused = refused;
        Error = Guard.NotNullOrWhiteSpace(error).Length > ErrorMaxLength ? error[..ErrorMaxLength] : error;
    }
}
