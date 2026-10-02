using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// One row per anonymous try-it-free transcription from the website: a thirty-second preview made
/// with no account. The row is the job's credential (only a job id that is here can be polled
/// anonymously), the per-device and per-address throttle counts it, and the dashboard's web funnel
/// reads it — a preview that is later <see cref="Claim">claimed</see> by a new account is a conversion.
/// </summary>
public class PreviewJob : BaseEntity
{
    private PreviewJob() { } // EF Core

    /// <summary>The ML service's job id — what the browser polls with.</summary>
    public string JobId { get; private set; } = string.Empty;

    /// <summary>"upload" (a recording or file) or "link" (a song behind a streaming link).</summary>
    public string Kind { get; private set; } = "upload";

    /// <summary>The browser, as the opaque device hash the client sends; null when it sent none.</summary>
    public string? DeviceFingerprint { get; private set; }

    public string? Ip { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>When the worker reported a terminal state; null while running or never polled to the end.</summary>
    public DateTime? CompletedAtUtc { get; private set; }
    public bool Succeeded { get; private set; }

    /// <summary>A linked song's title, for the dashboard's feed. Null for a recording.</summary>
    public string? SourceTitle { get; private set; }

    /// <summary>The account that signed up after seeing this preview, when one did.</summary>
    public Guid? ClaimedByUserId { get; private set; }
    public DateTime? ClaimedAtUtc { get; private set; }

    public static PreviewJob Record(string jobId, string kind, string? deviceFingerprint, string? ip, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            JobId = Guard.NotNullOrWhiteSpace(jobId),
            Kind = kind == "link" ? "link" : "upload",
            DeviceFingerprint = string.IsNullOrWhiteSpace(deviceFingerprint) ? null : deviceFingerprint,
            Ip = string.IsNullOrWhiteSpace(ip) ? null : ip.Trim(),
            CreatedAtUtc = utcNow
        };

    /// <summary>Idempotent: the first terminal observation wins.</summary>
    public bool Complete(bool succeeded, string? sourceTitle, DateTime utcNow)
    {
        if (CompletedAtUtc is not null) return false;
        CompletedAtUtc = utcNow;
        Succeeded = succeeded;
        SourceTitle = string.IsNullOrWhiteSpace(sourceTitle) ? null : sourceTitle.Trim();
        return true;
    }

    /// <summary>Idempotent: the first account to claim keeps the credit.</summary>
    public bool Claim(Guid userId, DateTime utcNow)
    {
        if (ClaimedByUserId is not null) return false;
        ClaimedByUserId = Guard.AgainstEmpty(userId);
        ClaimedAtUtc = utcNow;
        return true;
    }
}
