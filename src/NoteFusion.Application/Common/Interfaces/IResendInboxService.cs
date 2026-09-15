namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Reads inbound email received on a Resend inbound route.
/// Infrastructure owns the implementation; the Application layer depends only on this contract.
/// </summary>
public interface IResendInboxService
{
    /// <summary>Paged list of received emails, newest first.</summary>
    Task<ResendInboxPage> ListAsync(int page, int pageSize, CancellationToken ct = default);

    /// <summary>Full detail for one received email, including HTML and text bodies.</summary>
    Task<ResendInboxEmail> GetAsync(Guid emailId, CancellationToken ct = default);

    /// <summary>Attachments associated with one received email.</summary>
    Task<IReadOnlyList<ResendInboxAttachment>> ListAttachmentsAsync(Guid emailId, CancellationToken ct = default);

    /// <summary>Download URL for a specific attachment.</summary>
    Task<string> GetAttachmentDownloadUrlAsync(Guid emailId, Guid attachmentId, CancellationToken ct = default);
}

// ── DTOs returned by the service (live in Application so queries can use them directly) ──────────

public sealed record ResendInboxPage(
    IReadOnlyList<ResendInboxEmailSummary> Items,
    bool HasMore,
    int Total);

public sealed record ResendInboxEmailSummary(
    Guid Id,
    string Subject,
    string From,
    string To,
    DateTime ReceivedAt,
    bool HasAttachments);

public sealed record ResendInboxEmail(
    Guid Id,
    string Subject,
    string From,
    string To,
    DateTime ReceivedAt,
    string? HtmlBody,
    string? TextBody,
    bool HasAttachments);

public sealed record ResendInboxAttachment(
    Guid Id,
    string Filename,
    string ContentType,
    long SizeBytes,
    string DownloadUrl);
